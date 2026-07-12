# Web → Telegram one-tap link onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an existing web/PWA user adopt the Telegram Mini App for their *existing* account in one tap, carrying a server-minted single-use link token (the phrase never travels), with a one-time promo banner + a durable drawer card, and a confirm-before-replace guard when the Telegram side already holds contacts/groups.

**Architecture:** The web app is already Firebase-authed as the phrase account, so a new authenticated callable `mintTelegramLinkToken` records a short-lived single-use token bound to `request.auth.uid`. The web surfaces open `t.me/<bot>?startapp=lk_<token>`; the Mini App boot path detects the `lk_` prefix and calls `redeemTelegramLinkToken`, which resolves the token → uid and runs the *same* link routine the manual drawer flow uses (`performLink`, extracted from `linkTelegramHandler`). No new identity mechanics; no rules relaxation (both callables use the Admin SDK).

**Tech Stack:** vanilla ES modules (no framework), Firebase Realtime Database + Cloud Functions (v2 `onCall`, ESM), esbuild, jest + jsdom (web) / jest ESM (functions), firebase rules emulator.

**Spec:** `docs/superpowers/specs/2026-07-09-telegram-web-onboarding-design.html`

## Global Constraints

- **No merge.** Linking expunges the Telegram-derived account (identity model's boundary). Do not attempt to combine data. The only guard is confirm-before-replace.
- **Phrase never travels.** The mint call is authenticated by `request.auth.uid`; no phrase/code is sent in any new callable.
- **Token: 5-min TTL, single-use, `lk_` startapp prefix, fresh mint on every tap.** No client-side token caching. An unredeemed token just expires.
- **`performLink` extraction is a PURE refactor** — the existing `linkTelegramHandler`/`unlinkTelegramHandler`/graduation test suites must stay byte-for-byte green (respects the "don't disturb expunge" landmine).
- **Confirm copy is the existing linking-flow sentence, verbatim:** `"Linking replaces this temporary Telegram account — its contacts and groups will be removed."` Buttons `Link account` / `Cancel`.
- **Surfaces are web-context only** (`!isTelegramContext()`), gated on `TELEGRAM_ENABLED && TELEGRAM_APP_LINK`, and suppressed once `serverPrefs.telegram != null`.
- **Commit identity:** `git config user.email noreply@anthropic.com` (already set for this branch).
- **Tests:** functions = `cd functions && npm test` (ESM, NOT `npx jest`). web = `npx jest` (repo root). rules = `npm run test:rules`. build = `npm run build` (repo root).
- **Do not push, merge, bump, or deploy** — the maintainer merges `t1r1jp`→`dev`→`main`. This work lands on `claude/telegram-web-onboarding-2wl6cf`. Deploy of the new functions rides the same A5 redeploy landmine as the other branch-only Telegram functions (`docs/telegram-setup.md`).

---

## Task 1: Extract `performLink(deps, uid, tgUser)` from `linkTelegramHandler`

Pure refactor. `linkTelegramHandler` keeps deriving the uid from the phrase, then delegates the repoint/expunge/prefs/mint to a shared routine that Task 3's redeem handler will also call.

**Files:**
- Modify: `functions/telegram-auth.js:147-190` (the `linkTelegramHandler` body)
- Test: `functions/test/telegram-auth.test.js` (existing `describe('linkTelegramHandler')` must stay green; add one `performLink` unit test)

**Interfaces:**
- Produces: `export async function performLink(deps, uid, tgUser): Promise<{ token: string }>` — repoints `telegramUsers/{tgId}` → `uid`, expunges the prior derived account (or resets a prior real account's telegram prefs), writes the new mapping/reverse-index/prefs atomically, returns `{ token }` from `deps.mintToken(uid)`. Throws `HttpsError('not-found')` if `users/{uid}/presence` is absent.

- [ ] **Step 1: Run the existing suite to capture the green baseline**

Run: `cd functions && npm test -- telegram-auth`
Expected: PASS (all existing `linkTelegramHandler` / `unlinkTelegramHandler` / graduation tests).

- [ ] **Step 2: Extract `performLink`, delegate from `linkTelegramHandler`**

In `functions/telegram-auth.js`, replace the current `linkTelegramHandler` (lines ~147-190) with:

```js
export async function performLink(deps, uid, tgUser) {
  const tgId = String(tgUser.id);
  const [presence, prior] = await Promise.all([
    deps.getVal(`users/${uid}/presence`),
    deps.getVal(`telegramUsers/${tgId}`),
  ]);
  if (!presence) throw new HttpsError('not-found', 'No account with that phrase.');
  const chatId = prior?.chatId || tgId;
  const now = deps.now();
  const writes = {};
  if (prior && prior.uid !== uid) {
    if (prior.uid === deriveTelegramUid(tgId, deps.uidSecret)) {
      // Linking retires the temporary Telegram-derived account completely.
      await expungeDerivedAccount(deps, prior.uid);
      writes[`telegramByUid/${prior.uid}`] = null;
    } else {
      // Direct relink (A→B): account A is a real phrase account — never expunge;
      // just reset its prefs off telegram (as unlinkTelegramHandler does).
      writes[`telegramByUid/${prior.uid}`] = null;
      writes[`userPrefs/${prior.uid}/telegram`] = null;
      writes[`userPrefs/${prior.uid}/notifyChannel`] = 'push';
    }
  }
  writes[`telegramUsers/${tgId}`] = { uid, chatId, linkedAt: now };
  writes[`telegramByUid/${uid}`] = { tgId, chatId };
  writes[`userPrefs/${uid}/telegram/tgId`] = tgId;
  writes[`userPrefs/${uid}/telegram/linkedAt`] = now;
  writes[`userPrefs/${uid}/notifyChannel`] = 'telegram';
  await rootUpdate(deps, writes);
  return { token: await deps.mintToken(uid) };
}

export async function linkTelegramHandler(request, deps) {
  const tgUser = requireTelegramUser(request, deps);
  const normalized = normalizeRecoveryCode(request.data?.code);
  if (!normalized) throw new HttpsError('invalid-argument', 'Invalid recovery code.');
  const uid = await deriveUid(normalized);
  if (!(await deps.allowAttempt(uid))) throw new HttpsError('resource-exhausted', 'Too many attempts. Try again shortly.');
  return performLink(deps, uid, tgUser);
}
```

- [ ] **Step 3: Add a `performLink` unit test**

In `functions/test/telegram-auth.test.js`, add `performLink` to the import on line 4, then add after the `linkTelegramHandler` describe block:

```js
describe('performLink', () => {
  test('no presence at uid → not-found', async () => {
    const deps = makeHandlerDeps();
    await expect(performLink(deps, 'a'.repeat(32), { id: 42 })).rejects.toThrow(/No account/);
  });
  test('links a phrase account and mints its token', async () => {
    const uid = 'b'.repeat(32);
    const deps = makeHandlerDeps({ [`users/${uid}/presence`]: { code: 'ZZ1111' } });
    const res = await performLink(deps, uid, { id: 42 });
    expect(res.token).toBe(`token-for-${uid}`);
    expect(deps.store[`telegramUsers/42`]).toMatchObject({ uid, chatId: '42' });
    expect(deps.store[`userPrefs/${uid}/notifyChannel`]).toBe('telegram');
  });
});
```

- [ ] **Step 4: Run the suite — existing tests unchanged, new ones pass**

Run: `cd functions && npm test -- telegram-auth`
Expected: PASS, with the `linkTelegramHandler` count unchanged and 2 new `performLink` tests green.

- [ ] **Step 5: Commit**

```bash
git add functions/telegram-auth.js functions/test/telegram-auth.test.js
git commit -m "refactor(tg): extract performLink from linkTelegramHandler"
```

---

## Task 2: `mintTelegramLinkToken` callable

Authenticated (web session) mint of a fresh single-use token bound to `request.auth.uid`.

**Files:**
- Modify: `functions/telegram-auth.js` (add handler + `LINK_TOKEN_TTL_MS`)
- Modify: `functions/index.js:203-236` (add `randomToken` dep + export)
- Modify: `functions/test/telegram-auth.test.js` (`makeStoreDeps` gets a `randomToken`; new describe block)
- Modify: `js/firebase-config.js:40-65` (client wrapper)

**Interfaces:**
- Produces: `export async function mintTelegramLinkTokenHandler(request, deps): Promise<{ token: string }>`. Requires `request.auth.uid`; writes `telegramLinkTokens/<token> = { uid, exp }`; `token = deps.randomToken()`, `exp = deps.now() + LINK_TOKEN_TTL_MS`.
- Produces: `export async function callMintTelegramLinkToken(): Promise<{ token: string }>` (client).
- Consumes: `deps.randomToken` (new), `deps.set`, `deps.now`.

- [ ] **Step 1: Write the failing handler test**

In `functions/test/telegram-auth.test.js`: add `mintTelegramLinkTokenHandler` to the import (line 4); add `randomToken: () => 'tok_fixed_000000000000'` to the object returned by `makeStoreDeps` (line 90-95); then add:

```js
describe('mintTelegramLinkTokenHandler', () => {
  test('authed → writes a bound, expiring token record and returns it', async () => {
    const deps = { ...makeHandlerDeps(), now: () => 1000, randomToken: () => 'tok_abc' };
    const uid = 'c'.repeat(32);
    const res = await mintTelegramLinkTokenHandler({ auth: { uid } }, deps);
    expect(res).toEqual({ token: 'tok_abc' });
    expect(deps.store['telegramLinkTokens/tok_abc']).toEqual({ uid, exp: 1000 + 5 * 60 * 1000 });
  });
  test('unauthenticated → throws', async () => {
    const deps = makeHandlerDeps();
    await expect(mintTelegramLinkTokenHandler({ auth: null }, deps)).rejects.toThrow(/Sign in|unauthenticated/i);
  });
});
```

- [ ] **Step 2: Run it — fails (handler not defined)**

Run: `cd functions && npm test -- telegram-auth`
Expected: FAIL — `mintTelegramLinkTokenHandler is not a function`.

- [ ] **Step 3: Implement the handler**

In `functions/telegram-auth.js`, near the top add the constant, and add the handler (e.g. after `linkTelegramHandler`):

```js
const LINK_TOKEN_TTL_MS = 5 * 60 * 1000; // one-tap web→TG link token lifetime

// Authenticated (web session) mint of a single-use token bound to this account's
// uid. The phrase never leaves the device — the web app is already signed in, so
// request.auth.uid identifies the account. Fresh token every call.
export async function mintTelegramLinkTokenHandler(request, deps) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const token = deps.randomToken();
  await deps.set(`telegramLinkTokens/${token}`, { uid, exp: deps.now() + LINK_TOKEN_TTL_MS });
  return { token };
}
```

- [ ] **Step 4: Run it — passes**

Run: `cd functions && npm test -- telegram-auth`
Expected: PASS.

- [ ] **Step 5: Wire the export + `randomToken` dep + client wrapper**

In `functions/index.js`: at the top add `import { randomBytes } from 'crypto';` (if not present); inside `makeTelegramAuthDeps()` (after `mintToken`) add:

```js
    randomToken: () => randomBytes(16).toString('base64url'),
```

Add `mintTelegramLinkTokenHandler` to the `./telegram-auth.js` import (line 12), and after the `graduateTelegram` export (line 236) add:

```js
export const mintTelegramLinkToken = httpsOnCall((request) => mintTelegramLinkTokenHandler(request, makeTelegramAuthDeps()));
```

In `js/firebase-config.js`: after line 43 add `const _mintTelegramLinkToken = httpsCallable(_functions, 'mintTelegramLinkToken');` and after `callGraduateTelegram` (line 65) add:

```js
// One-tap web→Telegram onboarding: mint a fresh single-use link token bound to
// the current (authed) account. The phrase is never sent. See telegramOnramp.js.
export async function callMintTelegramLinkToken() {
  const { data } = await _mintTelegramLinkToken({});
  return data; // { token }
}
```

- [ ] **Step 6: Run the full functions suite**

Run: `cd functions && npm test`
Expected: PASS (previous total + 2 new mint tests).

- [ ] **Step 7: Commit**

```bash
git add functions/telegram-auth.js functions/index.js functions/test/telegram-auth.test.js js/firebase-config.js
git commit -m "feat(tg): mintTelegramLinkToken callable (auth-bound, single-use, 5m TTL)"
```

---

## Task 3: `redeemTelegramLinkToken` callable (with confirm-before-replace)

Verifies initData, resolves the token → uid, computes the derived account's emptiness, and either returns `needsConfirm` (non-empty, no confirm flag) or performs the link and consumes the token.

**Files:**
- Modify: `functions/telegram-auth.js` (add handler)
- Modify: `functions/index.js` (export)
- Modify: `functions/test/telegram-auth.test.js` (new describe block)
- Modify: `js/firebase-config.js` (client wrapper)

**Interfaces:**
- Produces: `export async function redeemTelegramLinkTokenHandler(request, deps): Promise<{ token: string } | { needsConfirm: true, counts: { contacts: number, groups: number } }>`. `request.data = { initData, token, confirm }`.
- Produces: `export async function callRedeemTelegramLinkToken(initData, token, confirm=false)` (client).
- Consumes: `performLink` (Task 1), `deriveTelegramUid`, `requireTelegramUser`, `rootUpdate`.

- [ ] **Step 1: Write the failing tests**

Add `redeemTelegramLinkTokenHandler` to the import (line 4), then:

```js
describe('redeemTelegramLinkTokenHandler', () => {
  const seed = (extra) => ({
    'telegramLinkTokens/tok1': { uid: 'd'.repeat(32), exp: 9_999_999_999_999 },
    [`users/${'d'.repeat(32)}/presence`]: { code: 'PP1111' },
    ...extra,
  });
  test('missing/expired token → not-found', async () => {
    const deps = makeHandlerDeps({});
    await expect(redeemTelegramLinkTokenHandler(
      { data: { initData: freshInitData(), token: 'nope' } }, deps)).rejects.toThrow(/expired/i);
  });
  test('empty derived account → links immediately and consumes the token', async () => {
    const deps = makeHandlerDeps(seed());
    const res = await redeemTelegramLinkTokenHandler(
      { data: { initData: freshInitData(), token: 'tok1' } }, deps);
    expect(res.token).toBe(`token-for-${'d'.repeat(32)}`);
    expect(deps.store['telegramLinkTokens/tok1']).toBeUndefined(); // single-use
    expect(deps.store['telegramUsers/42']).toMatchObject({ uid: 'd'.repeat(32) });
  });
  test('non-empty derived account without confirm → needsConfirm, no link', async () => {
    const derived = deriveTelegramUid('42', TEST_UID_SECRET);
    const deps = makeHandlerDeps(seed({
      [`users/${derived}/followers`]: { x: true },
      [`users/${derived}/groups`]: { g1: true, g2: true },
    }));
    const res = await redeemTelegramLinkTokenHandler(
      { data: { initData: freshInitData(), token: 'tok1' } }, deps);
    expect(res).toEqual({ needsConfirm: true, counts: { contacts: 1, groups: 2 } });
    expect(deps.store['telegramLinkTokens/tok1']).toBeDefined(); // NOT consumed
    expect(deps.store['telegramUsers/42']).toBeUndefined();      // NOT linked
  });
  test('non-empty with confirm:true → links and consumes', async () => {
    const derived = deriveTelegramUid('42', TEST_UID_SECRET);
    const deps = makeHandlerDeps(seed({ [`users/${derived}/groups`]: { g1: true } }));
    const res = await redeemTelegramLinkTokenHandler(
      { data: { initData: freshInitData(), token: 'tok1', confirm: true } }, deps);
    expect(res.token).toBe(`token-for-${'d'.repeat(32)}`);
    expect(deps.store['telegramLinkTokens/tok1']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it — fails**

Run: `cd functions && npm test -- telegram-auth`
Expected: FAIL — `redeemTelegramLinkTokenHandler is not a function`.

- [ ] **Step 3: Implement the handler**

In `functions/telegram-auth.js`:

```js
// Redeem a mint-token from the web onramp: verify this Telegram (initData),
// resolve the token → account uid, and link. If THIS Telegram already holds a
// standalone account with contacts/groups, linking would expunge it — so return
// needsConfirm (with counts) unless the caller passes confirm:true. Token is
// single-use: deleted only on an actual link.
export async function redeemTelegramLinkTokenHandler(request, deps) {
  const tgUser = requireTelegramUser(request, deps);
  const token = request.data?.token;
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
    throw new HttpsError('invalid-argument', 'Invalid link token.');
  }
  const rec = await deps.getVal(`telegramLinkTokens/${token}`);
  if (!rec || !rec.uid || (rec.exp && rec.exp < deps.now())) {
    throw new HttpsError('not-found', 'That link expired.');
  }
  const derivedUid = deriveTelegramUid(String(tgUser.id), deps.uidSecret);
  const [followers, following, groups] = await Promise.all([
    deps.getVal(`users/${derivedUid}/followers`),
    deps.getVal(`userPrefs/${derivedUid}/following`),
    deps.getVal(`users/${derivedUid}/groups`),
  ]);
  const contacts = new Set([...Object.keys(followers || {}), ...Object.keys(following || {})]).size;
  const groupCount = Object.keys(groups || {}).length;
  if ((contacts > 0 || groupCount > 0) && !request.data?.confirm) {
    return { needsConfirm: true, counts: { contacts, groups: groupCount } };
  }
  const result = await performLink(deps, rec.uid, tgUser);
  await rootUpdate(deps, { [`telegramLinkTokens/${token}`]: null }); // single-use
  return result;
}
```

- [ ] **Step 4: Run it — passes**

Run: `cd functions && npm test -- telegram-auth`
Expected: PASS.

- [ ] **Step 5: Wire the export + client wrapper**

In `functions/index.js` add `redeemTelegramLinkTokenHandler` to the import and, after the mint export:

```js
export const redeemTelegramLinkToken = httpsOnCall((request) => redeemTelegramLinkTokenHandler(request, makeTelegramAuthDeps()));
```

In `js/firebase-config.js` add `const _redeemTelegramLinkToken = httpsCallable(_functions, 'redeemTelegramLinkToken');` and:

```js
// Redeem a link token inside the Mini App: { token } on success, or
// { needsConfirm, counts } when this Telegram already has an account to replace.
export async function callRedeemTelegramLinkToken(initData, token, confirm = false) {
  const { data } = await _redeemTelegramLinkToken({ initData, token, confirm });
  return data;
}
```

- [ ] **Step 6: Run the full functions suite**

Run: `cd functions && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add functions/telegram-auth.js functions/index.js functions/test/telegram-auth.test.js js/firebase-config.js
git commit -m "feat(tg): redeemTelegramLinkToken callable with confirm-before-replace"
```

---

## Task 4: Lock `telegramLinkTokens` in the security rules

Server-only (Admin SDK) node — deny all client access, and prove it.

**Files:**
- Modify: `database.rules.json` (add `telegramLinkTokens` node)
- Test: the rules suite (`npm run test:rules`) — add a deny test in the existing rules test file

**Interfaces:** none (data-layer policy).

- [ ] **Step 1: Add the deny rule**

In `database.rules.json`, add a sibling under the top-level `rules` object (alongside `telegramUsers`, `telegramByUid`):

```json
"telegramLinkTokens": { ".read": false, ".write": false },
```

- [ ] **Step 2: Add the rules test**

Locate the rules test file (`grep -rl "telegramUsers" test* rules* 2>/dev/null` — same file that asserts `telegramUsers` denial). Mirror its style; conceptually:

```js
it('denies client reads and writes to telegramLinkTokens', async () => {
  const db = authedDb('someuser');
  await assertFails(get(ref(db, 'telegramLinkTokens/tok1')));
  await assertFails(set(ref(db, 'telegramLinkTokens/tok1'), { uid: 'x', exp: 1 }));
});
```

- [ ] **Step 3: Run the rules suite**

Run: `npm run test:rules`
Expected: PASS (emulator + Java) — the new deny test green.

- [ ] **Step 4: Commit**

```bash
git add database.rules.json test*
git commit -m "rules(tg): telegramLinkTokens is server-only (deny all client access)"
```

---

## Task 5: `js/telegramOnramp.js` core — gating, deep link, mint-and-open

Pure/unit-testable core shared by both web surfaces. No DOM yet.

**Files:**
- Create: `js/telegramOnramp.js`
- Test: `tests/telegramOnramp.test.js`

**Interfaces:**
- Produces: `telegramOnrampEnabled(): boolean` (`TELEGRAM_ENABLED && !!TELEGRAM_APP_LINK && !isTelegramContext()`), `buildLinkDeepLink(token): string|null` (`${TELEGRAM_APP_LINK}?startapp=lk_${token}`), `startTelegramOnramp(): Promise<boolean>` (mint fresh token, `window.open` the deep link; false if unconfigured or popup blocked).
- Consumes: `TELEGRAM_ENABLED` (features.js), `isTelegramContext` (telegram.js), `callMintTelegramLinkToken` (firebase-config.js).

- [ ] **Step 1: Write the failing tests**

```js
// tests/telegramOnramp.test.js
import { jest } from '@jest/globals';
jest.unstable_mockModule('../js/features.js', () => ({ TELEGRAM_ENABLED: true }));
jest.unstable_mockModule('../js/telegram.js', () => ({ isTelegramContext: () => false }));
jest.unstable_mockModule('../js/firebase-config.js', () => ({
  callMintTelegramLinkToken: jest.fn(async () => ({ token: 'tok_xyz' })),
}));
process.env.TELEGRAM_APP_LINK = 'https://t.me/knockbot/app';
const { telegramOnrampEnabled, buildLinkDeepLink, startTelegramOnramp } = await import('../js/telegramOnramp.js');

test('enabled on web with a configured app link', () => {
  expect(telegramOnrampEnabled()).toBe(true);
});
test('builds the lk_ deep link', () => {
  expect(buildLinkDeepLink('tok_xyz')).toBe('https://t.me/knockbot/app?startapp=lk_tok_xyz');
  expect(buildLinkDeepLink('')).toBeNull();
});
test('startTelegramOnramp mints then opens the deep link', async () => {
  const open = jest.spyOn(window, 'open').mockReturnValue({});
  const ok = await startTelegramOnramp();
  expect(ok).toBe(true);
  expect(open).toHaveBeenCalledWith('https://t.me/knockbot/app?startapp=lk_tok_xyz', '_blank');
});
```

- [ ] **Step 2: Run — fails (module missing)**

Run: `npx jest tests/telegramOnramp.test.js`
Expected: FAIL — cannot find `../js/telegramOnramp.js`.

- [ ] **Step 3: Implement the module**

```js
// js/telegramOnramp.js — web-only "Use in Telegram" onramp: mint a single-use
// link token for THIS (authed) account and open the Mini App deep link so it
// auto-links. The phrase never travels. Suppressed once the account is linked.
import { TELEGRAM_ENABLED } from './features.js';
import { isTelegramContext } from './telegram.js';
import { callMintTelegramLinkToken } from './firebase-config.js';

const TELEGRAM_APP_LINK = process.env.TELEGRAM_APP_LINK || '';

export function telegramOnrampEnabled() {
  return TELEGRAM_ENABLED && !!TELEGRAM_APP_LINK && !isTelegramContext();
}

export function buildLinkDeepLink(token) {
  if (!TELEGRAM_APP_LINK || !token) return null;
  return `${TELEGRAM_APP_LINK}?startapp=lk_${token}`;
}

// Fresh token every call (no caching): if the user backs out, it just expires.
export async function startTelegramOnramp() {
  const { token } = await callMintTelegramLinkToken();
  const url = buildLinkDeepLink(token);
  if (!url) return false;
  const win = window.open(url, '_blank');
  return !!win;
}
```

- [ ] **Step 4: Run — passes**

Run: `npx jest tests/telegramOnramp.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/telegramOnramp.js tests/telegramOnramp.test.js
git commit -m "feat(web): telegramOnramp core — mint token + open Mini App deep link"
```

---

## Task 6: Web surfaces — one-time promo banner (A) + drawer card (C)

Both surfaces + their init/suppression live in `telegramOnramp.js`; the DOM is added to `index.template.html`; boot wires it in `app.js`. Banner has device-local dismissal; both suppress when linked.

**Files:**
- Modify: `index.template.html` (banner near `#notify-promo` ~line 397; drawer card section ~line 290)
- Modify: `js/telegramOnramp.js` (add `initTelegramOnramp`, `syncTelegramOnramp`, dismissal)
- Modify: `js/app.js:793-796` (wire init in the `!isTelegramContext()` block) and `js/app.js:780-789` (call `syncTelegramOnramp` on the prefs tick)
- Test: `tests/telegramOnramp.test.js` (extend with DOM cases)

**Interfaces:**
- Produces: `initTelegramOnramp(): void` (wires both buttons + initial visibility), `syncTelegramOnramp(serverPrefs): void` (hide both when `serverPrefs?.telegram != null`).
- Consumes: DOM ids `#tg-onramp-promo`, `#tg-onramp-action`, `#tg-onramp-dismiss`, `#drawer-section-tg-onramp`, `#tg-onramp-drawer-btn`.

- [ ] **Step 1: Add the DOM**

In `index.template.html`, immediately after the `#notify-promo` block (after line ~401's closing `</div>` for notify-promo, before `#install-toast`):

```html
  <div id="tg-onramp-promo" class="notify-promo hidden" role="region" aria-label="Telegram">
    <span id="tg-onramp-text">KnockKnock works in Telegram now — bring this account over in one tap.</span>
    <button id="tg-onramp-action" class="primary-btn" type="button">Use in Telegram</button>
    <button id="tg-onramp-dismiss" class="ghost-btn" aria-label="Close">Close</button>
  </div>
```

And after the invite drawer-section (after line 290's `</div>` closing `#drawer-section-invite`):

```html
          <div class="drawer-section hidden" id="drawer-section-tg-onramp">
            <p class="drawer-section-label">Telegram</p>
            <button id="tg-onramp-drawer-btn" class="ghost-btn" type="button">Use in Telegram</button>
            <p class="hint">Get knocks and presence in a Telegram chat.</p>
          </div>
```

- [ ] **Step 2: Write the failing DOM tests**

Append to `tests/telegramOnramp.test.js`:

```js
const { initTelegramOnramp, syncTelegramOnramp } = await import('../js/telegramOnramp.js');
function mountDom() {
  document.body.innerHTML = `
    <div id="tg-onramp-promo" class="hidden"><button id="tg-onramp-action"></button><button id="tg-onramp-dismiss"></button></div>
    <div id="drawer-section-tg-onramp" class="hidden"><button id="tg-onramp-drawer-btn"></button></div>`;
}
beforeEach(() => { localStorage.clear(); mountDom(); });

test('init shows banner + card when enabled and unlinked', () => {
  initTelegramOnramp();
  expect(document.getElementById('tg-onramp-promo').classList.contains('hidden')).toBe(false);
  expect(document.getElementById('drawer-section-tg-onramp').classList.contains('hidden')).toBe(false);
});
test('dismiss hides the banner forever (device-local), card stays', () => {
  initTelegramOnramp();
  document.getElementById('tg-onramp-dismiss').click();
  expect(document.getElementById('tg-onramp-promo').classList.contains('hidden')).toBe(true);
  mountDom(); initTelegramOnramp(); // re-mount = new "session"
  expect(document.getElementById('tg-onramp-promo').classList.contains('hidden')).toBe(true);
  expect(document.getElementById('drawer-section-tg-onramp').classList.contains('hidden')).toBe(false);
});
test('syncTelegramOnramp hides both once linked', () => {
  initTelegramOnramp();
  syncTelegramOnramp({ telegram: { tgId: '42' } });
  expect(document.getElementById('tg-onramp-promo').classList.contains('hidden')).toBe(true);
  expect(document.getElementById('drawer-section-tg-onramp').classList.contains('hidden')).toBe(true);
});
```

- [ ] **Step 3: Run — fails**

Run: `npx jest tests/telegramOnramp.test.js`
Expected: FAIL — `initTelegramOnramp is not a function`.

- [ ] **Step 4: Implement init/suppression + dismissal**

Append to `js/telegramOnramp.js`:

```js
const DISMISS_KEY = 'statusapp_tg_onramp_dismissed';
function bannerDismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}
function dismissBanner() {
  try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* quota */ }
}

let _linked = false;
function refresh() {
  const promo = document.getElementById('tg-onramp-promo');
  const card = document.getElementById('drawer-section-tg-onramp');
  const show = telegramOnrampEnabled() && !_linked;
  card?.classList.toggle('hidden', !show);
  promo?.classList.toggle('hidden', !(show && !bannerDismissed()));
}

export function initTelegramOnramp() {
  const promo = document.getElementById('tg-onramp-promo');
  const card = document.getElementById('drawer-section-tg-onramp');
  if (!promo && !card) return;
  const go = async (btn) => {
    if (btn) btn.disabled = true;
    try { await startTelegramOnramp(); } finally { if (btn) btn.disabled = false; }
  };
  document.getElementById('tg-onramp-action')?.addEventListener('click', (e) => go(e.currentTarget));
  document.getElementById('tg-onramp-drawer-btn')?.addEventListener('click', (e) => go(e.currentTarget));
  document.getElementById('tg-onramp-dismiss')?.addEventListener('click', () => {
    dismissBanner();
    promo?.classList.add('hidden');
  });
  refresh();
}

// Suppress once this account is linked to Telegram (prefs.telegram set). Rides
// the watchUserPrefs tick — mirrors notifySuppression's `prefs.telegram != null`.
export function syncTelegramOnramp(serverPrefs) {
  _linked = serverPrefs?.telegram != null;
  refresh();
}
```

- [ ] **Step 5: Run — passes**

Run: `npx jest tests/telegramOnramp.test.js`
Expected: PASS.

- [ ] **Step 6: Wire boot in `app.js`**

Add the import (near line 35): `import { initTelegramOnramp, syncTelegramOnramp } from './telegramOnramp.js';`

In the `watchUserPrefs` callback (line 780-789), after `syncBotDelivery(serverPrefs);` add:

```js
    syncTelegramOnramp(serverPrefs);
```

In the `if (!isTelegramContext()) {` block (line 793-796), add:

```js
    initTelegramOnramp();
```

- [ ] **Step 7: Run the web suite + build**

Run: `npx jest tests/telegramOnramp.test.js && npm run build`
Expected: PASS; build clean (esbuild resolves the new import; `index.html` gets the new DOM).

- [ ] **Step 8: Commit**

```bash
git add index.template.html js/telegramOnramp.js js/app.js tests/telegramOnramp.test.js
git commit -m "feat(web): one-time Use-in-Telegram promo banner + drawer card"
```

---

## Task 7: Mini App arrival — `lk_` dispatcher, redeem, replace-confirm, landing toast

The Mini App boot detects the `lk_` start_param, redeems, shows the replace-confirm when the server returns `needsConfirm`, and stamps a landing toast on success.

**Files:**
- Create: `js/telegramLinkArrival.js`
- Modify: `js/firstRun.js:98-118` (generalize the landing map + add `stampLinkedNotice`)
- Modify: `js/app.js:596-604` (dispatch before `telegramInviteGate`)
- Test: `tests/telegramLinkArrival.test.js`, and extend `tests/firstRun.test.js` for the new landing copy

**Interfaces:**
- Produces: `extractLinkToken(): string|null`, `runLinkArrival({ dismissSplash }): Promise<boolean>` (true = the `lk_` path was handled; caller must not continue the invite flow).
- Consumes: `tgWebApp`, `isTelegramContext` (telegram.js), `callRedeemTelegramLinkToken` (firebase-config.js), `showConfirmModal` (promptModal.js), `showToast` (groups.js), `stampLinkedNotice` (firstRun.js).

- [ ] **Step 1: Generalize the landing map + add `stampLinkedNotice`**

In `js/firstRun.js`, replace lines 103-118 with:

```js
const LANDING_COPY = {
  graduated: 'This account now works in any browser too.',
  linked: 'This account now works in Telegram too.',
};

export function stampGraduationNotice() {
  try { sessionStorage.setItem(LANDING_KEY, 'graduated'); } catch { /* storage denied */ }
}
export function stampLinkedNotice() {
  try { sessionStorage.setItem(LANDING_KEY, 'linked'); } catch { /* storage denied */ }
}

// Read-and-clear the marker, returning the copy to surface (or null). The
// caller decides the surface — boot routes it through the shared toast.
export function consumeGraduationNotice() {
  let kind = null;
  try {
    kind = sessionStorage.getItem(LANDING_KEY);
    sessionStorage.removeItem(LANDING_KEY);
  } catch { return null; }
  return LANDING_COPY[kind] || null;
}
```

- [ ] **Step 2: Write the failing arrival tests**

```js
// tests/telegramLinkArrival.test.js
import { jest } from '@jest/globals';
const redeem = jest.fn();
const confirm = jest.fn();
const toast = jest.fn();
const stampLinked = jest.fn();
let startParam = 'lk_tok0000000000000000';
jest.unstable_mockModule('../js/telegram.js', () => ({
  isTelegramContext: () => true,
  tgWebApp: () => ({ initData: 'INIT', initDataUnsafe: { start_param: startParam } }),
}));
jest.unstable_mockModule('../js/firebase-config.js', () => ({ callRedeemTelegramLinkToken: redeem }));
jest.unstable_mockModule('../js/promptModal.js', () => ({ showConfirmModal: confirm }));
jest.unstable_mockModule('../js/groups.js', () => ({ showToast: toast }));
jest.unstable_mockModule('../js/firstRun.js', () => ({ stampLinkedNotice: stampLinked }));
const { extractLinkToken, runLinkArrival } = await import('../js/telegramLinkArrival.js');
beforeEach(() => { jest.clearAllMocks(); delete window.location; window.location = { reload: jest.fn() }; });

test('extractLinkToken reads the lk_ prefix', () => {
  expect(extractLinkToken()).toBe('tok0000000000000000');
});
test('empty account → silent link + stamp + reload', async () => {
  redeem.mockResolvedValueOnce({ token: 'auth' });
  const handled = await runLinkArrival({ dismissSplash: jest.fn() });
  expect(handled).toBe(true);
  expect(redeem).toHaveBeenCalledWith('INIT', 'tok0000000000000000', false);
  expect(stampLinked).toHaveBeenCalled();
  expect(window.location.reload).toHaveBeenCalled();
});
test('needsConfirm → shows replace confirm; confirm re-redeems with confirm:true', async () => {
  redeem.mockResolvedValueOnce({ needsConfirm: true, counts: { contacts: 2, groups: 1 } });
  confirm.mockImplementationOnce(async ({ onConfirm }) => { await onConfirm(); return true; });
  redeem.mockResolvedValueOnce({ token: 'auth' });
  const handled = await runLinkArrival({ dismissSplash: jest.fn() });
  expect(handled).toBe(true);
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
    message: 'Linking replaces this temporary Telegram account — its contacts and groups will be removed.',
    confirmLabel: 'Link account',
  }));
  expect(redeem).toHaveBeenLastCalledWith('INIT', 'tok0000000000000000', true);
  expect(window.location.reload).toHaveBeenCalled();
});
test('needsConfirm + cancel → handled, no reload', async () => {
  redeem.mockResolvedValueOnce({ needsConfirm: true, counts: { contacts: 1, groups: 0 } });
  confirm.mockResolvedValueOnce(false);
  const handled = await runLinkArrival({ dismissSplash: jest.fn() });
  expect(handled).toBe(true);
  expect(window.location.reload).not.toHaveBeenCalled();
});
test('expired token → toast, handled', async () => {
  redeem.mockRejectedValueOnce(new Error('expired'));
  const handled = await runLinkArrival({ dismissSplash: jest.fn() });
  expect(handled).toBe(true);
  expect(toast).toHaveBeenCalled();
});
```

- [ ] **Step 3: Run — fails**

Run: `npx jest tests/telegramLinkArrival.test.js`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement the arrival module**

```js
// js/telegramLinkArrival.js — Mini App boot path for the web onramp deep link
// (t.me/<bot>?startapp=lk_<token>). Redeems the token → links this Telegram to
// the web account, with a confirm-before-replace when this Telegram already has
// its own account. Returns true when it handled the lk_ path (caller then skips
// the normal invite flow).
import { isTelegramContext, tgWebApp } from './telegram.js';
import { callRedeemTelegramLinkToken } from './firebase-config.js';
import { showConfirmModal } from './promptModal.js';
import { showToast } from './groups.js';
import { stampLinkedNotice } from './firstRun.js';

export function extractLinkToken() {
  if (!isTelegramContext()) return null;
  const p = tgWebApp()?.initDataUnsafe?.start_param;
  if (typeof p !== 'string' || !p.startsWith('lk_')) return null;
  const tok = p.slice(3);
  return /^[A-Za-z0-9_-]{16,64}$/.test(tok) ? tok : null;
}

export async function runLinkArrival({ dismissSplash } = {}) {
  const token = extractLinkToken();
  if (!token) return false;
  const initData = tgWebApp()?.initData;
  try {
    const res = await callRedeemTelegramLinkToken(initData, token, false);
    if (res?.needsConfirm) {
      dismissSplash?.();
      const ok = await showConfirmModal({
        title: 'Use this account in Telegram?',
        message: 'Linking replaces this temporary Telegram account — its contacts and groups will be removed.',
        confirmLabel: 'Link account',
        busyLabel: 'Linking…',
        onConfirm: async () => { await callRedeemTelegramLinkToken(initData, token, true); },
      });
      if (!ok) return true; // cancelled — stay on this Telegram account
    }
    stampLinkedNotice();
    window.location.reload(); // reboot via initData into the linked account
    return true;
  } catch {
    dismissSplash?.();
    showToast('That link expired — tap Use in Telegram again on the web.');
    return true;
  }
}
```

- [ ] **Step 5: Run — passes**

Run: `npx jest tests/telegramLinkArrival.test.js`
Expected: PASS.

- [ ] **Step 6: Dispatch from `app.js` boot**

Add the import (near line 31): `import { runLinkArrival } from './telegramLinkArrival.js';`

In `app.js`, inside the `if (!pendingInviteToken && isTelegramContext()) {` block (line 597), BEFORE the `tgInvite = await telegramInviteGate(...)` call, add:

```js
    if (await runLinkArrival({ dismissSplash })) return; // onramp link handled — reboots on success
```

(The early `return` ends boot; a successful link reloads, a cancel/expiry leaves the user on the derived account which the next fresh boot renders normally.)

- [ ] **Step 7: Extend the firstRun landing test**

In `tests/firstRun.test.js`, add:

```js
test('stampLinkedNotice → consume returns the Telegram copy', () => {
  stampLinkedNotice();
  expect(consumeGraduationNotice()).toBe('This account now works in Telegram too.');
});
```

(Add `stampLinkedNotice` to the import from `../js/firstRun.js`.)

- [ ] **Step 8: Run web suite + build**

Run: `npx jest tests/telegramLinkArrival.test.js tests/firstRun.test.js && npm run build`
Expected: PASS; build clean.

- [ ] **Step 9: Commit**

```bash
git add js/telegramLinkArrival.js js/firstRun.js js/app.js tests/telegramLinkArrival.test.js tests/firstRun.test.js
git commit -m "feat(tg): Mini App onramp arrival — redeem, replace-confirm, linked toast"
```

---

## Task 8: Full-suite verification + wrap-up

**Files:** none (verification only).

- [ ] **Step 1: Functions suite**

Run: `cd functions && npm test`
Expected: PASS (previous total + Task 1-3 additions).

- [ ] **Step 2: Web suite**

Run: `npx jest`
Expected: PASS (previous total + Task 5/6/7 additions).

- [ ] **Step 3: Rules suite**

Run: `npm run test:rules`
Expected: PASS.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Update the handoff (do NOT push/merge)**

Add a `docs/HANDOFF.md` session entry describing the web→Telegram onramp (mint/redeem callables, `performLink` extraction, banner+card surfaces, `lk_` dispatcher, confirm-before-replace) and the DEPLOY NOTE: the new callables ride the same A5 redeploy as the other branch-only Telegram functions. Commit only.

```bash
git add docs/HANDOFF.md
git commit -m "docs(handoff): web→Telegram one-tap link onboarding"
```

- [ ] **Step 6: Report status to the operator**

Report OBSERVED suite counts and the on-device walkthrough as the remaining gate (web tap → Mini App links; the non-empty replace-confirm path). Do NOT declare done — that is the operator's call after the device pass. Note the deploy landmine: the new functions need the A5 redeploy, and `TELEGRAM_UID_SECRET` must be set.

---

## Self-Review

**Spec coverage:**
- §2 architecture (mint → deep link → redeem → performLink) → Tasks 1-3, 5, 7. ✓
- §3 edge case (empty → silent; non-empty → server `needsConfirm` + confirm) → Task 3 (server) + Task 7 (client modal). ✓
- §4 server (performLink extraction, mint, redeem, wiring, rules) → Tasks 1-4. ✓
- §5 web surfaces (banner A + card C, suppression, deep-link build, device-local dismissal) → Tasks 5-6. ✓
- §6 Mini App (boot dispatcher `lk_`, redeem, confirm, landing toast) → Task 7. ✓
- §7 copy (existing confirm sentence verbatim; success toast; new promo/card drafts) → Tasks 6-7. ✓
- §8 security (server-only tokens, TTL, single-use, relink edge handled by reused performLink) → Tasks 3-4. ✓
- §9 testing (functions/web/rules + on-device gate) → each task + Task 8. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. Task 4's exact rules-test path is resolved by a `grep` pointer (the repo's rules test filename is not fixed in the spec) — the test body is concrete.

**Type consistency:** `performLink(deps, uid, tgUser)` used identically in Tasks 1 and 3. `callRedeemTelegramLinkToken(initData, token, confirm)` defined in Task 3, consumed in Task 7. `{ needsConfirm, counts:{contacts,groups} }` shape consistent server (Task 3) ↔ client (Task 7). `stampLinkedNotice`/`consumeGraduationNotice` map consistent (Task 7). Deep link `?startapp=lk_<token>` consistent between `buildLinkDeepLink` (Task 5) and `extractLinkToken` (Task 7).
