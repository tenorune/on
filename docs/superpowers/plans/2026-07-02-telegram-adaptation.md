# Telegram Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Experimental Telegram adaptation of KnockKnock — a Mini App (the existing web app running inside Telegram, auto-signed-in via Telegram identity) plus a companion bot (full command interface + notifications with action buttons), per the approved spec `docs/superpowers/specs/2026-07-02-telegram-adaptation-design.md`.

**Architecture:** Everything lives in the existing repo/Firebase project. Server: new dependency-injected modules `functions/telegram-auth.js` (initData verification, account bootstrap, callables) and `functions/telegram.js` (bot command router + callbacks + notification keyboards), wired in `functions/index.js`; `sendToUser()` in `functions/notifier.js` gains a Telegram channel switch with FCM fallback. Client: `js/telegram.js` (context detection + boot auth) and `js/telegramSettings.js` (link/unlink + channel toggle), integrated into `js/app.js` boot.

**Tech Stack:** Vanilla JS ES modules (esbuild), Firebase RTDB + Cloud Functions v2 (ESM, Node 18+ global `fetch`), raw Telegram Bot API (no bot framework), Jest (jsdom for web, node for functions, emulator for rules).

## Global Constraints

- Feature flag `TELEGRAM_ENABLED` in `js/features.js`: **`true` on this branch** (`claude/telegram-app-adaptation-t1r1jp`), flipped to `false` at merge time by the maintainer.
- **No new npm dependencies** anywhere (client or functions). Telegram Bot API via global `fetch`.
- Server config via env vars loaded from `functions/.env.<projectId>` / `functions/.env.local` (existing pattern, see `FUNCTIONS_REGION`): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_APP_URL`. **All Telegram server behavior must be inert when `TELEGRAM_BOT_TOKEN` is unset** (deploy-safe on dev/main).
- All new functions logic is dependency-injected (like `notifier.js`) — tests never touch the network or firebase-admin.
- Test commands: web `npx jest` (repo root), functions `cd functions && npm test`, rules `npm run test:rules` (requires firebase emulator; if the sandbox can't run it, note that in the commit and rely on CI).
- Commit after every task (branch: `claude/telegram-app-adaptation-t1r1jp`). Do not merge to `dev`/`main`; do not create PRs.
- Uid formats: phrase uid = `sha256(phrase).hex.slice(0,32)`; telegram-derived uid = `sha256("telegram:" + tgId).hex.slice(0,32)`.
- Data model (server-only nodes deny ALL client access, like `notifierState`):
  - `telegramUsers/{tgId}` → `{ uid, chatId, createdAt?, linkedAt? }` (server-only)
  - `telegramByUid/{uid}` → `{ tgId, chatId }` (server-only; reverse index for notification sends — kept out of userPrefs so a client can't point notifications at another chat)
  - `userPrefs/{uid}/telegram` → `{ tgId, linkedAt }` (owner-visible link state for UI)
  - `userPrefs/{uid}/notifyChannel` → `'push' | 'telegram'` (owner read/write, validated)

---

### Task 1: Feature flag, Mini App script tag, CSP

**Files:**
- Modify: `js/features.js`
- Modify: `index.template.html` (head)
- Modify: `firebase.json` (hosting headers)

**Interfaces:**
- Produces: `TELEGRAM_ENABLED` (boolean export from `js/features.js`) — consumed by Tasks 10–12.

- [ ] **Step 1: Add the flag**

In `js/features.js` append:

```js
export const TELEGRAM_ENABLED = true; // Experimental Telegram Mini App + bot. TRUE on the feature branch only; flip to false at merge. Spec: docs/superpowers/specs/2026-07-02-telegram-adaptation-design.md
```

- [ ] **Step 2: Add the Telegram Web App script**

In `index.template.html`, directly before `<link rel="manifest" href="manifest.json" />` add:

```html
  <!-- Telegram Mini App bridge. Inert outside Telegram (defines window.Telegram
       with empty initData). Must load before the bundle so isTelegramContext()
       can detect the webview at boot. -->
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
```

- [ ] **Step 3: CSP + frame policy for Telegram**

In `firebase.json` hosting headers:
1. In the `Content-Security-Policy` value: add `https://telegram.org` to `script-src` (after `'self'`), and change `frame-ancestors 'none'` to `frame-ancestors https://web.telegram.org https://*.telegram.org`.
2. Remove the `X-Frame-Options` header line entirely (it can't express an allow-list; `frame-ancestors` supersedes it in all browsers that run the app).

Resulting CSP value (one line):

```
default-src 'self'; script-src 'self' https://telegram.org 'sha256-8plvDJLmM7886+ra4DrxBzGM2hgpxIJwDEK2Iu4PWMU=' 'sha256-H17ayHVJwTgPHrDOPQl3y1FOSwA+/1ZU1SRV+RfzVH8=' https://*.googleapis.com https://*.gstatic.com https://apis.google.com https://*.firebasedatabase.app; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://*.firebaseio.com wss://*.firebaseio.com https://*.firebasedatabase.app wss://*.firebasedatabase.app https://*.googleapis.com https://*.cloudfunctions.net; worker-src 'self'; base-uri 'self'; form-action 'self'; frame-src https://*.firebaseapp.com https://*.firebasedatabase.app; frame-ancestors https://web.telegram.org https://*.telegram.org;
```

- [ ] **Step 4: Verify web suite still green**

Run: `npx jest`
Expected: PASS (no test consumes the new flag yet).

- [ ] **Step 5: Commit**

```bash
git add js/features.js index.template.html firebase.json
git commit -m "feat(telegram): TELEGRAM_ENABLED flag, Mini App script tag, CSP frame allowance"
```

---

### Task 2: initData verification (functions/telegram-auth.js, pure part)

**Files:**
- Create: `functions/telegram-auth.js`
- Test: `functions/test/telegram-auth.test.js`

**Interfaces:**
- Produces:
  - `verifyInitData(initData: string, botToken: string, now: number, maxAgeMs?: number) → user object | null` (user is Telegram's parsed `user` JSON: `{ id, first_name, ... }`)
  - `deriveTelegramUid(tgId: string|number) → string` (32 hex chars)

- [ ] **Step 1: Write the failing tests**

Create `functions/test/telegram-auth.test.js`:

```js
import { createHmac } from 'crypto';
import { verifyInitData, deriveTelegramUid } from '../telegram-auth.js';

const BOT_TOKEN = '12345:TEST_TOKEN';

// Build a validly-signed initData string the same way Telegram does:
// data_check_string = sorted key=value lines (excluding hash), secret =
// HMAC_SHA256(botToken, key="WebAppData"), hash = HMAC_SHA256(dcs, secret) hex.
function makeInitData(fields, botToken = BOT_TOKEN) {
  const params = new URLSearchParams(fields);
  const pairs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort();
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

const NOW = 1_750_000_000_000;
const FRESH = { auth_date: String(Math.floor(NOW / 1000) - 60), user: JSON.stringify({ id: 42, first_name: 'Ada' }) };

describe('verifyInitData', () => {
  test('valid signature + fresh auth_date → parsed user', () => {
    const user = verifyInitData(makeInitData(FRESH), BOT_TOKEN, NOW);
    expect(user).toEqual({ id: 42, first_name: 'Ada' });
  });
  test('tampered payload → null', () => {
    const good = makeInitData(FRESH);
    const bad = good.replace(encodeURIComponent('"id":42'), encodeURIComponent('"id":43'));
    expect(verifyInitData(bad, BOT_TOKEN, NOW)).toBeNull();
  });
  test('signed with a different bot token → null', () => {
    expect(verifyInitData(makeInitData(FRESH, 'other:TOKEN'), BOT_TOKEN, NOW)).toBeNull();
  });
  test('stale auth_date → null', () => {
    const stale = { ...FRESH, auth_date: String(Math.floor(NOW / 1000) - 25 * 60 * 60) };
    expect(verifyInitData(makeInitData(stale), BOT_TOKEN, NOW)).toBeNull();
  });
  test('missing hash / empty / missing token → null', () => {
    expect(verifyInitData('auth_date=1', BOT_TOKEN, NOW)).toBeNull();
    expect(verifyInitData('', BOT_TOKEN, NOW)).toBeNull();
    expect(verifyInitData(makeInitData(FRESH), '', NOW)).toBeNull();
  });
  test('missing user field → null', () => {
    const noUser = { auth_date: FRESH.auth_date };
    expect(verifyInitData(makeInitData(noUser), BOT_TOKEN, NOW)).toBeNull();
  });
});

describe('deriveTelegramUid', () => {
  test('32 hex chars, deterministic, differs by tgId', () => {
    const a = deriveTelegramUid(42);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(deriveTelegramUid('42')).toBe(a);   // string/number agnostic
    expect(deriveTelegramUid(43)).not.toBe(a);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npx jest test/telegram-auth.test.js`
Expected: FAIL — cannot find module `../telegram-auth.js`.

- [ ] **Step 3: Implement**

Create `functions/telegram-auth.js`:

```js
// functions/telegram-auth.js — Telegram Mini App auth: initData verification,
// uid mapping/bootstrap, and the validate/link/unlink callable handlers.
// Deps are injected (see index.js) so everything tests without firebase-admin.
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { normalizeRecoveryCode, deriveUid } from './auth.js';

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // initData replay window

// Verify Telegram WebApp initData per https://core.telegram.org/bots/webapps
// #validating-data-received-via-the-mini-app. Returns the parsed `user` object
// on success, null on any failure (bad signature, stale, malformed).
export function verifyInitData(initData, botToken, now, maxAgeMs = DEFAULT_MAX_AGE_MS) {
  if (typeof initData !== 'string' || !initData || !botToken) return null;
  let params;
  try { params = new URLSearchParams(initData); } catch { return null; }
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const authDateMs = Number(params.get('auth_date') || 0) * 1000;
  if (!authDateMs || now - authDateMs > maxAgeMs) return null;
  let user;
  try { user = JSON.parse(params.get('user') || ''); } catch { return null; }
  if (!user || user.id == null) return null;
  return user;
}

// Telegram-derived app uid — same 32-hex format as phrase uids (auth.js deriveUid).
export function deriveTelegramUid(tgId) {
  return createHash('sha256').update(`telegram:${tgId}`, 'utf8').digest('hex').slice(0, 32);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npx jest test/telegram-auth.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/telegram-auth.js functions/test/telegram-auth.test.js
git commit -m "feat(telegram): initData verification + telegram-derived uid"
```

---

### Task 3: Account mapping + bootstrap (`ensureTelegramUser`)

**Files:**
- Modify: `functions/telegram-auth.js`
- Test: `functions/test/telegram-auth.test.js` (append)

**Interfaces:**
- Consumes: `deriveTelegramUid` (Task 2).
- Produces: `ensureTelegramUser(deps, tgUser) → Promise<{ uid, created, linked }>` where deps = `{ getVal(path), set(path, value), update(path, obj), transaction(path, fn) → { committed }, now(), generateCode?() }`. `created` = presence node was just bootstrapped; `linked` = mapping points at a non-derived (phrase) uid. Used by Tasks 4 and 6.

- [ ] **Step 1: Write the failing tests** (append to `functions/test/telegram-auth.test.js`)

```js
import { jest } from '@jest/globals';
import { ensureTelegramUser } from '../telegram-auth.js';

function makeStoreDeps(store = {}) {
  return {
    store,
    getVal: jest.fn(async (path) => store[path] ?? null),
    set: jest.fn(async (path, value) => { store[path] = value; }),
    update: jest.fn(async (path, obj) => {
      for (const [k, v] of Object.entries(obj)) store[`${path}/${k}`.replace(/\/+/g, '/')] = v;
    }),
    transaction: jest.fn(async (path, fn) => {
      const next = fn(store[path] ?? null);
      if (next === undefined) return { committed: false };
      store[path] = next;
      return { committed: true };
    }),
    now: () => 1000,
    generateCode: () => 'AAAAAA',
  };
}

describe('ensureTelegramUser', () => {
  test('first contact: creates mapping, reverse index, prefs, presence with claimed code', async () => {
    const deps = makeStoreDeps();
    const res = await ensureTelegramUser(deps, { id: 42, first_name: 'Ada' });
    expect(res.created).toBe(true);
    expect(res.linked).toBe(false);
    expect(res.uid).toMatch(/^[0-9a-f]{32}$/);
    expect(deps.store[`telegramUsers/42`]).toMatchObject({ uid: res.uid, chatId: '42' });
    expect(deps.store[`telegramByUid/${res.uid}`]).toEqual({ tgId: '42', chatId: '42' });
    expect(deps.store[`userPrefs/${res.uid}/notifyChannel`]).toBe('telegram');
    expect(deps.store[`users/${res.uid}/presence`]).toEqual({ code: 'AAAAAA', status: 'unavailable', availableUntil: null });
    expect(deps.store['codeIndex/AAAAAA']).toBe(res.uid);
  });
  test('returning user: no writes, created=false', async () => {
    const deps = makeStoreDeps();
    const first = await ensureTelegramUser(deps, { id: 42 });
    deps.set.mockClear(); deps.transaction.mockClear();
    const again = await ensureTelegramUser(deps, { id: 42 });
    expect(again).toEqual({ uid: first.uid, created: false, linked: false });
    expect(deps.set).not.toHaveBeenCalled();
    expect(deps.transaction).not.toHaveBeenCalled();
  });
  test('share-code collision retries with a fresh code', async () => {
    const deps = makeStoreDeps({ 'codeIndex/AAAAAA': 'someoneElse' });
    const codes = ['AAAAAA', 'BBBBBB'];
    deps.generateCode = () => codes.shift();
    const res = await ensureTelegramUser(deps, { id: 7 });
    expect(deps.store[`users/${res.uid}/presence`].code).toBe('BBBBBB');
  });
  test('linked mapping (phrase uid) is respected: linked=true, no presence bootstrap', async () => {
    const deps = makeStoreDeps({
      'telegramUsers/42': { uid: 'phraseuid00000000000000000000000', chatId: '42' },
      'users/phraseuid00000000000000000000000/presence': { code: 'ZZZZZZ', status: 'unavailable', availableUntil: null },
    });
    const res = await ensureTelegramUser(deps, { id: 42 });
    expect(res).toEqual({ uid: 'phraseuid00000000000000000000000', created: false, linked: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npx jest test/telegram-auth.test.js`
Expected: FAIL — `ensureTelegramUser` is not exported.

- [ ] **Step 3: Implement** (append to `functions/telegram-auth.js`)

```js
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function generateShareCode() {
  let code = '';
  for (let i = 0; i < 6; i += 1) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

// Claim a share code in codeIndex transactionally; loop on collision. Mirrors
// the client's initUser (js/db/social.js) so a bot/Mini-App account is
// indistinguishable from a web one.
async function claimShareCode(deps, uid) {
  for (;;) {
    const code = (deps.generateCode || generateShareCode)();
    const { committed } = await deps.transaction(`codeIndex/${code}`, (current) => {
      if (current !== null) return undefined; // abort — taken
      return uid;
    });
    if (committed) return code;
  }
}

// Resolve (or create) the app account behind a Telegram user. Idempotent.
//  - No mapping → derive uid, write mapping + reverse index + prefs defaults.
//  - No presence → bootstrap it (claim code) so bot commands work pre-Mini-App.
// Returns { uid, created, linked }.
export async function ensureTelegramUser(deps, tgUser) {
  const tgId = String(tgUser.id);
  const derivedUid = deriveTelegramUid(tgId);
  let mapping = await deps.getVal(`telegramUsers/${tgId}`);
  if (!mapping) {
    mapping = { uid: derivedUid, chatId: tgId, createdAt: deps.now() };
    await deps.set(`telegramUsers/${tgId}`, mapping);
    await deps.set(`telegramByUid/${derivedUid}`, { tgId, chatId: tgId });
    await deps.update(`userPrefs/${derivedUid}`, {
      'telegram/tgId': tgId,
      'telegram/linkedAt': deps.now(),
      notifyChannel: 'telegram',
    });
  }
  let created = false;
  const presence = await deps.getVal(`users/${mapping.uid}/presence`);
  if (!presence) {
    const code = await claimShareCode(deps, mapping.uid);
    await deps.set(`users/${mapping.uid}/presence`, { code, status: 'unavailable', availableUntil: null });
    created = true;
  }
  return { uid: mapping.uid, created, linked: mapping.uid !== derivedUid };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npx jest test/telegram-auth.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/telegram-auth.js functions/test/telegram-auth.test.js
git commit -m "feat(telegram): idempotent Telegram account mapping + bootstrap"
```

---

### Task 4: validateTelegram / linkTelegram / unlinkTelegram handlers + index.js wiring

**Files:**
- Modify: `functions/telegram-auth.js`
- Modify: `functions/index.js`
- Test: `functions/test/telegram-auth.test.js` (append)

**Interfaces:**
- Consumes: `verifyInitData`, `ensureTelegramUser`, `deriveTelegramUid` (Tasks 2–3); `normalizeRecoveryCode`, `deriveUid` from `functions/auth.js`; `allowRecoveryAttempt` rate limiter (already in `functions/index.js`).
- Produces callables (client wrappers in Task 10):
  - `validateTelegram({ initData })` → `{ token, uid, linked, created }`
  - `linkTelegram({ initData, code })` → `{ token }`
  - `unlinkTelegram({ initData })` → `{ token }` (token for the reverted derived-uid account)
  - Handler deps shape: `{ botToken, now(), getVal, set, update, transaction, mintToken(uid), allowAttempt(uid) }`.

- [ ] **Step 1: Write the failing tests** (append to `functions/test/telegram-auth.test.js`)

```js
import { validateTelegramHandler, linkTelegramHandler, unlinkTelegramHandler } from '../telegram-auth.js';

function makeHandlerDeps(store = {}) {
  const deps = makeStoreDeps(store);
  return {
    ...deps,
    botToken: BOT_TOKEN,
    mintToken: jest.fn(async (uid) => `token-for-${uid}`),
    allowAttempt: jest.fn(async () => true),
  };
}
const freshInitData = () => makeInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 42, first_name: 'Ada' }) });

describe('validateTelegramHandler', () => {
  test('valid initData → bootstraps account and mints token', async () => {
    const deps = makeHandlerDeps();
    const res = await validateTelegramHandler({ data: { initData: freshInitData() } }, deps);
    expect(res.token).toBe(`token-for-${res.uid}`);
    expect(res.created).toBe(true);
    expect(res.linked).toBe(false);
  });
  test('bad initData → unauthenticated', async () => {
    const deps = makeHandlerDeps();
    await expect(validateTelegramHandler({ data: { initData: 'garbage' } }, deps)).rejects.toThrow(/signature|Telegram/i);
  });
  test('no bot token configured → failed-precondition', async () => {
    const deps = { ...makeHandlerDeps(), botToken: null };
    await expect(validateTelegramHandler({ data: { initData: freshInitData() } }, deps)).rejects.toThrow(/not configured/i);
  });
});

describe('linkTelegramHandler', () => {
  const PHRASE = 'able-baker-charlie-delta';
  test('valid phrase with existing account → repoints mapping, cleans old reverse index, mints token', async () => {
    const deps = makeHandlerDeps();
    // Telegram user has already opened the Mini App once (derived account exists):
    const { uid: derivedUid } = await validateTelegramHandler({ data: { initData: freshInitData() } }, deps);
    // The phrase account exists:
    const { deriveUid } = await import('../auth.js');
    const phraseUid = await deriveUid(PHRASE);
    deps.store[`users/${phraseUid}/presence`] = { code: 'PHRAZ1', status: 'unavailable', availableUntil: null };
    const res = await linkTelegramHandler({ data: { initData: freshInitData(), code: PHRASE } }, deps);
    expect(res.token).toBe(`token-for-${phraseUid}`);
    expect(deps.store['telegramUsers/42']).toMatchObject({ uid: phraseUid, chatId: '42' });
    expect(deps.store[`telegramByUid/${phraseUid}`]).toEqual({ tgId: '42', chatId: '42' });
    expect(deps.store[`telegramByUid/${derivedUid}`]).toBeNull();
    expect(deps.store[`userPrefs/${phraseUid}/notifyChannel`]).toBe('telegram');
  });
  test('unknown phrase account → not-found; rate limiter consulted', async () => {
    const deps = makeHandlerDeps();
    await expect(linkTelegramHandler({ data: { initData: freshInitData(), code: PHRASE } }, deps)).rejects.toThrow(/No account/i);
    expect(deps.allowAttempt).toHaveBeenCalled();
  });
  test('rate limited → resource-exhausted', async () => {
    const deps = makeHandlerDeps();
    deps.allowAttempt = jest.fn(async () => false);
    await expect(linkTelegramHandler({ data: { initData: freshInitData(), code: PHRASE } }, deps)).rejects.toThrow(/Too many/i);
  });
});

describe('unlinkTelegramHandler', () => {
  test('reverts mapping to the derived uid and flips the phrase account back to push', async () => {
    const deps = makeHandlerDeps();
    const { deriveUid } = await import('../auth.js');
    const phraseUid = await deriveUid('able-baker-charlie-delta');
    deps.store[`users/${phraseUid}/presence`] = { code: 'PHRAZ1', status: 'unavailable', availableUntil: null };
    await validateTelegramHandler({ data: { initData: freshInitData() } }, deps);
    await linkTelegramHandler({ data: { initData: freshInitData(), code: 'able-baker-charlie-delta' } }, deps);
    const res = await unlinkTelegramHandler({ data: { initData: freshInitData() } }, deps);
    expect(deps.store['telegramUsers/42'].uid).not.toBe(phraseUid);
    expect(deps.store[`telegramByUid/${phraseUid}`]).toBeNull();
    expect(deps.store[`userPrefs/${phraseUid}/notifyChannel`]).toBe('push');
    expect(typeof res.token).toBe('string');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npx jest test/telegram-auth.test.js`
Expected: FAIL — handlers not exported.

- [ ] **Step 3: Implement handlers** (append to `functions/telegram-auth.js`)

```js
function requireTelegramUser(request, deps) {
  if (!deps.botToken) throw new HttpsError('failed-precondition', 'Telegram is not configured.');
  const tgUser = verifyInitData(request.data?.initData, deps.botToken, deps.now());
  if (!tgUser) throw new HttpsError('unauthenticated', 'Invalid Telegram signature.');
  return tgUser;
}

// Mini App boot: verify initData, ensure the account exists, mint a token.
export async function validateTelegramHandler(request, deps) {
  const tgUser = requireTelegramUser(request, deps);
  const { uid, created, linked } = await ensureTelegramUser(deps, tgUser);
  const token = await deps.mintToken(uid);
  return { token, uid, created, linked };
}

// Link the Telegram identity to an existing phrase account. The phrase goes
// through the same derived-uid rate limiter as validateRecovery (brute-force
// parity). The old derived account is left orphaned (spec: accepted trade-off);
// its reverse index is removed so notifications can't route to it.
export async function linkTelegramHandler(request, deps) {
  const tgUser = requireTelegramUser(request, deps);
  const normalized = normalizeRecoveryCode(request.data?.code);
  if (!normalized) throw new HttpsError('invalid-argument', 'Invalid recovery code.');
  const uid = await deriveUid(normalized);
  if (!(await deps.allowAttempt(uid))) throw new HttpsError('resource-exhausted', 'Too many attempts. Try again shortly.');
  const presence = await deps.getVal(`users/${uid}/presence`);
  if (!presence) throw new HttpsError('not-found', 'No account with that phrase.');
  const tgId = String(tgUser.id);
  const prior = await deps.getVal(`telegramUsers/${tgId}`);
  const chatId = prior?.chatId || tgId;
  if (prior && prior.uid !== uid) await deps.set(`telegramByUid/${prior.uid}`, null);
  await deps.set(`telegramUsers/${tgId}`, { uid, chatId, linkedAt: deps.now() });
  await deps.set(`telegramByUid/${uid}`, { tgId, chatId });
  await deps.update(`userPrefs/${uid}`, {
    'telegram/tgId': tgId,
    'telegram/linkedAt': deps.now(),
    notifyChannel: 'telegram',
  });
  const token = await deps.mintToken(uid);
  return { token };
}

// Revert the mapping to the Telegram-derived account. The phrase account goes
// back to push delivery (it no longer has a Telegram route).
export async function unlinkTelegramHandler(request, deps) {
  const tgUser = requireTelegramUser(request, deps);
  const tgId = String(tgUser.id);
  const prior = await deps.getVal(`telegramUsers/${tgId}`);
  const derivedUid = deriveTelegramUid(tgId);
  const chatId = prior?.chatId || tgId;
  if (prior && prior.uid !== derivedUid) {
    await deps.set(`telegramByUid/${prior.uid}`, null);
    await deps.update(`userPrefs/${prior.uid}`, { telegram: null, notifyChannel: 'push' });
  }
  await deps.set(`telegramUsers/${tgId}`, { uid: derivedUid, chatId, createdAt: deps.now() });
  await deps.set(`telegramByUid/${derivedUid}`, { tgId, chatId });
  const { uid } = await ensureTelegramUser(deps, tgUser); // re-bootstrap presence if needed
  const token = await deps.mintToken(uid);
  return { token };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npx jest test/telegram-auth.test.js`
Expected: PASS.

- [ ] **Step 5: Wire callables in `functions/index.js`**

After the `resolveInvitePreview` export, add:

```js
// ── Telegram (experimental; inert unless TELEGRAM_BOT_TOKEN is set in the
// functions env — see functions/.env.example and docs/telegram-setup.md) ──────
import { validateTelegramHandler, linkTelegramHandler, unlinkTelegramHandler } from './telegram-auth.js';

function makeTelegramAuthDeps() {
  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN || null,
    now: () => Date.now(),
    getVal: async (path) => (await db.ref(path).get()).val(),
    set: async (path, value) => { await db.ref(path).set(value); },
    update: async (path, obj) => { await db.ref(path).update(obj); },
    transaction: async (path, fn) => {
      const res = await db.ref(path).transaction(fn);
      return { committed: res.committed };
    },
    mintToken: (uid) => getAuth().createCustomToken(uid),
    allowAttempt: (uid) => allowRecoveryAttempt(getDatabase(), uid),
  };
}

export const validateTelegram = httpsOnCall((request) => validateTelegramHandler(request, makeTelegramAuthDeps()));
export const linkTelegram = httpsOnCall((request) => linkTelegramHandler(request, makeTelegramAuthDeps()));
export const unlinkTelegram = httpsOnCall((request) => unlinkTelegramHandler(request, makeTelegramAuthDeps()));
```

(Note: `db`, `getAuth`, `httpsOnCall`, `allowRecoveryAttempt`, `getDatabase` all already exist in `functions/index.js` — reuse them, move the `import` to the top of the file with the other imports.)

- [ ] **Step 6: Full functions suite**

Run: `cd functions && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add functions/telegram-auth.js functions/test/telegram-auth.test.js functions/index.js
git commit -m "feat(telegram): validateTelegram/linkTelegram/unlinkTelegram callables"
```

---

### Task 5: Notification channel switch in sendToUser + notification keyboards

**Files:**
- Modify: `functions/notifier.js` (sendToUser only)
- Create: `functions/telegram.js` (keyboard builder only; router comes in Tasks 6–8)
- Modify: `functions/index.js` (makeDeps gains `sendTelegram`; Bot API helper)
- Test: `functions/test/notifier.test.js` (append), `functions/test/telegram.test.js` (new)

**Interfaces:**
- Consumes: existing `sendToUser(deps, uid, message, data)`; `data.type` ∈ `knock|call|availability|invite|followRequest`, `data.targetUid`, `data.groupId` (invite only).
- Produces:
  - `sendToUser` honors `userPrefs/{uid}/notifyChannel === 'telegram'` + `telegramByUid/{uid}.chatId`, via optional dep `deps.sendTelegram(chatId, message, data) → Promise<boolean>`; falls back to FCM when absent/false/throws.
  - `buildNotificationKeyboard(data, appUrl) → inline_keyboard array | null` (exported from `functions/telegram.js`).

- [ ] **Step 1: Write the failing tests**

Append to `functions/test/notifier.test.js`:

```js
describe('sendToUser telegram channel', () => {
  const tgStore = {
    'userPrefs/u1/notifyChannel': 'telegram',
    'telegramByUid/u1': { tgId: '42', chatId: '42' },
    'userPrefs/u1/pushTokens': { tokA: {} },
  };
  test('channel=telegram with chatId → telegram send, no FCM', async () => {
    const deps = makeDeps({ store: { ...tgStore } });
    deps.sendTelegram = jest.fn(async () => true);
    const ok = await sendToUser(deps, 'u1', { title: 'hi', body: '' }, { type: 'knock', targetUid: 's' });
    expect(ok).toBe(true);
    expect(deps.sendTelegram).toHaveBeenCalledWith('42', { title: 'hi', body: '' }, { type: 'knock', targetUid: 's' });
    expect(deps.send).not.toHaveBeenCalled();
  });
  test('telegram send fails → falls back to FCM', async () => {
    const deps = makeDeps({ store: { ...tgStore } });
    deps.sendTelegram = jest.fn(async () => false);
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, {});
    expect(deps.send).toHaveBeenCalled();
  });
  test('telegram send throws → falls back to FCM', async () => {
    const deps = makeDeps({ store: { ...tgStore } });
    deps.sendTelegram = jest.fn(async () => { throw new Error('blocked'); });
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, {});
    expect(deps.send).toHaveBeenCalled();
  });
  test('channel=push → FCM even when a telegram route exists', async () => {
    const deps = makeDeps({ store: { ...tgStore, 'userPrefs/u1/notifyChannel': 'push' } });
    deps.sendTelegram = jest.fn(async () => true);
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, {});
    expect(deps.sendTelegram).not.toHaveBeenCalled();
    expect(deps.send).toHaveBeenCalled();
  });
  test('no sendTelegram dep (bot not configured) → FCM', async () => {
    const deps = makeDeps({ store: { ...tgStore } });
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, {});
    expect(deps.send).toHaveBeenCalled();
  });
});
```

Create `functions/test/telegram.test.js`:

```js
import { buildNotificationKeyboard } from '../telegram.js';

const APP = 'https://app.example.com';

describe('buildNotificationKeyboard', () => {
  test('knock → Knock back callback', () => {
    expect(buildNotificationKeyboard({ type: 'knock', targetUid: 'u9' }, APP))
      .toEqual([[{ text: 'Knock back', callback_data: 'knock:u9' }]]);
  });
  test('availability → Knock callback', () => {
    expect(buildNotificationKeyboard({ type: 'availability', targetUid: 'u9' }, APP))
      .toEqual([[{ text: 'Knock', callback_data: 'knock:u9' }]]);
  });
  test('call → web_app deep link', () => {
    expect(buildNotificationKeyboard({ type: 'call', targetUid: 'u9' }, APP))
      .toEqual([[{ text: 'Answer in KnockKnock', web_app: { url: APP } }]]);
  });
  test('call with no app url → null (plain text message)', () => {
    expect(buildNotificationKeyboard({ type: 'call', targetUid: 'u9' }, '')).toBeNull();
  });
  test('invite → accept/decline', () => {
    expect(buildNotificationKeyboard({ type: 'invite', targetUid: 'u9', groupId: 'G1' }, APP))
      .toEqual([[
        { text: 'Accept', callback_data: 'invite_accept:G1' },
        { text: 'Decline', callback_data: 'invite_decline:G1' },
      ]]);
  });
  test('followRequest → approve/decline', () => {
    expect(buildNotificationKeyboard({ type: 'followRequest', targetUid: 'u9' }, APP))
      .toEqual([[
        { text: 'Approve', callback_data: 'fr_approve:u9' },
        { text: 'Decline', callback_data: 'fr_decline:u9' },
      ]]);
  });
  test('unknown type → null', () => {
    expect(buildNotificationKeyboard({ type: 'mystery' }, APP)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npx jest`
Expected: new tests FAIL (module/branch missing); all pre-existing tests still PASS (the guard on `deps.sendTelegram` isn't in yet, but old tests don't set a channel — confirm no pre-existing failures besides the new ones).

- [ ] **Step 3: Implement the sendToUser switch**

In `functions/notifier.js`, replace the body of `sendToUser` with:

```js
export async function sendToUser(deps, uid, message, data) {
  // Experimental Telegram channel (spec 2026-07-02): a linked user whose
  // notifyChannel is 'telegram' gets a bot message instead of web push. The
  // uid→chat route lives in server-only telegramByUid (NOT userPrefs) so a
  // client can't point its notifications at someone else's chat. Any failure
  // (user blocked the bot, missing route, bot unconfigured) falls back to FCM.
  if (deps.sendTelegram) {
    const [channel, tgRoute] = await Promise.all([
      deps.getVal(`userPrefs/${uid}/notifyChannel`),
      deps.getVal(`telegramByUid/${uid}`),
    ]);
    if (channel === 'telegram' && tgRoute && tgRoute.chatId) {
      try {
        if (await deps.sendTelegram(tgRoute.chatId, message, data)) return true;
      } catch (e) {
        console.error(`[notify] telegram send failed for ${uid}: ${e?.message || e}`);
      }
    }
  }
  const tokensMap = await deps.getVal(`userPrefs/${uid}/pushTokens`);
  const tokens = tokensMap ? Object.keys(tokensMap) : [];
  if (tokens.length === 0) return false;
  const { failedTokens } = await deps.send(tokens, message, data);
  if (failedTokens && failedTokens.length) {
    const nulls = {};
    for (const t of failedTokens) nulls[t] = null;
    await deps.update(`userPrefs/${uid}/pushTokens`, nulls);
  }
  // Delivered if at least one token wasn't rejected.
  return (failedTokens?.length || 0) < tokens.length;
}
```

- [ ] **Step 4: Implement the keyboard builder**

Create `functions/telegram.js`:

```js
// functions/telegram.js — Telegram bot: notification keyboards + (Tasks 6–8)
// the webhook command/callback router. Deps are injected; no network here.

// Inline keyboard for a notification, keyed by the same data.type the FCM
// payload carries. Simple reactions are callbacks handled by the webhook;
// answering a call needs the canvas, so it deep-links into the Mini App.
export function buildNotificationKeyboard(data, appUrl) {
  switch (data?.type) {
    case 'knock':
      return [[{ text: 'Knock back', callback_data: `knock:${data.targetUid}` }]];
    case 'availability':
      return [[{ text: 'Knock', callback_data: `knock:${data.targetUid}` }]];
    case 'call':
      return appUrl ? [[{ text: 'Answer in KnockKnock', web_app: { url: appUrl } }]] : null;
    case 'invite':
      return [[
        { text: 'Accept', callback_data: `invite_accept:${data.groupId}` },
        { text: 'Decline', callback_data: `invite_decline:${data.groupId}` },
      ]];
    case 'followRequest':
      return [[
        { text: 'Approve', callback_data: `fr_approve:${data.targetUid}` },
        { text: 'Decline', callback_data: `fr_decline:${data.targetUid}` },
      ]];
    default:
      return null;
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `cd functions && npx jest`
Expected: PASS (including all pre-existing notifier tests — they don't set `sendTelegram`, so the switch is skipped).

- [ ] **Step 6: Wire the real Telegram sender in `functions/index.js`**

Add near `makeDeps()`:

```js
import { buildNotificationKeyboard } from './telegram.js';

// Raw Bot API call. Returns the result object, or null on any failure (logged).
// Node 18+ global fetch; no SDK dependency.
async function tgApi(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!body || !body.ok) {
    console.error(`[telegram] ${method} failed: HTTP ${res.status} ${JSON.stringify(body?.description || body)}`);
    return null;
  }
  return body.result;
}
```

In `makeDeps()`, add after `send`:

```js
    // Present only when the bot is configured; sendToUser treats absence as
    // "FCM only". message.title carries the whole notification text (body is '').
    sendTelegram: process.env.TELEGRAM_BOT_TOKEN
      ? async (chatId, message, data) => {
          const keyboard = buildNotificationKeyboard(data, process.env.TELEGRAM_APP_URL || '');
          const result = await tgApi('sendMessage', {
            chat_id: chatId,
            text: message.title || '',
            ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
          });
          return !!result;
        }
      : null,
```

- [ ] **Step 7: Full functions suite again**

Run: `cd functions && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add functions/notifier.js functions/telegram.js functions/index.js functions/test/notifier.test.js functions/test/telegram.test.js
git commit -m "feat(telegram): notification channel switch with FCM fallback + action keyboards"
```

---

### Task 6: Bot command router — /start, /help, /status, /off, /notifications

**Files:**
- Modify: `functions/telegram.js`
- Test: `functions/test/telegram.test.js` (append)

**Interfaces:**
- Consumes: `ensureTelegramUser` (Task 3) — imported into `telegram.js` from `./telegram-auth.js`.
- Produces:
  - `handleUpdate(deps, update) → Promise<void>` — deps = `{ getVal, set, update, transaction, now(), appUrl, generateCode?, tg: { sendMessage(chatId, text, extra?) , answerCallbackQuery(id, text) } }`.
  - `parseDurationMinutes(raw) → number | null` (exported for tests; `null` = unparseable, no-arg default handled by caller as 60).
  - Command handlers write the exact same RTDB shapes the web client writes (see step 3 comments).

- [ ] **Step 1: Write the failing tests** (append to `functions/test/telegram.test.js`)

```js
import { jest } from '@jest/globals';
import { handleUpdate, parseDurationMinutes } from '../telegram.js';

function makeBotDeps(store = {}) {
  return {
    store,
    getVal: jest.fn(async (path) => store[path] ?? null),
    set: jest.fn(async (path, value) => { store[path] = value; }),
    update: jest.fn(async (path, obj) => {
      for (const [k, v] of Object.entries(obj)) store[`${path}/${k}`] = v;
    }),
    transaction: jest.fn(async (path, fn) => {
      const next = fn(store[path] ?? null);
      if (next === undefined) return { committed: false };
      store[path] = next;
      return { committed: true };
    }),
    now: () => 1_000_000,
    appUrl: 'https://app.example.com',
    generateCode: () => 'AAAAAA',
    tg: {
      sendMessage: jest.fn(async () => ({})),
      answerCallbackQuery: jest.fn(async () => ({})),
    },
  };
}
const msgUpdate = (text, from = { id: 42, first_name: 'Ada' }) =>
  ({ message: { text, from, chat: { id: 42, type: 'private' } } });

// A registered user for command tests: mapping + presence exist.
function seedUser(store, uid = 'u-tg-42') {
  store['telegramUsers/42'] = { uid, chatId: '42' };
  store[`users/${uid}/presence`] = { code: 'AAAAAA', status: 'unavailable', availableUntil: null };
  return uid;
}

describe('parseDurationMinutes', () => {
  test.each([
    ['30m', 30], ['2h', 120], ['90', 90], ['1h30m', 90], ['45 min', 45], ['2 h', 120],
  ])('%s → %i', (raw, want) => expect(parseDurationMinutes(raw)).toBe(want));
  test('garbage → null; out of range clamps to 5..1440', () => {
    expect(parseDurationMinutes('soon')).toBeNull();
    expect(parseDurationMinutes('1')).toBe(5);
    expect(parseDurationMinutes('99h')).toBe(1440);
  });
});

describe('handleUpdate: /start', () => {
  test('bootstraps the account and replies with an open-app button', async () => {
    const deps = makeBotDeps();
    await handleUpdate(deps, msgUpdate('/start'));
    expect(deps.store['telegramUsers/42']).toBeTruthy();
    const [chatId, text, extra] = deps.tg.sendMessage.mock.calls[0];
    expect(chatId).toBe('42');
    expect(text).toMatch(/KnockKnock/);
    expect(extra.reply_markup.inline_keyboard[0][0].web_app.url).toBe('https://app.example.com');
  });
  test('updates chatId to the message chat id', async () => {
    const deps = makeBotDeps();
    deps.store['telegramUsers/42'] = { uid: 'u-tg-42', chatId: 'old' };
    deps.store['users/u-tg-42/presence'] = { code: 'AAAAAA', status: 'unavailable', availableUntil: null };
    await handleUpdate(deps, msgUpdate('/start'));
    expect(deps.store['telegramUsers/42/chatId']).toBe('42');
    expect(deps.store['telegramByUid/u-tg-42/chatId']).toBe('42');
  });
});

describe('handleUpdate: /status and /off', () => {
  test('/status 30m → available with future availableUntil + lastSeen', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    await handleUpdate(deps, msgUpdate('/status 30m'));
    expect(deps.update).toHaveBeenCalledWith(`users/${uid}/presence`, {
      status: 'available', availableUntil: 1_000_000 + 30 * 60000, lastSeen: 1_000_000,
    });
    expect(deps.tg.sendMessage).toHaveBeenCalled();
  });
  test('/status with no arg defaults to 60m', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    await handleUpdate(deps, msgUpdate('/status'));
    expect(deps.update).toHaveBeenCalledWith(`users/${uid}/presence`,
      expect.objectContaining({ availableUntil: 1_000_000 + 60 * 60000 }));
  });
  test('/status garbage → help reply, no write', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    await handleUpdate(deps, msgUpdate('/status whenever'));
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.tg.sendMessage.mock.calls[0][1]).toMatch(/like/i);
  });
  test('/off → unavailable, cleared availableUntil', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    await handleUpdate(deps, msgUpdate('/off'));
    expect(deps.update).toHaveBeenCalledWith(`users/${uid}/presence`, {
      status: 'unavailable', availableUntil: null, lastSeen: 1_000_000,
    });
  });
  test('command from an unknown tg user → open-app prompt, no presence write', async () => {
    const deps = makeBotDeps();
    await handleUpdate(deps, msgUpdate('/status 30m'));
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.tg.sendMessage.mock.calls[0][1]).toMatch(/open/i);
  });
});

describe('handleUpdate: /notifications and /help', () => {
  test('/notifications push and telegram set the channel; bad arg explains', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    await handleUpdate(deps, msgUpdate('/notifications push'));
    expect(deps.store[`userPrefs/${uid}/notifyChannel`]).toBe('push');
    await handleUpdate(deps, msgUpdate('/notifications telegram'));
    expect(deps.store[`userPrefs/${uid}/notifyChannel`]).toBe('telegram');
    deps.tg.sendMessage.mockClear();
    await handleUpdate(deps, msgUpdate('/notifications carrier-pigeon'));
    expect(deps.tg.sendMessage.mock.calls[0][1]).toMatch(/push|telegram/);
  });
  test('/help lists the commands', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    await handleUpdate(deps, msgUpdate('/help'));
    const text = deps.tg.sendMessage.mock.calls[0][1];
    for (const cmd of ['/status', '/off', '/who', '/knock', '/groups', '/notifications']) {
      expect(text).toContain(cmd);
    }
  });
  test('non-private chats and non-message updates are ignored', async () => {
    const deps = makeBotDeps();
    await handleUpdate(deps, { message: { text: '/help', from: { id: 42 }, chat: { id: -9, type: 'group' } } });
    await handleUpdate(deps, { edited_message: {} });
    await handleUpdate(deps, null);
    expect(deps.tg.sendMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npx jest test/telegram.test.js`
Expected: FAIL — `handleUpdate` / `parseDurationMinutes` not exported.

- [ ] **Step 3: Implement** (append to `functions/telegram.js`)

```js
import { ensureTelegramUser } from './telegram-auth.js';

// "30m", "2h", "1h30m", "90", "45 min" → minutes, clamped to 5..1440. null when unparseable.
export function parseDurationMinutes(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  const clamp = (m) => Math.max(5, Math.min(1440, m));
  if (/^\d+$/.test(s)) return clamp(parseInt(s, 10));
  const m = s.match(/^(?:(\d+)\s*h(?:rs?)?)?\s*(?:(\d+)\s*m(?:in)?s?)?$/);
  if (!m || (!m[1] && !m[2])) return null;
  return clamp(parseInt(m[1] || '0', 10) * 60 + parseInt(m[2] || '0', 10));
}

const HELP_TEXT = [
  'KnockKnock commands:',
  '/status [30m|2h] — go available (default 1h)',
  '/off — go unavailable',
  '/who — which of your people are available now',
  '/knock <name> — send a knock',
  '/groups — your groups',
  '/notifications push|telegram — where notifications go',
  '/help — this list',
].join('\n');

function openAppKeyboard(appUrl) {
  return appUrl ? { reply_markup: { inline_keyboard: [[{ text: 'Open KnockKnock', web_app: { url: appUrl } }]] } } : {};
}

// Entry point for every webhook update. Never throws (the webhook must always 200).
export async function handleUpdate(deps, update) {
  try {
    if (update?.message) await handleMessage(deps, update.message);
    else if (update?.callback_query) await handleCallback(deps, update.callback_query);
  } catch (e) {
    console.error('[telegram] handleUpdate error:', e);
  }
}

async function handleMessage(deps, msg) {
  if (msg.chat?.type !== 'private' || typeof msg.text !== 'string' || !msg.from) return;
  const chatId = String(msg.chat.id);
  const [cmdRaw, ...args] = msg.text.trim().split(/\s+/);
  const cmd = cmdRaw.toLowerCase().replace(/@.*$/, ''); // strip @botname suffix
  const reply = (text, extra = {}) => deps.tg.sendMessage(chatId, text, extra);

  if (cmd === '/start') {
    const { uid } = await ensureTelegramUser(deps, msg.from);
    // Keep the chat route current (first /start after a Mini-App-only signup,
    // or Telegram reassigning chat ids) — sendToUser reads telegramByUid.
    await deps.update(`telegramUsers/${String(msg.from.id)}`, { chatId });
    await deps.update(`telegramByUid/${uid}`, { chatId });
    await reply(
      'Welcome to KnockKnock — let the people who matter know when you\'re free.\n\n'
      + `${HELP_TEXT}\n\nThe full app (calls, drawing, palettes, groups) lives in the Mini App:`,
      openAppKeyboard(deps.appUrl),
    );
    return;
  }

  const mapping = await deps.getVal(`telegramUsers/${String(msg.from.id)}`);
  if (!mapping) {
    await reply('First, open the app once so I know who you are:', openAppKeyboard(deps.appUrl));
    return;
  }
  const uid = mapping.uid;

  switch (cmd) {
    case '/help':
      await reply(HELP_TEXT);
      return;
    case '/status': {
      const minutes = args.length ? parseDurationMinutes(args.join(' ')) : 60;
      if (minutes == null) {
        await reply('Give me a duration like "/status 30m" or "/status 2h".');
        return;
      }
      // Mirrors js/db/social.js setStatus exactly.
      await deps.update(`users/${uid}/presence`, {
        status: 'available',
        availableUntil: deps.now() + minutes * 60000,
        lastSeen: deps.now(),
      });
      await reply(`You're available for ${minutes >= 60 ? `${Math.round(minutes / 60 * 10) / 10}h` : `${minutes}m`}. /off to stop.`);
      return;
    }
    case '/off':
      // Mirrors js/db/social.js writeBackExpired + a lastSeen touch.
      await deps.update(`users/${uid}/presence`, { status: 'unavailable', availableUntil: null, lastSeen: deps.now() });
      await reply("You're unavailable.");
      return;
    case '/notifications': {
      const choice = (args[0] || '').toLowerCase();
      if (choice !== 'push' && choice !== 'telegram') {
        await reply('Use "/notifications telegram" or "/notifications push".');
        return;
      }
      await deps.update(`userPrefs/${uid}`, { notifyChannel: choice });
      await reply(choice === 'telegram' ? 'Notifications will arrive here.' : 'Notifications will use the app\'s push channel.');
      return;
    }
    case '/who':
    case '/knock':
    case '/groups':
      await handleSocialCommand(deps, uid, cmd, args, reply); // Task 7
      return;
    default:
      await reply(`I don't know that one.\n\n${HELP_TEXT}`);
  }
}

async function handleCallback(deps, cq) {
  // Implemented in Tasks 7–8.
  if (cq?.id) await deps.tg.answerCallbackQuery(cq.id, 'Not available yet.');
}

async function handleSocialCommand(deps, uid, cmd, args, reply) {
  // Implemented in Task 7.
  await reply('Not available yet.');
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npx jest test/telegram.test.js`
Expected: PASS (Tasks 7–8 stubs are exercised only by later tests).

- [ ] **Step 5: Commit**

```bash
git add functions/telegram.js functions/test/telegram.test.js
git commit -m "feat(telegram): bot router with /start /help /status /off /notifications"
```

---

### Task 7: Bot social commands — /who, /knock, /groups + knock callback

**Files:**
- Modify: `functions/telegram.js` (fill `handleSocialCommand`, extend `handleCallback`)
- Test: `functions/test/telegram.test.js` (append)

**Interfaces:**
- Consumes: deps shape from Task 6; `effectiveAvailable`, `isFutureMs` from `./presence-core.js`.
- Produces: callback protocol `knock:<targetUid>` (also used by notification keyboards from Task 5).

- [ ] **Step 1: Write the failing tests** (append to `functions/test/telegram.test.js`)

```js
describe('handleUpdate: /who', () => {
  test('lists available contacts, notes when nobody is', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`userPrefs/${uid}/following`] = {
      f1: { code: 'CODE01', label: 'Bea' },
      f2: { code: 'CODE02', label: 'Cal' },
    };
    deps.store['users/f1/presence'] = { status: 'available', availableUntil: 2_000_000 };
    deps.store['users/f2/presence'] = { status: 'unavailable', availableUntil: null };
    await handleUpdate(deps, msgUpdate('/who'));
    const text = deps.tg.sendMessage.mock.calls[0][1];
    expect(text).toContain('Bea');
    expect(text).not.toContain('Cal');

    deps.tg.sendMessage.mockClear();
    deps.store['users/f1/presence'] = { status: 'available', availableUntil: 500 }; // expired
    await handleUpdate(deps, msgUpdate('/who'));
    expect(deps.tg.sendMessage.mock.calls[0][1]).toMatch(/no one|nobody/i);
  });
});

describe('handleUpdate: /knock', () => {
  const following = { f1: { code: 'CODE01', label: 'Bea' }, f2: { code: 'CODE02', label: 'Beatrice' } };
  test('unique match → knock written with client shape', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`userPrefs/${uid}/following`] = { f1: following.f1 };
    await handleUpdate(deps, msgUpdate('/knock bea'));
    expect(deps.store[`knocks/f1/${uid}`]).toEqual({ count: 1, ts: 1_000_000 });
  });
  test('knock caps at 5 like the client transaction', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`userPrefs/${uid}/following`] = { f1: following.f1 };
    deps.store[`knocks/f1/${uid}`] = { count: 5, ts: 1 };
    await handleUpdate(deps, msgUpdate('/knock bea'));
    expect(deps.store[`knocks/f1/${uid}`].count).toBe(5);
  });
  test('ambiguous → inline keyboard of candidates', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`userPrefs/${uid}/following`] = following;
    await handleUpdate(deps, msgUpdate('/knock bea'));
    const extra = deps.tg.sendMessage.mock.calls[0][2];
    const buttons = extra.reply_markup.inline_keyboard.flat();
    expect(buttons).toEqual(expect.arrayContaining([
      { text: 'Bea', callback_data: 'knock:f1' },
      { text: 'Beatrice', callback_data: 'knock:f2' },
    ]));
  });
  test('no match / no arg → helpful reply', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`userPrefs/${uid}/following`] = following;
    await handleUpdate(deps, msgUpdate('/knock zed'));
    expect(deps.tg.sendMessage.mock.calls[0][1]).toMatch(/find/i);
    deps.tg.sendMessage.mockClear();
    await handleUpdate(deps, msgUpdate('/knock'));
    expect(deps.tg.sendMessage.mock.calls[0][1]).toMatch(/knock <name>/i);
  });
});

describe('handleUpdate: /groups', () => {
  test('lists groups with own effective in-group availability', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 }, G2: { lastVisited: 2 } };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store['groups/G2/name'] = 'Family';
    deps.store[`groups/G1/members/${uid}/statusOverride`] = { enabled: true, status: 'available', availableUntil: 2_000_000 };
    deps.store[`groups/G2/members/${uid}/statusOverride`] = { enabled: false };
    deps.store[`users/${uid}/presence`] = { code: 'AAAAAA', status: 'unavailable', availableUntil: null };
    await handleUpdate(deps, msgUpdate('/groups'));
    const text = deps.tg.sendMessage.mock.calls[0][1];
    expect(text).toMatch(/Divers — available/i);
    expect(text).toMatch(/Family — unavailable/i);
  });
  test('no groups → pointer to the app', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    await handleUpdate(deps, msgUpdate('/groups'));
    expect(deps.tg.sendMessage.mock.calls[0][1]).toMatch(/app/i);
  });
});

describe('callback: knock', () => {
  const cbUpdate = (data, from = { id: 42, first_name: 'Ada' }) =>
    ({ callback_query: { id: 'cb1', data, from } });
  test('writes the knock and confirms', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    await handleUpdate(deps, cbUpdate('knock:f9'));
    expect(deps.store[`knocks/f9/${uid}`]).toEqual({ count: 1, ts: 1_000_000 });
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringMatching(/knock/i));
  });
  test('unknown telegram user → prompted to open the app', async () => {
    const deps = makeBotDeps();
    await handleUpdate(deps, cbUpdate('knock:f9'));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringMatching(/open/i));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npx jest test/telegram.test.js`
Expected: FAIL — social commands reply "Not available yet."

- [ ] **Step 3: Implement**

In `functions/telegram.js`: add to the imports `import { isFutureMs, effectiveAvailable } from './presence-core.js';`, replace the `handleSocialCommand` stub and `handleCallback` with:

```js
// Same shape + cap as the client's writeKnock transaction (js/db/social.js).
async function writeKnock(deps, recipientUid, senderUid) {
  await deps.transaction(`knocks/${recipientUid}/${senderUid}`, (current) => {
    if (current === null) return { count: 1, ts: deps.now() };
    if (current.count >= 5) return undefined; // abort — capped
    const next = { count: current.count + 1, ts: deps.now() };
    if (current.contextGroupId) next.contextGroupId = current.contextGroupId;
    return next;
  });
}

async function readFollowing(deps, uid) {
  const data = (await deps.getVal(`userPrefs/${uid}/following`)) || {};
  return Object.entries(data).map(([fid, v]) => ({ userId: fid, code: v?.code ?? '', label: v?.label ?? '' }));
}

async function handleSocialCommand(deps, uid, cmd, args, reply) {
  if (cmd === '/who') {
    const following = await readFollowing(deps, uid);
    const lines = [];
    for (const entry of following) {
      const presence = await deps.getVal(`users/${entry.userId}/presence`);
      if (presence?.status === 'available' && isFutureMs(presence.availableUntil, deps.now())) {
        lines.push(`🟢 ${entry.label || entry.code}`);
      }
    }
    await reply(lines.length ? `Available now:\n${lines.join('\n')}` : 'No one is available right now.');
    return;
  }
  if (cmd === '/knock') {
    const query = args.join(' ').trim().toLowerCase();
    if (!query) { await reply('Usage: /knock <name>'); return; }
    const following = await readFollowing(deps, uid);
    const matches = following.filter((e) => (e.label || e.code).toLowerCase().includes(query));
    if (matches.length === 0) { await reply(`Couldn't find "${args.join(' ')}" among the people you follow.`); return; }
    if (matches.length > 1) {
      await reply('Which one?', { reply_markup: { inline_keyboard: matches.slice(0, 8).map((e) => [{ text: e.label || e.code, callback_data: `knock:${e.userId}` }]) } });
      return;
    }
    await writeKnock(deps, matches[0].userId, uid);
    await reply(`Knocked on ${matches[0].label || matches[0].code}.`);
    return;
  }
  if (cmd === '/groups') {
    const groups = (await deps.getVal(`users/${uid}/groups`)) || {};
    const groupIds = Object.keys(groups);
    if (!groupIds.length) { await reply('No groups yet — create one in the app.'); return; }
    const presence = await deps.getVal(`users/${uid}/presence`);
    const lines = [];
    for (const gid of groupIds) {
      const name = (await deps.getVal(`groups/${gid}/name`)) || gid;
      const override = await deps.getVal(`groups/${gid}/members/${uid}/statusOverride`);
      const on = effectiveAvailable(override, presence?.status, presence?.availableUntil, deps.now());
      lines.push(`${name} — ${on ? 'available' : 'unavailable'} (you)`);
    }
    await reply(lines.join('\n'));
  }
}

const LABEL_MAX = 40;
const clampName = (s) => String(s ?? '').slice(0, LABEL_MAX).trim();

async function handleCallback(deps, cq) {
  if (!cq?.id || !cq.from) return;
  const answer = (text) => deps.tg.answerCallbackQuery(cq.id, text);
  const mapping = await deps.getVal(`telegramUsers/${String(cq.from.id)}`);
  if (!mapping) { await answer('Open KnockKnock first.'); return; }
  const me = mapping.uid;
  const [action, arg] = String(cq.data || '').split(':');
  switch (action) {
    case 'knock':
      await writeKnock(deps, arg, me);
      await answer('Knock sent.');
      return;
    case 'invite_accept':
    case 'invite_decline':
    case 'fr_approve':
    case 'fr_decline':
      await handleInboxCallback(deps, me, action, arg, cq, answer); // Task 8
      return;
    default:
      await answer('Unknown action.');
  }
}

async function handleInboxCallback(deps, me, action, arg, cq, answer) {
  // Implemented in Task 8.
  await answer('Not available yet.');
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npx jest test/telegram.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/telegram.js functions/test/telegram.test.js
git commit -m "feat(telegram): /who /knock /groups + knock callback"
```

---

### Task 8: Inbox callbacks — invite accept/decline, follow-request approve/decline

**Files:**
- Modify: `functions/telegram.js` (fill `handleInboxCallback`)
- Test: `functions/test/telegram.test.js` (append)

**Interfaces:**
- Consumes: callback protocol from Tasks 5/7 (`invite_accept:<gid>`, `invite_decline:<gid>`, `fr_approve:<uid>`, `fr_decline:<uid>`); `clampName` from Task 7.
- Produces: RTDB writes mirroring `js/inbox.js` `handleJoin`/`handleDecline`/`handleApprove`/`handleFollowRequestDecline` (see comments for exact client counterparts).

- [ ] **Step 1: Write the failing tests** (append to `functions/test/telegram.test.js`)

```js
describe('inbox callbacks', () => {
  const cb = (data) => ({ callback_query: { id: 'cb1', data, from: { id: 42, first_name: 'Ada' } } });

  test('invite_accept: joins with Telegram first_name, default override, dual-deletes pending', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`pendingInvites/${uid}/G1`] = { from: 'inviter', ts: 1 };
    deps.store['groups/G1/name'] = 'Divers';
    await handleUpdate(deps, cb('invite_accept:G1'));
    expect(deps.store[`groups/G1/members/${uid}`]).toEqual({
      role: 'member', displayName: 'Ada', joinedAt: 1_000_000,
      statusOverride: { enabled: true, status: 'available', availableUntil: 1_000_000 + 2 * 60 * 60 * 1000 },
    });
    expect(deps.store[`users/${uid}/groups/G1`]).toEqual({ lastVisited: 1_000_000 });
    expect(deps.store[`pendingInvites/${uid}/G1`]).toBeNull();
    expect(deps.store[`pendingInvitesByGroup/G1/${uid}`]).toBeNull();
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringContaining('Divers'));
  });
  test('invite_accept when already a member → just clears the pending invite', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`pendingInvites/${uid}/G1`] = { from: 'inviter', ts: 1 };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store[`groups/G1/members/${uid}`] = { role: 'member', displayName: 'Old' };
    await handleUpdate(deps, cb('invite_accept:G1'));
    expect(deps.store[`groups/G1/members/${uid}`].displayName).toBe('Old');
    expect(deps.store[`pendingInvites/${uid}/G1`]).toBeNull();
  });
  test('invite_accept when group is gone → clears pending, says so', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`pendingInvites/${uid}/G1`] = { from: 'inviter', ts: 1 };
    await handleUpdate(deps, cb('invite_accept:G1'));
    expect(deps.store[`pendingInvites/${uid}/G1`]).toBeNull();
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringMatching(/no longer/i));
  });
  test('invite_decline → dual-delete only', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`pendingInvites/${uid}/G1`] = { from: 'inviter', ts: 1 };
    await handleUpdate(deps, cb('invite_decline:G1'));
    expect(deps.store[`pendingInvites/${uid}/G1`]).toBeNull();
    expect(deps.store[`groups/G1/members/${uid}`]).toBeUndefined();
  });
  test('fr_approve: writes grant with code + group display name, deletes request', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`followRequests/${uid}/req1`] = { from: 'req1', groupId: 'G1', ts: 1 };
    deps.store[`groups/G1/members/${uid}/displayName`] = 'Captain Ada';
    await handleUpdate(deps, cb('fr_approve:req1'));
    expect(deps.store[`followGrants/req1/${uid}`]).toEqual({
      from: uid, code: 'AAAAAA', name: 'Captain Ada', ts: 1_000_000,
    });
    expect(deps.store[`followRequests/${uid}/req1`]).toBeNull();
  });
  test('fr_approve on a vanished request → polite no-op', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    await handleUpdate(deps, cb('fr_approve:req1'));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringMatching(/gone|expired/i));
  });
  test('fr_decline → deletes the request', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`followRequests/${uid}/req1`] = { from: 'req1', ts: 1 };
    await handleUpdate(deps, cb('fr_decline:req1'));
    expect(deps.store[`followRequests/${uid}/req1`]).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npx jest test/telegram.test.js`
Expected: FAIL — inbox callbacks answer "Not available yet."

- [ ] **Step 3: Implement** — replace the `handleInboxCallback` stub in `functions/telegram.js`:

```js
async function handleInboxCallback(deps, me, action, arg, cq, answer) {
  if (action === 'invite_accept' || action === 'invite_decline') {
    const groupId = arg;
    const clearPending = () => Promise.all([
      deps.set(`pendingInvites/${me}/${groupId}`, null),
      deps.set(`pendingInvitesByGroup/${groupId}/${me}`, null),
    ]);
    if (action === 'invite_decline') { await clearPending(); await answer('Declined.'); return; }
    const pending = await deps.getVal(`pendingInvites/${me}/${groupId}`);
    if (!pending) { await answer('This invite is gone.'); return; }
    // Race checks mirror js/inbox.js handleJoin: already-member and deleted-group
    // both just clear the pending invite.
    const [existing, name] = await Promise.all([
      deps.getVal(`groups/${groupId}/members/${me}`),
      deps.getVal(`groups/${groupId}/name`),
    ]);
    if (existing) { await clearPending(); await answer("You're already in that group."); return; }
    if (!name) { await clearPending(); await answer('That group no longer exists.'); return; }
    // Join mirrors js/groups.js joinGroup (fresh membership branch): the display
    // name is the Telegram first name (the bot has no prompt UI); editable later
    // in the app.
    const now = deps.now();
    await deps.set(`groups/${groupId}/members/${me}`, {
      role: 'member',
      displayName: clampName(cq.from.first_name) || 'Someone',
      joinedAt: now,
      statusOverride: { enabled: true, status: 'available', availableUntil: now + 2 * 60 * 60 * 1000 },
    });
    await deps.set(`users/${me}/groups/${groupId}`, { lastVisited: now });
    await clearPending();
    await answer(`Joined ${name}.`);
    return;
  }
  if (action === 'fr_approve' || action === 'fr_decline') {
    const requesterUid = arg;
    if (action === 'fr_decline') {
      await deps.set(`followRequests/${me}/${requesterUid}`, null);
      await answer('Declined.');
      return;
    }
    const request = await deps.getVal(`followRequests/${me}/${requesterUid}`);
    if (!request) { await answer('This request is gone.'); return; }
    // Mirrors js/inbox.js handleApprove: grant carries my share code + my display
    // name in the shared group; the requester's grant-watcher completes the follow.
    const [myCode, myName] = await Promise.all([
      deps.getVal(`users/${me}/presence/code`),
      request.groupId ? deps.getVal(`groups/${request.groupId}/members/${me}/displayName`) : Promise.resolve(null),
    ]);
    await deps.set(`followGrants/${requesterUid}/${me}`, {
      from: me, code: myCode || '', name: myName ?? null, ts: deps.now(),
    });
    await deps.set(`followRequests/${me}/${requesterUid}`, null);
    await answer('Approved.');
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npx jest`
Expected: PASS (whole functions suite).

- [ ] **Step 5: Commit**

```bash
git add functions/telegram.js functions/test/telegram.test.js
git commit -m "feat(telegram): invite + follow-request callbacks from bot notifications"
```

---

### Task 9: Webhook endpoint + env example + rules

**Files:**
- Modify: `functions/telegram.js` (webhook auth helper), `functions/index.js` (endpoint), `functions/.env.example` (if present; else create), `database.rules.json`
- Test: `functions/test/telegram.test.js` (append), `tests/rules/telegram.test.js` (new)

**Interfaces:**
- Produces: `webhookAuthorized(headerValue, secret) → boolean` (exported from `functions/telegram.js`); HTTPS function `telegramWebhook`; rules for `telegramUsers`, `telegramByUid`, `userPrefs/$uid/notifyChannel`.

- [ ] **Step 1: Write the failing tests**

Append to `functions/test/telegram.test.js`:

```js
import { webhookAuthorized } from '../telegram.js';

describe('webhookAuthorized', () => {
  test('exact secret match only; unset secret always refuses', () => {
    expect(webhookAuthorized('s3cret', 's3cret')).toBe(true);
    expect(webhookAuthorized('wrong', 's3cret')).toBe(false);
    expect(webhookAuthorized(undefined, 's3cret')).toBe(false);
    expect(webhookAuthorized('', '')).toBe(false);
    expect(webhookAuthorized('anything', undefined)).toBe(false);
  });
});
```

Create `tests/rules/telegram.test.js`:

```js
// tests/rules/telegram.test.js — server-only Telegram nodes + notifyChannel validation.
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { makeTestEnv, dbAs, seed } = require('./helpers');

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

test('telegramUsers / telegramByUid: no client read or write, even for the mapped user', async () => {
  await seed(env, (db) => db.ref('telegramUsers/42').set({ uid: 'u1', chatId: '42' }));
  await seed(env, (db) => db.ref('telegramByUid/u1').set({ tgId: '42', chatId: '42' }));
  await assertFails(dbAs(env, 'u1').ref('telegramUsers/42').get());
  await assertFails(dbAs(env, 'u1').ref('telegramUsers/42/chatId').set('666'));
  await assertFails(dbAs(env, 'u1').ref('telegramByUid/u1').get());
  await assertFails(dbAs(env, 'u1').ref('telegramByUid/u1/chatId').set('666'));
});

test('notifyChannel: owner can set push/telegram; other values rejected; stranger rejected', async () => {
  await assertSucceeds(dbAs(env, 'u1').ref('userPrefs/u1/notifyChannel').set('telegram'));
  await assertSucceeds(dbAs(env, 'u1').ref('userPrefs/u1/notifyChannel').set('push'));
  await assertFails(dbAs(env, 'u1').ref('userPrefs/u1/notifyChannel').set('smoke-signals'));
  await assertFails(dbAs(env, 'stranger').ref('userPrefs/u1/notifyChannel').set('push'));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npx jest test/telegram.test.js` → FAIL (`webhookAuthorized` missing).
Run: `npm run test:rules` → the notifyChannel invalid-value assertion FAILS (no validation yet). If the emulator can't run in this environment, note it and proceed — CI covers it.

- [ ] **Step 3: Implement**

Append to `functions/telegram.js`:

```js
// Constant-shape check of Telegram's X-Telegram-Bot-Api-Secret-Token header.
// An unset secret refuses everything — the webhook is dead until configured.
export function webhookAuthorized(headerValue, secret) {
  return !!secret && typeof headerValue === 'string' && headerValue === secret;
}
```

In `functions/index.js` add (with `onRequest` added to the existing `firebase-functions/v2/https` import):

```js
import { handleUpdate, webhookAuthorized } from './telegram.js';

// Telegram bot webhook. Always 200s on authorized requests (Telegram retries
// non-200s aggressively); errors are logged inside handleUpdate. Inert unless
// TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET are configured.
export const telegramWebhook = onRequest(async (req, res) => {
  if (!process.env.TELEGRAM_BOT_TOKEN
      || !webhookAuthorized(req.get('x-telegram-bot-api-secret-token'), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    res.status(403).send('forbidden');
    return;
  }
  await handleUpdate({
    getVal: async (path) => (await db.ref(path).get()).val(),
    set: async (path, value) => { await db.ref(path).set(value); },
    update: async (path, obj) => { await db.ref(path).update(obj); },
    transaction: async (path, fn) => {
      const r = await db.ref(path).transaction(fn);
      return { committed: r.committed };
    },
    now: () => Date.now(),
    appUrl: process.env.TELEGRAM_APP_URL || '',
    tg: {
      sendMessage: (chatId, text, extra = {}) => tgApi('sendMessage', { chat_id: chatId, text, ...extra }),
      answerCallbackQuery: (id, text) => tgApi('answerCallbackQuery', { callback_query_id: id, text }),
    },
  }, req.body);
  res.status(200).send('ok');
});
```

In `functions/.env.example` append (create the file with just these lines plus the existing `FUNCTIONS_REGION` example if it doesn't exist):

```
# Telegram bot (experimental). All three must be set for the bot to be active;
# leave unset to keep the Telegram surface fully inert.
# TELEGRAM_BOT_TOKEN=123456:ABC-DEF...   (from @BotFather)
# TELEGRAM_WEBHOOK_SECRET=<random string, also passed to setWebhook>
# TELEGRAM_APP_URL=https://your-app.web.app
```

In `database.rules.json`:
1. After the `"notifierState"` line add:

```json
    "telegramUsers": { ".read": false, ".write": false },
    "telegramByUid": { ".read": false, ".write": false },
```

2. Inside `"userPrefs": { "$uid": { ... } }`, add a child rule alongside `.read`/`.write`:

```json
        "notifyChannel": { ".validate": "newData.isString() && (newData.val() === 'push' || newData.val() === 'telegram')" }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npm test` → PASS.
Run: `npm run test:rules` → PASS (or note emulator unavailability).

- [ ] **Step 5: Commit**

```bash
git add functions/telegram.js functions/index.js functions/.env.example database.rules.json tests/rules/telegram.test.js functions/test/telegram.test.js
git commit -m "feat(telegram): webhook endpoint, env template, server-only rules for telegram nodes"
```

---

### Task 10: Client — callable wrappers + js/telegram.js adapter

**Files:**
- Modify: `js/firebase-config.js`, `js/auth.js` (export `whenRtdbAuthReady`)
- Create: `js/telegram.js`
- Test: `tests/telegram.test.js`

**Interfaces:**
- Consumes: `TELEGRAM_ENABLED` (Task 1); callables (Task 4); `getUser` from `./db.js`.
- Produces (consumed by Tasks 11–12):
  - `callValidateTelegram(initData) → { token, uid, linked, created }`, `callLinkTelegram(initData, code) → { token }`, `callUnlinkTelegram(initData) → { token }` (from `js/firebase-config.js`)
  - `tgWebApp() → Telegram.WebApp | null`, `isTelegramContext() → boolean`, `initTelegramChrome()`, `telegramLinkState() → { linked } | null`, `ensureTelegramIdentity() → { identity: { userId, code, recoveryCode: null }, isNew }` (from `js/telegram.js`)
  - `whenRtdbAuthReady()` exported from `js/auth.js`.

- [ ] **Step 1: Write the failing tests**

Create `tests/telegram.test.js`:

```js
// tests/telegram.test.js — Telegram Mini App adapter (js/telegram.js).
jest.mock('../js/features.js', () => ({ TELEGRAM_ENABLED: true }));
jest.mock('../js/firebase-config.js', () => ({
  auth: { currentUser: { uid: 'tg-uid' } },
  callValidateTelegram: jest.fn(async () => ({ token: 'tok', uid: 'tg-uid', linked: false, created: true })),
}));
jest.mock('firebase/auth', () => ({ signInWithCustomToken: jest.fn(async () => {}) }));
jest.mock('../js/auth.js', () => ({ whenRtdbAuthReady: jest.fn(async () => {}) }));
jest.mock('../js/db.js', () => ({ getUser: jest.fn(async () => ({ code: 'AAAAAA' })) }));

const { signInWithCustomToken } = require('firebase/auth');
const { callValidateTelegram } = require('../js/firebase-config.js');

function setTelegramGlobal(initData = 'query_id=1&hash=abc') {
  window.Telegram = {
    WebApp: {
      initData,
      ready: jest.fn(), expand: jest.fn(),
      setHeaderColor: jest.fn(), setBackgroundColor: jest.fn(),
    },
  };
}

beforeEach(() => { jest.resetModules(); delete window.Telegram; });

test('isTelegramContext: true only with flag AND non-empty initData', () => {
  setTelegramGlobal();
  expect(require('../js/telegram.js').isTelegramContext()).toBe(true);
  jest.resetModules();
  setTelegramGlobal('');
  expect(require('../js/telegram.js').isTelegramContext()).toBe(false);
  jest.resetModules();
  delete window.Telegram;
  expect(require('../js/telegram.js').isTelegramContext()).toBe(false);
});

test('flag off → never telegram context', () => {
  jest.doMock('../js/features.js', () => ({ TELEGRAM_ENABLED: false }));
  setTelegramGlobal();
  expect(require('../js/telegram.js').isTelegramContext()).toBe(false);
});

test('ensureTelegramIdentity: validates, signs in, returns identity with code and isNew', async () => {
  setTelegramGlobal();
  const tg = require('../js/telegram.js');
  const res = await tg.ensureTelegramIdentity();
  expect(callValidateTelegram).toHaveBeenCalledWith('query_id=1&hash=abc');
  expect(signInWithCustomToken).toHaveBeenCalled();
  expect(res).toEqual({ identity: { userId: 'tg-uid', code: 'AAAAAA', recoveryCode: null }, isNew: true });
  expect(tg.telegramLinkState()).toEqual({ linked: false });
});

test('initTelegramChrome: calls ready + expand, tolerates missing APIs', () => {
  setTelegramGlobal();
  const tg = require('../js/telegram.js');
  tg.initTelegramChrome();
  expect(window.Telegram.WebApp.ready).toHaveBeenCalled();
  expect(window.Telegram.WebApp.expand).toHaveBeenCalled();
  delete window.Telegram.WebApp.setHeaderColor;
  expect(() => tg.initTelegramChrome()).not.toThrow();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/telegram.test.js`
Expected: FAIL — `js/telegram.js` missing.

- [ ] **Step 3: Implement**

In `js/auth.js`, change `async function whenRtdbAuthReady()` to `export async function whenRtdbAuthReady()`.

In `js/firebase-config.js`, after the `_resolveInvitePreview` lines add:

```js
const _validateTelegram = httpsCallable(_functions, 'validateTelegram');
const _linkTelegram = httpsCallable(_functions, 'linkTelegram');
const _unlinkTelegram = httpsCallable(_functions, 'unlinkTelegram');

// Telegram Mini App auth (experimental — spec 2026-07-02). initData is the raw
// signed string from Telegram.WebApp; the server verifies it and mints a token.
export async function callValidateTelegram(initData) {
  const { data } = await _validateTelegram({ initData });
  return data; // { token, uid, linked, created }
}
export async function callLinkTelegram(initData, code) {
  const { data } = await _linkTelegram({ initData, code });
  return data; // { token }
}
export async function callUnlinkTelegram(initData) {
  const { data } = await _unlinkTelegram({ initData });
  return data; // { token }
}
```

Create `js/telegram.js`:

```js
// js/telegram.js — Telegram Mini App adapter (experimental, TELEGRAM_ENABLED).
// Detection + boot auth. Inside Telegram we ALWAYS auth from the webview's
// signed initData (never the stored local session): zero friction, always
// fresh, immune to webview-storage quirks. See spec 2026-07-02.
import { signInWithCustomToken } from 'firebase/auth';
import { TELEGRAM_ENABLED } from './features.js';
import { auth, callValidateTelegram } from './firebase-config.js';
import { whenRtdbAuthReady } from './auth.js';
import { getUser } from './db.js';

export function tgWebApp() {
  return (typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp) || null;
}

export function isTelegramContext() {
  return TELEGRAM_ENABLED && !!tgWebApp()?.initData;
}

// Telegram chrome: signal readiness, take the full viewport, and match the
// webview header/background to the app background. App theming stays the
// app's own — palettes are the product; only the chrome color is synced.
export function initTelegramChrome() {
  const wa = tgWebApp();
  if (!wa) return;
  try {
    wa.ready();
    wa.expand();
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (bg) {
      wa.setHeaderColor?.(bg);
      wa.setBackgroundColor?.(bg);
    }
  } catch { /* chrome sugar must never block boot */ }
}

let _linkState = null;
// { linked } from the last ensureTelegramIdentity() — telegramSettings reads it.
export function telegramLinkState() {
  return _linkState;
}

// Boot auth for the Telegram context. Returns the same { identity, isNew }
// shape app.js's ensureIdentity produces; recoveryCode is null (a Telegram-
// derived account has no phrase until the user links one).
export async function ensureTelegramIdentity() {
  const { token, linked, created } = await callValidateTelegram(tgWebApp().initData);
  await signInWithCustomToken(auth, token);
  await whenRtdbAuthReady();
  _linkState = { linked };
  const userId = auth.currentUser.uid;
  const user = await getUser(userId); // presence is bootstrapped server-side
  return { identity: { userId, code: user?.code ?? '', recoveryCode: null }, isNew: created === true };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/telegram.test.js`
Expected: PASS.

- [ ] **Step 5: Full web suite**

Run: `npx jest`
Expected: PASS (the `auth.js` export change is additive; `tests/auth.test.js` must stay green).

- [ ] **Step 6: Commit**

```bash
git add js/firebase-config.js js/auth.js js/telegram.js tests/telegram.test.js
git commit -m "feat(telegram): client adapter — context detection + initData boot auth"
```

---

### Task 11: Client — app.js boot integration

**Files:**
- Modify: `js/app.js`
- Test: existing suites (`npx jest`) — this task is wiring; its pieces are unit-tested in Tasks 10 and 12.

**Interfaces:**
- Consumes: `isTelegramContext`, `ensureTelegramIdentity`, `initTelegramChrome` (Task 10); `initTelegramSettings` (Task 12 — stub import added here, module created next task; to keep this task green, add the import in Task 12 instead. This task only gates existing calls and adds the telegram identity branch).

- [ ] **Step 1: Add the imports**

In `js/app.js`, after the `installGuidance.js` import line add:

```js
import { isTelegramContext, ensureTelegramIdentity, initTelegramChrome } from './telegram.js';
```

- [ ] **Step 2: Telegram identity branch**

At the very top of `ensureIdentity(pendingInviteToken = null)` (before `const existing = loadIdentity();`) add:

```js
  // Telegram Mini App: identity comes from the webview's signed initData —
  // no welcome/restore/phrase screens, no localStorage session. Invite links
  // don't reach this surface (the Mini App is opened from the bot, not from
  // an invite URL), so the pendingInviteToken flow stays browser-only.
  if (isTelegramContext()) return await ensureTelegramIdentity();
```

- [ ] **Step 3: Gate the browser-only affordances in `main()`**

1. Directly after `const { identity, isNew } = await ensureIdentity(pendingInviteToken);` add:

```js
  if (isTelegramContext()) initTelegramChrome();
```

2. Replace the line `initInstallAffordance();` and the line `initPushNotifications(userId);` with:

```js
  // Inside Telegram: no PWA install (webview) and no Web Push (notifications
  // arrive via the bot instead) — see js/telegramSettings.js for the channel UI.
  if (!isTelegramContext()) {
    initInstallAffordance();
    initPushNotifications(userId);
  }
```

3. Replace the final line of `main()` — `initServiceWorker();` — with:

```js
  // No SW inside Telegram: no offline-shell need in the webview, and the
  // update-reload cycle fights Telegram's own webview lifecycle.
  if (!isTelegramContext()) initServiceWorker();
```

- [ ] **Step 4: Run the full web suite**

Run: `npx jest`
Expected: PASS — outside Telegram nothing changed (`isTelegramContext()` is false in jsdom without `window.Telegram`), and app boot tests exercise that path.

- [ ] **Step 5: Commit**

```bash
git add js/app.js
git commit -m "feat(telegram): boot via Telegram identity; gate install/push/SW in the webview"
```

---

### Task 12: Client — Telegram settings (link, unlink, channel toggle)

**Files:**
- Create: `js/telegramSettings.js`
- Modify: `js/app.js` (one call), `css/app.css` (row styling)
- Test: `tests/telegramSettings.test.js`

**Interfaces:**
- Consumes: `tgWebApp`, `telegramLinkState` (Task 10); `callLinkTelegram`, `callUnlinkTelegram` (Task 10); `getUserPrefs`, `mergeUserPrefs` from `./db.js`; `parseRecoveryCode` from `./identity.js`; the existing `#restore-screen` markup (reused for phrase entry with our own handlers).
- Produces: `initTelegramSettings(userId)` — appends `#tg-settings-row` to `#code-drawer .drawer-inner`, hides `#recovery-pill-row`.

- [ ] **Step 1: Write the failing tests**

Create `tests/telegramSettings.test.js`:

```js
// tests/telegramSettings.test.js — Telegram drawer settings row.
jest.mock('../js/telegram.js', () => ({
  tgWebApp: () => ({ initData: 'signed-init-data' }),
  telegramLinkState: jest.fn(() => ({ linked: false })),
}));
jest.mock('../js/firebase-config.js', () => ({
  callLinkTelegram: jest.fn(async () => ({ token: 't' })),
  callUnlinkTelegram: jest.fn(async () => ({ token: 't' })),
}));
jest.mock('../js/db.js', () => ({
  getUserPrefs: jest.fn(async () => ({ notifyChannel: 'telegram' })),
  mergeUserPrefs: jest.fn(async () => {}),
}));

const { telegramLinkState } = require('../js/telegram.js');
const { callLinkTelegram, callUnlinkTelegram } = require('../js/firebase-config.js');
const { mergeUserPrefs } = require('../js/db.js');

const flush = () => new Promise((r) => setTimeout(r, 0));

function mountDom() {
  document.body.innerHTML = `
    <div id="code-drawer"><div class="drawer-inner"></div></div>
    <div id="recovery-pill-row"></div>
    <div id="restore-screen" class="hidden">
      <form id="restore-form"><input id="restore-input" />
        <p id="restore-error" class="hidden"></p>
        <button id="restore-submit-btn" type="submit"></button>
        <button id="restore-cancel-btn" type="button"></button>
      </form>
    </div>`;
}

beforeEach(() => { jest.clearAllMocks(); jest.resetModules(); mountDom(); });

test('renders row, hides phrase pill, shows link button when unlinked', async () => {
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  expect(document.getElementById('recovery-pill-row').classList.contains('hidden')).toBe(true);
  expect(document.getElementById('tg-link-btn').classList.contains('hidden')).toBe(false);
  expect(document.getElementById('tg-unlink-btn').classList.contains('hidden')).toBe(true);
  expect(document.getElementById('tg-channel-btn').textContent).toMatch(/Telegram/);
});

test('linked state shows unlink instead; unlink calls the callable', async () => {
  telegramLinkState.mockReturnValue({ linked: true });
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  expect(document.getElementById('tg-link-btn').classList.contains('hidden')).toBe(true);
  const unlinkBtn = document.getElementById('tg-unlink-btn');
  expect(unlinkBtn.classList.contains('hidden')).toBe(false);
  unlinkBtn.click();
  await flush();
  expect(callUnlinkTelegram).toHaveBeenCalledWith('signed-init-data');
});

test('channel toggle flips telegram → push and persists', async () => {
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  const btn = document.getElementById('tg-channel-btn');
  btn.click();
  await flush();
  expect(mergeUserPrefs).toHaveBeenCalledWith('u1', { notifyChannel: 'push' });
  expect(btn.textContent).toMatch(/Push/);
});

test('link flow: opens restore screen, validates phrase, calls linkTelegram', async () => {
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  document.getElementById('tg-link-btn').click();
  const screen = document.getElementById('restore-screen');
  expect(screen.classList.contains('hidden')).toBe(false);
  // Invalid phrase → inline error, no call.
  document.getElementById('restore-input').value = 'not a phrase';
  document.getElementById('restore-submit-btn').click();
  await flush();
  expect(callLinkTelegram).not.toHaveBeenCalled();
  expect(document.getElementById('restore-error').classList.contains('hidden')).toBe(false);
  // Valid phrase → callable hit. (Words are from the EFF list — parseRecoveryCode checks WORDSET.)
  document.getElementById('restore-input').value = 'abacus-abdomen-abdominal-abide';
  document.getElementById('restore-submit-btn').click();
  await flush();
  expect(callLinkTelegram).toHaveBeenCalledWith('signed-init-data', 'abacus-abdomen-abdominal-abide');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/telegramSettings.test.js`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `js/telegramSettings.js`:

```js
// js/telegramSettings.js — Telegram-context drawer row: account linking and
// the notification-channel toggle. Only mounted when isTelegramContext().
// The phrase pill is hidden here: a Telegram-derived account has no phrase,
// and a linked account's phrase lives with the user already.
import { tgWebApp, telegramLinkState } from './telegram.js';
import { callLinkTelegram, callUnlinkTelegram } from './firebase-config.js';
import { getUserPrefs, mergeUserPrefs } from './db.js';
import { parseRecoveryCode } from './identity.js';

export function initTelegramSettings(userId) {
  const drawer = document.querySelector('#code-drawer .drawer-inner');
  if (!drawer) return;
  document.getElementById('recovery-pill-row')?.classList.add('hidden');

  const linked = telegramLinkState()?.linked === true;
  const row = document.createElement('div');
  row.id = 'tg-settings-row';
  row.className = 'tg-settings-row';
  row.innerHTML = `
    <p id="tg-link-state" class="hint">${linked
      ? 'This Telegram is linked to your KnockKnock account.'
      : 'Using your Telegram identity. Have an account already?'}</p>
    <div class="tg-settings-btns">
      <button id="tg-link-btn" class="ghost-btn${linked ? ' hidden' : ''}" type="button">I have a secret phrase</button>
      <button id="tg-unlink-btn" class="ghost-btn${linked ? '' : ' hidden'}" type="button">Unlink account</button>
      <button id="tg-channel-btn" class="chip" type="button">Notifications: Telegram</button>
    </div>`;
  drawer.appendChild(row);

  wireChannelToggle(userId, row.querySelector('#tg-channel-btn'));
  row.querySelector('#tg-link-btn').addEventListener('click', showLinkScreen);
  row.querySelector('#tg-unlink-btn').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await callUnlinkTelegram(tgWebApp().initData);
      window.location.reload(); // reboot as the derived account
    } catch {
      e.target.disabled = false;
    }
  });
}

async function wireChannelToggle(userId, btn) {
  // Default is 'telegram' in this context (set server-side on mapping creation).
  let channel = 'telegram';
  try {
    if ((await getUserPrefs(userId))?.notifyChannel === 'push') channel = 'push';
  } catch { /* offline — assume default */ }
  const render = () => { btn.textContent = channel === 'telegram' ? 'Notifications: Telegram' : 'Notifications: Push'; };
  render();
  btn.addEventListener('click', async () => {
    const prev = channel;
    channel = channel === 'telegram' ? 'push' : 'telegram';
    render();
    try {
      await mergeUserPrefs(userId, { notifyChannel: channel });
    } catch {
      channel = prev; // revert on write failure
      render();
    }
  });
}

// Reuse the #restore-screen markup for phrase entry, with our own handlers:
// instead of validateRecovery sign-in (js/app.js showRestoreScreen), the phrase
// goes to linkTelegram, which repoints the Telegram mapping and rate-limits
// attempts server-side. On success we reload — boot re-auths via initData
// straight into the linked account.
function showLinkScreen() {
  const el = document.getElementById('restore-screen');
  const input = document.getElementById('restore-input');
  const error = document.getElementById('restore-error');
  const submit = document.getElementById('restore-submit-btn');
  const cancel = document.getElementById('restore-cancel-btn');
  const form = document.getElementById('restore-form');
  if (!el) return;
  input.value = '';
  error.textContent = '';
  error.classList.add('hidden');
  submit.textContent = 'Link account';
  submit.disabled = false;
  el.classList.remove('hidden');

  const showError = (msg) => { error.textContent = msg; error.classList.remove('hidden'); };
  const onFormSubmit = (e) => e.preventDefault();
  async function onSubmit() {
    const normalized = parseRecoveryCode(input.value);
    if (!normalized) { showError("That doesn't look like a secret phrase."); return; }
    submit.disabled = true;
    submit.textContent = 'Linking…';
    try {
      await callLinkTelegram(tgWebApp().initData, normalized);
    } catch (e) {
      submit.disabled = false;
      submit.textContent = 'Link account';
      showError(/not-found/.test(e?.code || '') ? 'No account found with that phrase.' : "Couldn't link right now. Try again.");
      return;
    }
    teardown();
    window.location.reload(); // reboot via initData into the linked account
  }
  function onCancel() { teardown(); }
  function teardown() {
    submit.removeEventListener('click', onSubmit);
    cancel.removeEventListener('click', onCancel);
    if (form) form.removeEventListener('submit', onFormSubmit);
    el.classList.add('hidden');
  }
  submit.addEventListener('click', onSubmit);
  cancel.addEventListener('click', onCancel);
  if (form) form.addEventListener('submit', onFormSubmit);
}
```

Note for the jsdom test: `window.location.reload` throws in jsdom — if the unlink test fails on it, stub it in the test with `Object.defineProperty(window, 'location', { value: { ...window.location, reload: jest.fn() }, writable: true });` inside `mountDom()`.

In `js/app.js`: add to the imports `import { initTelegramSettings } from './telegramSettings.js';` and directly after the `initCodeDrawer(userId, code);` line add:

```js
  if (isTelegramContext()) initTelegramSettings(userId);
```

In `css/app.css` append:

```css
/* Telegram Mini App settings row (drawer) */
.tg-settings-row { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.tg-settings-btns { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/telegramSettings.test.js` then `npx jest`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add js/telegramSettings.js js/app.js css/app.css tests/telegramSettings.test.js
git commit -m "feat(telegram): drawer settings — link/unlink account, notification channel toggle"
```

---

### Task 12b: Invite links via Telegram's share sheet

**Files:**
- Modify: `js/telegram.js`, `js/inviteModal.js`, `index.template.html`
- Test: `tests/telegram.test.js` (append)

**Interfaces:**
- Consumes: `tgWebApp`, `isTelegramContext` (Task 10); invite modal's `currentInvite.url` state and its `on()` wiring helper (`js/inviteModal.js:156-164` copy handler shows both).
- Produces: `openTelegramShare(url, text?)` exported from `js/telegram.js`; a `#invite-modal-share-btn` shown only in Telegram context.

- [ ] **Step 1: Write the failing test** (append to `tests/telegram.test.js`)

```js
test('openTelegramShare builds a t.me share link and opens it in Telegram', () => {
  setTelegramGlobal();
  window.Telegram.WebApp.openTelegramLink = jest.fn();
  const tg = require('../js/telegram.js');
  tg.openTelegramShare('https://app.example.com/?i=TOK123', 'Follow me');
  expect(window.Telegram.WebApp.openTelegramLink).toHaveBeenCalledWith(
    `https://t.me/share/url?url=${encodeURIComponent('https://app.example.com/?i=TOK123')}&text=${encodeURIComponent('Follow me')}`,
  );
  // Missing API → silent no-op.
  delete window.Telegram.WebApp.openTelegramLink;
  expect(() => tg.openTelegramShare('https://x.example')).not.toThrow();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/telegram.test.js`
Expected: FAIL — `openTelegramShare` not exported.

- [ ] **Step 3: Implement**

Append to `js/telegram.js`:

```js
// Open Telegram's native share sheet for a link (invite links, share code).
// Silent no-op outside Telegram or on old clients without openTelegramLink.
export function openTelegramShare(url, text = '') {
  const wa = tgWebApp();
  if (!wa?.openTelegramLink) return;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}${text ? `&text=${encodeURIComponent(text)}` : ''}`;
  wa.openTelegramLink(shareUrl);
}
```

In `index.template.html`, inside the invite modal's manage state, after the `invite-modal-copy-btn` button add:

```html
          <button id="invite-modal-share-btn" class="ghost-btn hidden">Share</button>
```

In `js/inviteModal.js`: add `import { isTelegramContext, openTelegramShare } from './telegram.js';` to the imports, and directly after the existing copy-button `on(...)` wiring (the block at the current `invite-modal-copy-btn` handler) add:

```js
  // Telegram context: native share sheet next to Copy (clipboard still works).
  const shareBtn = document.getElementById('invite-modal-share-btn');
  if (shareBtn && isTelegramContext()) {
    shareBtn.classList.remove('hidden');
    on(shareBtn, 'click', () => {
      if (currentInvite) openTelegramShare(currentInvite.url, 'Follow me on KnockKnock');
    });
  }
```

(Adapt the variable name if the modal's state variable differs — it is `currentInvite` at `js/inviteModal.js:161`.)

- [ ] **Step 4: Run to verify pass**

Run: `npx jest`
Expected: PASS (full web suite — inviteModal tests must stay green; outside Telegram the button stays hidden).

- [ ] **Step 5: Commit**

```bash
git add js/telegram.js js/inviteModal.js index.template.html tests/telegram.test.js
git commit -m "feat(telegram): share invite links via Telegram share sheet"
```

---

### Task 13: Docs + spec touch-up + final verification

**Files:**
- Create: `docs/telegram-setup.md`
- Modify: `docs/superpowers/specs/2026-07-02-telegram-adaptation-design.md` (data-model table + config note)

- [ ] **Step 1: Write the setup doc**

Create `docs/telegram-setup.md`:

```markdown
# Telegram bot + Mini App setup (experimental)

Feature flag: `TELEGRAM_ENABLED` in `js/features.js` (client). Server side is
inert unless the env vars below are set — safe to deploy unconfigured.

## 1. Create the bot
1. Talk to @BotFather → `/newbot` → name it (e.g. "KnockKnock") → get the bot token.
2. `/setmenubutton` → choose the bot → set the menu button to the web app URL
   (your hosting URL, e.g. `https://<project>.web.app`).
3. Optionally `/setcommands`:
   start - Open KnockKnock
   status - Go available (e.g. /status 2h)
   off - Go unavailable
   who - Who's available now
   knock - Knock someone (/knock name)
   groups - Your groups
   notifications - Delivery channel (push|telegram)
   help - Commands

## 2. Configure functions env
In `functions/.env.<projectId>` (gitignored, like FUNCTIONS_REGION):

    TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
    TELEGRAM_WEBHOOK_SECRET=<long random string>
    TELEGRAM_APP_URL=https://<project>.web.app

Note: env-file storage (not Secret Manager) matches this repo's existing
config pattern; acceptable for the experiment, revisit before a broad rollout.

## 3. Deploy + register the webhook
1. Deploy functions: `npx firebase deploy --only functions --project <projectId>`
2. Register the webhook (region + project in the URL — check the deploy output):

    curl -sS "https://api.telegram.org/bot<TOKEN>/setWebhook" \
      -d "url=https://<region>-<projectId>.cloudfunctions.net/telegramWebhook" \
      -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
      -d "allowed_updates=[\"message\",\"callback_query\"]"

3. Verify: `curl -sS "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`

## How it fits together
- Mini App boot: client sends `Telegram.WebApp.initData` → `validateTelegram`
  callable verifies the signature, bootstraps/loads the account, mints a
  Firebase custom token. Mapping lives in server-only `telegramUsers/{tgId}`
  (+ reverse index `telegramByUid/{uid}` for notification routing).
- Linking: drawer → "I have a secret phrase" → `linkTelegram` (same rate
  limiter as validateRecovery) repoints the mapping to the phrase account.
- Notifications: `sendToUser` sends via the bot when
  `userPrefs/{uid}/notifyChannel === 'telegram'`, falling back to FCM on any
  failure. Toggle: drawer button or `/notifications push|telegram`.
```

- [ ] **Step 2: Sync the spec's data model**

In `docs/superpowers/specs/2026-07-02-telegram-adaptation-design.md`, section 4's table: add a row for `telegramByUid/{uid}` (server-only, `{ tgId, chatId }`, "reverse index for notification sends — kept server-only so a client can't redirect notifications") and change the `userPrefs/{uid}/telegram` row's access note to "owner-visible link state (display only; routing uses telegramByUid)". In section 5, note that server config uses `functions/.env.*` env vars (TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET / TELEGRAM_APP_URL) rather than Functions secrets, matching the repo's existing pattern.

- [ ] **Step 3: Full verification**

Run all three suites and confirm output:
- `npx jest` → PASS
- `cd functions && npm test` → PASS
- `npm run test:rules` → PASS (or documented as emulator-unavailable)

- [ ] **Step 4: Commit**

```bash
git add docs/telegram-setup.md docs/superpowers/specs/2026-07-02-telegram-adaptation-design.md
git commit -m "docs(telegram): setup guide; sync spec data model with implementation"
```

- [ ] **Step 5: Push the branch**

```bash
git push -u origin claude/telegram-app-adaptation-t1r1jp
```
