# Invite Arrival Flows — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship phase 1 of the holistic invite-arrival design (#283, #265): shared links land on a mint-free `/invite` landing; the `/?i=` boot gate rescues legacy links; a unified "Redeem an invite" form redeems pasted invites in-app.

**Architecture:** Static pages (`about.html` served at `/about` and `/invite`) do all invite framing with plain classic scripts — no Firebase SDK, so no account can be minted there. The app boot gains one ordered decision gate before any Firebase work. The existing redemption pipeline (`attemptRedeemFromUrl`) is reused unchanged by a new in-app paste entry point.

**Tech Stack:** Vanilla ES modules (esbuild bundle) for the app; plain classic scripts for the about page (CSP `script-src 'self'`); Firebase Hosting rewrites; Jest (jsdom + `vm` sandboxes for classic scripts).

**Spec:** `docs/superpowers/specs/2026-07-10-invite-arrival-flows-design.md` + `.html` (both normative). Phase 1 = N1–N8 **except** the tokenless boot branch and the boot-panel removal (those are phases 2/3).

## Global Constraints

- Run web tests as `node_modules/.bin/jest` from the repo root (NOT bare `npx jest` — per handoff env note). A single file: `node_modules/.bin/jest tests/<file> -t "<name>"`.
- About-page scripts are **classic scripts** — no `import`/`export`, no build step, tested via `vm.runInNewContext` (see `tests/about-page.test.js:121` for the pattern).
- Copy verbatim (operator-set): opener button **"Redeem an invite"**; field label **"Code or invite link"**; input placeholder **"e.g. XK7P2M or an invite link"**; invite-mode submit **"Redeem invite"**; detection line **"Invite link detected"**; garbage error **"That doesn't look like a code or an invite link."**
- Token shapes: page-side lenient `/^[A-Za-z0-9_-]{1,64}$/`; raw-paste exact `/^[A-Za-z0-9_-]{22}$/` (tokens are 22 base64url chars, `js/invites.js:37`); share codes `/^[A-Z0-9]{6}$/`.
- Identity localStorage key: `statusapp_identity` (`js/identity.js:4`).
- The Telegram CTA substitution placeholder is `__TELEGRAM_APP_LINK__`; it must substitute to `''` unless `js/features.js` has `TELEGRAM_ENABLED = true` AND the env provides `TELEGRAM_APP_LINK` (spec N5, fail-closed).
- Commit after each task with the given message. Do NOT push, bump versions, or open PRs — the operator drives integration (CLAUDE.md).
- Do NOT remove or change `js/about-invite.js` — spec N4 keeps it byte-untouched.

---

### Task 1: Detection helpers (spec N7)

**Files:**
- Modify: `js/installGuidance.js:20` (export `isIos`), after `js/installGuidance.js:37` (new helper)
- Test: `tests/installGuidance.test.js` (append)

**Interfaces:**
- Produces: `export function isIos(): boolean` (existing logic, now exported); `export function isTelegramInAppBrowser(): boolean`. Consumed by Task 4.

- [ ] **Step 1: Write the failing tests** — append to `tests/installGuidance.test.js`:

```js
describe('isTelegramInAppBrowser + isIos exports (spec N7)', () => {
  const { isTelegramInAppBrowser, isIos } = require('../js/installGuidance.js');
  const setNav = (ua, touch = 0) => {
    Object.defineProperty(global.navigator, 'userAgent', { value: ua, configurable: true });
    Object.defineProperty(global.navigator, 'maxTouchPoints', { value: touch, configurable: true });
  };

  test('Telegram-Android webview → true', () => {
    setNav('Mozilla/5.0 (Linux; Android 14; Pixel) Telegram-Android/11.5 Chrome/120 Mobile Safari/537.36');
    expect(isTelegramInAppBrowser()).toBe(true);
  });

  test('iOS Telegram is UA-identical to Safari → false (the documented blindness)', () => {
    setNav('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Version/17.4 Mobile/15E148 Safari/604.1');
    expect(isTelegramInAppBrowser()).toBe(false);
  });

  test('plain Android Chrome → false', () => {
    setNav('Mozilla/5.0 (Linux; Android 14; Pixel) Chrome/120 Mobile Safari/537.36');
    expect(isTelegramInAppBrowser()).toBe(false);
  });

  test('isIos: iPhone true; iPadOS-as-Macintosh (touch) true; desktop Mac false', () => {
    setNav('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari/604.1');
    expect(isIos()).toBe(true);
    setNav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 5);
    expect(isIos()).toBe(true);
    setNav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 0);
    expect(isIos()).toBe(false);
  });
});
```

If the existing file already has a UA-setting helper, reuse it instead of `setNav` — same assertions.

- [ ] **Step 2: Run to verify failure**

Run: `node_modules/.bin/jest tests/installGuidance.test.js -t "isTelegramInAppBrowser"`
Expected: FAIL — `isTelegramInAppBrowser is not a function` / `isIos is not a function`.

- [ ] **Step 3: Implement** — in `js/installGuidance.js`: change line 20 `function isIos() {` to `export function isIos() {`, and insert after the `isInAppBrowser` function (line 37):

```js
// Positive Telegram signal — ANDROID ONLY: Telegram's Android webview carries
// "Telegram" in its UA (already a substring of isInAppBrowser's pattern above);
// the iOS client is byte-identical to Safari, so correctness must never depend
// on this helper (spec N7). It exists to make the boot gate MORE specific
// (the Q4 auto-hop), never to gate the rescue.
export function isTelegramInAppBrowser() {
  return /Telegram/.test(ua());
}
```

- [ ] **Step 4: Run the whole file** — `node_modules/.bin/jest tests/installGuidance.test.js`
Expected: PASS (new tests + all existing).

- [ ] **Step 5: Commit**

```bash
git add js/installGuidance.js tests/installGuidance.test.js
git commit -m "feat(detect): export isIos, add Android-only isTelegramInAppBrowser (spec N7)"
```

---

### Task 2: Shared links become `/invite?i=` (spec N1)

**Files:**
- Modify: `js/invites.js:51-53`
- Test: `tests/invites.test.js` (append; fix any stale `/?i=` expectations)

**Interfaces:**
- Produces: `buildInviteUrl(token)` now returns `` `${APP_URL_BASE}/invite?i=${token}` `` (`APP_URL_BASE` = `location.origin`, `js/invites.js:18`). No caller changes — the URL is built from the token at display time, nothing persists it.

- [ ] **Step 1: Write the failing test** — append to `tests/invites.test.js` (import `buildInviteUrl` alongside the file's existing requires if not already imported):

```js
describe('buildInviteUrl (spec N1/A1)', () => {
  const { buildInviteUrl } = require('../js/invites.js');
  test('builds a /invite landing link carrying the token', () => {
    expect(buildInviteUrl('AbCdEfGhIjKlMnOpQrStUv')).toMatch(/\/invite\?i=AbCdEfGhIjKlMnOpQrStUv$/);
    expect(buildInviteUrl('AbCdEfGhIjKlMnOpQrStUv')).not.toContain('/?i=');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `node_modules/.bin/jest tests/invites.test.js -t "buildInviteUrl"`
Expected: FAIL — received string contains `/?i=`.

- [ ] **Step 3: Implement** — replace `js/invites.js:51-53`:

```js
export function buildInviteUrl(token) {
  // /invite, not /?i= (spec N1/A1): the shared link itself lands on the
  // mint-free landing — no boot, no detection needed, identically on every
  // platform. Legacy /?i= links are caught by the boot gate (inviteBootGate).
  return `${APP_URL_BASE}/invite?i=${token}`;
}
```

- [ ] **Step 4: Run the full invites + inviteFlow + mycode + groupContext suites** (all build URLs from tokens):

Run: `node_modules/.bin/jest tests/invites.test.js tests/inviteFlow.test.js tests/mycode.test.js tests/groupContext.test.js tests/inviteModal.test.js`
Expected: PASS. If any test asserts a literal `'/?i='`, update that expectation to `'/invite?i='` — the new shape is the spec'd behavior.

- [ ] **Step 5: Commit**

```bash
git add js/invites.js tests/invites.test.js
git commit -m "feat(invites): shared web links land on /invite?i= (spec N1)"
```

---

### Task 3: Pure paste-parser module (spec N6 dependency)

**Files:**
- Create: `js/inviteText.js` (dependency-free on purpose — `js/following.js` imports it while tests mock the heavier `js/invites.js`)
- Test: `tests/inviteText.test.js` (new)

**Interfaces:**
- Produces: `export function extractInviteTokenFromText(raw: string): string | null`. Consumed by Task 10.

- [ ] **Step 1: Write the failing tests** — create `tests/inviteText.test.js`:

```js
/** @jest-environment node */
const { extractInviteTokenFromText } = require('../js/inviteText.js');

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv'; // 22 base64url chars

describe('extractInviteTokenFromText (spec N6)', () => {
  test.each([
    ['new shared link', `https://knock.example/invite?i=${TOKEN}`],
    ['legacy link', `https://knock.example/?i=${TOKEN}`],
    ['about link', `https://knock.example/about?i=${TOKEN}`],
    ['t.me deep link (C6)', `https://t.me/OnOnTestBot/OnOn?startapp=${TOKEN}`],
    ['raw 22-char token', TOKEN],
    ['padded with whitespace', `  ${TOKEN}\n`],
  ])('%s → token', (_name, input) => {
    expect(extractInviteTokenFromText(input)).toBe(TOKEN);
  });

  test.each([
    ['6-char share code', 'XK7P2M'],
    ['21 chars (not a token)', TOKEN.slice(0, 21)],
    ['23 chars', TOKEN + 'x'],
    ['URL without a token param', 'https://knock.example/about'],
    ['URL with malformed token', 'https://knock.example/?i=bad%20token!'],
    ['prose', 'hello there'],
    ['empty', ''],
  ])('%s → null', (_name, input) => {
    expect(extractInviteTokenFromText(input)).toBeNull();
  });

  test('non-string input → null', () => {
    expect(extractInviteTokenFromText(null)).toBeNull();
    expect(extractInviteTokenFromText(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `node_modules/.bin/jest tests/inviteText.test.js`
Expected: FAIL — cannot find module `../js/inviteText.js`.

- [ ] **Step 3: Implement** — create `js/inviteText.js`:

```js
// js/inviteText.js — recognizes a pasted invite in any shared shape (spec N6):
// a full URL carrying ?i= (web links) or ?startapp= (t.me deep links), or a
// bare 22-char base64url token. Share codes are 6 chars, so the shapes never
// collide. Dependency-free on purpose: js/following.js imports this while its
// tests mock the heavier js/invites.js.
export function extractInviteTokenFromText(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (/^[A-Za-z0-9_-]{22}$/.test(s)) return s;
  try {
    const url = new URL(s);
    for (const key of ['i', 'startapp']) {
      const t = url.searchParams.get(key);
      if (t && /^[A-Za-z0-9_-]{1,64}$/.test(t)) return t;
    }
  } catch { /* not a URL */ }
  return null;
}
```

- [ ] **Step 4: Run** — `node_modules/.bin/jest tests/inviteText.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/inviteText.js tests/inviteText.test.js
git commit -m "feat(invites): pure paste-parser for the unified redeem form (spec N6)"
```

---

### Task 4: Boot gate (spec N3)

**Files:**
- Create: `js/inviteBootGate.js`
- Modify: `js/app.js` (wire in `main()` after line 564; panel skip at line 214; `cleanInviteParamFromUrl` at line 555)
- Test: `tests/inviteBootGate.test.js` (new)

**Interfaces:**
- Consumes: Task 1's `isIos`, `isTelegramInAppBrowser`; existing `isTelegramContext` (`js/telegram.js`), `loadIdentity` (`js/identity.js`), `isStandalone`/`isInAppBrowser` (`js/installGuidance.js`), `telegramSharingEnabled`/`buildTelegramInviteLink` (`js/inviteFlow.js` — note `buildTelegramInviteLink(token)` already returns the FULL `…?startapp=TOKEN` URL or null).
- Produces: `decideBootRedirect(ctx) → { kind: 'hop'|'landing', url } | null`; `readBootRedirectContext(token) → ctx`; `hasStayParam() → boolean`.

- [ ] **Step 1: Write the failing tests** — create `tests/inviteBootGate.test.js`:

```js
/** @jest-environment jsdom */
jest.mock('../js/telegram.js', () => ({ isTelegramContext: jest.fn(() => false) }));
jest.mock('../js/identity.js', () => ({ loadIdentity: jest.fn(() => null) }));
jest.mock('../js/installGuidance.js', () => ({
  isStandalone: jest.fn(() => false),
  isInAppBrowser: jest.fn(() => false),
  isIos: jest.fn(() => false),
  isTelegramInAppBrowser: jest.fn(() => false),
}));
jest.mock('../js/inviteFlow.js', () => ({
  telegramSharingEnabled: jest.fn(() => true),
  buildTelegramInviteLink: jest.fn((t) => `https://t.me/bot/app?startapp=${t}`),
}));

const { decideBootRedirect, readBootRedirectContext, hasStayParam } = require('../js/inviteBootGate.js');
const { loadIdentity } = require('../js/identity.js');
const { isTelegramInAppBrowser, isInAppBrowser, isIos } = require('../js/installGuidance.js');
const { telegramSharingEnabled } = require('../js/inviteFlow.js');

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
// Fresh in-app arrival baseline; each test overrides one dimension.
const fresh = (over = {}) => ({
  token: TOKEN, telegramContext: false, stay: false, hasIdentity: false,
  standalone: false, telegramAndroid: false,
  deepLink: `https://t.me/bot/app?startapp=${TOKEN}`,
  inAppBrowser: false, ios: false, sharingEnabled: true, ...over,
});

describe('decideBootRedirect — ordered rules (spec N3)', () => {
  test('rule 0: no token → null (tokenless is phase 2/3)', () => {
    expect(decideBootRedirect(fresh({ token: null }))).toBeNull();
  });
  test('rule 1: Mini App context never redirects', () => {
    expect(decideBootRedirect(fresh({ telegramContext: true, telegramAndroid: true }))).toBeNull();
  });
  test('rule 2: stay=1 beats everything but the Mini App', () => {
    expect(decideBootRedirect(fresh({ stay: true, telegramAndroid: true, inAppBrowser: true, ios: true }))).toBeNull();
  });
  test('rule 3: identity beats detection (C3, accepted); standalone too', () => {
    expect(decideBootRedirect(fresh({ hasIdentity: true, telegramAndroid: true, inAppBrowser: true }))).toBeNull();
    expect(decideBootRedirect(fresh({ standalone: true, ios: true }))).toBeNull();
  });
  test('rule 4: Telegram-Android + deep link → auto-hop (Q4=A)', () => {
    expect(decideBootRedirect(fresh({ telegramAndroid: true, inAppBrowser: true })))
      .toEqual({ kind: 'hop', url: `https://t.me/bot/app?startapp=${TOKEN}` });
  });
  test('rule 4→5: Telegram-Android WITHOUT a deep link falls through to the landing', () => {
    expect(decideBootRedirect(fresh({ telegramAndroid: true, inAppBrowser: true, deepLink: null })))
      .toEqual({ kind: 'landing', url: `/invite?i=${TOKEN}` });
  });
  test('rule 5: any other detected in-app browser → landing, EVEN with Telegram off (holistic)', () => {
    expect(decideBootRedirect(fresh({ inAppBrowser: true, sharingEnabled: false })))
      .toEqual({ kind: 'landing', url: `/invite?i=${TOKEN}` });
  });
  test('rule 6: iOS-undetected net requires telegramSharingEnabled', () => {
    expect(decideBootRedirect(fresh({ ios: true })))
      .toEqual({ kind: 'landing', url: `/invite?i=${TOKEN}` });
    expect(decideBootRedirect(fresh({ ios: true, sharingEnabled: false }))).toBeNull();
  });
  test('rule 7: desktop / real Android browser → null', () => {
    expect(decideBootRedirect(fresh())).toBeNull();
  });
});

describe('readBootRedirectContext + hasStayParam', () => {
  test('gathers the env into the ctx shape', () => {
    loadIdentity.mockReturnValueOnce({ userId: 'u' });
    isTelegramInAppBrowser.mockReturnValueOnce(true);
    const ctx = readBootRedirectContext(TOKEN);
    expect(ctx).toMatchObject({
      token: TOKEN, hasIdentity: true, telegramAndroid: true,
      deepLink: `https://t.me/bot/app?startapp=${TOKEN}`,
    });
  });
  test('no token → deepLink null, token null', () => {
    const ctx = readBootRedirectContext(null);
    expect(ctx.token).toBeNull();
    expect(ctx.deepLink).toBeNull();
  });
  test('hasStayParam reads ?stay=1 from the URL', () => {
    window.history.replaceState(null, '', '/?stay=1');
    expect(hasStayParam()).toBe(true);
    window.history.replaceState(null, '', '/?i=x');
    expect(hasStayParam()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `node_modules/.bin/jest tests/inviteBootGate.test.js`
Expected: FAIL — cannot find module `../js/inviteBootGate.js`.

- [ ] **Step 3: Implement** — create `js/inviteBootGate.js`:

```js
// js/inviteBootGate.js — the /?i= boot decision (spec N3). Pure ordered rules
// (decideBootRedirect) + a thin env reader (readBootRedirectContext) so the
// gate is unit-testable without a boot harness. Wired at the top of app.js
// main(), BEFORE any Firebase work — the whole point is that no account can
// be minted before this gate runs. Phases 2/3 extend the tokenless branch
// here (spec §4).
import { isTelegramContext } from './telegram.js';
import { loadIdentity } from './identity.js';
import { isStandalone, isInAppBrowser, isIos, isTelegramInAppBrowser } from './installGuidance.js';
import { telegramSharingEnabled, buildTelegramInviteLink } from './inviteFlow.js';

// stay=1 = "the landing already offered the choice; don't bounce back" (C2).
export function hasStayParam() {
  try { return new URLSearchParams(window.location.search).get('stay') === '1'; }
  catch { return false; }
}

// Ordered; first match wins. Returns { kind: 'hop' | 'landing', url } or null
// (= proceed with today's boot).
export function decideBootRedirect(ctx) {
  if (!ctx.token) return null;                        // tokenless: phase 2/3
  if (ctx.telegramContext) return null;               // 1 · Mini App boots itself
  if (ctx.stay) return null;                          // 2 · landing already chose
  if (ctx.hasIdentity || ctx.standalone) return null; // 3 · existing identity wins (C3)
  if (ctx.telegramAndroid && ctx.deepLink) {
    return { kind: 'hop', url: ctx.deepLink };        // 4 · Q4=A zero-tap rescue
  }
  if (ctx.inAppBrowser) {
    return { kind: 'landing', url: '/invite?i=' + ctx.token }; // 5 · any webview (holistic)
  }
  if (ctx.ios && ctx.sharingEnabled) {
    // 6 · undetectable-iOS net — the only reason to drag iOS Safari through
    // the landing is the invisible Telegram webview, so Telegram-off spares it.
    return { kind: 'landing', url: '/invite?i=' + ctx.token };
  }
  return null;                                        // 7 · today's flow
}

export function readBootRedirectContext(token) {
  return {
    token: token || null,
    telegramContext: isTelegramContext(),
    stay: hasStayParam(),
    hasIdentity: !!loadIdentity(),
    standalone: isStandalone(),
    telegramAndroid: isTelegramInAppBrowser(),
    // buildTelegramInviteLink returns the full …?startapp=TOKEN URL, or null
    // when TELEGRAM_APP_LINK is unconfigured (→ rule 4 falls through to 5).
    deepLink: token ? buildTelegramInviteLink(token) : null,
    inAppBrowser: isInAppBrowser(),
    ios: isIos(),
    sharingEnabled: telegramSharingEnabled(),
  };
}
```

- [ ] **Step 4: Run** — `node_modules/.bin/jest tests/inviteBootGate.test.js`
Expected: PASS.

- [ ] **Step 5: Wire into `js/app.js`** (three edits, no new tests — covered by the module tests; on-device walkthrough covers the wiring):

(a) Add to the imports at the top of `js/app.js`:

```js
import { decideBootRedirect, readBootRedirectContext, hasStayParam } from './inviteBootGate.js';
```

(b) In `main()`, immediately after `let pendingInviteToken = extractInviteTokenFromUrl(window.location.href);` (line 564), insert:

```js
  // Mint-free rescue for legacy /?i= links (spec N3): decide BEFORE any
  // Firebase work whether this boot belongs on the /invite landing or in the
  // Mini App. replace() keeps the webview's back button from bouncing
  // through this half-booted page.
  const bootRedirect = decideBootRedirect(readBootRedirectContext(pendingInviteToken));
  if (bootRedirect) {
    window.location.replace(bootRedirect.url);
    return;
  }
```

(c) Panel skip (Q6=A phase-1 half) — change line 214 from:

```js
  if (onboardingLane({ installPromptAvailable: false }) === 'in-app-browser') {
```

to:

```js
  // stay=1 = the user just chose "Continue in browser" on the landing, which
  // already said everything this panel says (Q6=A) — don't nag twice.
  if (onboardingLane({ installPromptAvailable: false }) === 'in-app-browser' && !hasStayParam()) {
```

(d) In `cleanInviteParamFromUrl` (line 555), after `clean.searchParams.delete('i');` add:

```js
    clean.searchParams.delete('stay');
```

- [ ] **Step 6: Run the app-adjacent suites** — `node_modules/.bin/jest tests/app-boot-cacheOwner.test.js tests/app-first-follow.test.js tests/app-call-recovery.test.js`
Expected: PASS (the gate returns null in jsdom defaults: no token in test URLs / no detection).

- [ ] **Step 7: Commit**

```bash
git add js/inviteBootGate.js js/app.js tests/inviteBootGate.test.js
git commit -m "feat(boot): ordered /?i= gate — auto-hop, landing redirect, stay guard (spec N3)"
```

---

### Task 5: `/invite` hosting rewrite (spec N2)

**Files:**
- Modify: `firebase.json:17-20`
- Test: `tests/about-page.test.js` ("firebase.json routing" describe, line 183)

**Interfaces:**
- Produces: `/invite` serves `about.html` (query string passes through — Firebase rewrites don't touch it; walkthrough-verify).

- [ ] **Step 1: Write the failing test** — inside the existing `describe('firebase.json routing', …)` add:

```js
  test('/invite rewrite serves about.html and precedes the ** catch-all (spec N2)', () => {
    const rewrites = cfg.hosting.rewrites;
    const inviteIdx = rewrites.findIndex((r) => r.source === '/invite' && r.destination === '/about.html');
    const catchAllIdx = rewrites.findIndex((r) => r.source === '**');
    expect(inviteIdx).toBeGreaterThanOrEqual(0);
    expect(catchAllIdx).toBeGreaterThan(inviteIdx);
  });
```

- [ ] **Step 2: Run to verify failure** — `node_modules/.bin/jest tests/about-page.test.js -t "/invite rewrite"`
Expected: FAIL — `inviteIdx` is `-1`.

- [ ] **Step 3: Implement** — in `firebase.json`, change the rewrites array to:

```json
    "rewrites": [
      { "source": "/about", "destination": "/about.html" },
      { "source": "/invite", "destination": "/about.html" },
      { "source": "**", "destination": "/index.html" }
    ],
```

- [ ] **Step 4: Run** — `node_modules/.bin/jest tests/about-page.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add firebase.json tests/about-page.test.js
git commit -m "feat(hosting): /invite serves the mint-free about page (spec N2, #265)"
```

---

### Task 6: Build substitution gated on the feature flag (spec N5)

**Files:**
- Modify: `scripts/build.js` (renderAbout line 84-88; writeAboutHtml line 104-109; exports line 113)
- Test: `tests/about-page.test.js` ("renderAbout substitution" describe)

**Interfaces:**
- Produces: `renderAbout` substitutes `__TELEGRAM_APP_LINK__` from `vars.TELEGRAM_APP_LINK || ''`; new export `readTelegramEnabled(): boolean` (reads `js/features.js` source text). Tasks 7/8 rely on the placeholder being cleared to `''` when the flag is off.

- [ ] **Step 1: Write the failing tests** — append inside `describe('renderAbout substitution', …)`:

```js
  test('substitutes the Telegram deep link (spec N5)', () => {
    const out = renderAbout('L:__TELEGRAM_APP_LINK__', { TELEGRAM_APP_LINK: 'https://t.me/bot/app' });
    expect(out).toBe('L:https://t.me/bot/app');
  });

  test('Telegram link is blank when unset (placeholder cleared — fail-closed)', () => {
    const out = renderAbout('L:__TELEGRAM_APP_LINK__', { APP_TITLE: 'X' });
    expect(out).toBe('L:');
  });
```

And a new describe after it:

```js
describe('readTelegramEnabled (spec N5: features.js is the single source of truth)', () => {
  const { readTelegramEnabled } = require('../scripts/build.js');
  test('matches the flag literal in js/features.js source', () => {
    const src = readRoot('js/features.js');
    const expected = /export const TELEGRAM_ENABLED = true/.test(src);
    expect(readTelegramEnabled()).toBe(expected);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `node_modules/.bin/jest tests/about-page.test.js -t "Telegram"`
Expected: FAIL — output still contains `__TELEGRAM_APP_LINK__` / `readTelegramEnabled` is not a function.

- [ ] **Step 3: Implement** — in `scripts/build.js`:

(a) Add `__TELEGRAM_APP_LINK__` to `renderAbout`'s return chain (after the `__INVITE_PREVIEW_URL__` line):

```js
    .replaceAll('__TELEGRAM_APP_LINK__', vars.TELEGRAM_APP_LINK || '');
```

(b) Add above `writeAboutHtml`:

```js
// TELEGRAM_ENABLED is a hardcoded const in js/features.js (ESM — not
// requirable from this CJS script), yet the about page must never advertise a
// dead bot link when the flag is off (spec N5). Read it from the source text:
// features.js stays the single source of truth, so the page can never disagree
// with telegramSharingEnabled() (which requires flag AND link).
function readTelegramEnabled() {
  try {
    const src = readFileSync(path.resolve(__dirname, '..', 'js', 'features.js'), 'utf8');
    const m = src.match(/export const TELEGRAM_ENABLED = (true|false)/);
    return m ? m[1] === 'true' : false;
  } catch {
    return false; // fail closed: no flag, no Telegram CTA
  }
}
```

(c) In `writeAboutHtml`'s `renderAbout` vars, add:

```js
    TELEGRAM_APP_LINK: readTelegramEnabled()
      ? (process.env.TELEGRAM_APP_LINK || env.TELEGRAM_APP_LINK || '')
      : '',
```

(d) Add `readTelegramEnabled` to `module.exports`.

- [ ] **Step 4: Run** — `node_modules/.bin/jest tests/about-page.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/build.js tests/about-page.test.js
git commit -m "feat(build): __TELEGRAM_APP_LINK__ substitution gated on the features flag (spec N5)"
```

---

### Task 7: Landing markup + styles (spec N4 — template half)

**Files:**
- Modify: `about.template.html` (invite block above `.intro`; intro split; intro CTAs; script tag)
- Modify: `css/about.css` (append)
- Test: `tests/about-page.test.js` ("about.template.html content" describe)

**Interfaces:**
- Produces the DOM contract Task 8's script drives: ids `invite-landing`, `invite-telegram-cta`, `about-telegram-cta`, `about-open-cta`, `invite-copy-btn`, `invite-copy-fallback`, `about-more-btn`; body classes `invite-first`, `ios-door-promoted`. `#about-invite-framing` moves INSIDE the landing block, unchanged (`js/about-invite.js` untouched).

- [ ] **Step 1: Write the failing tests** — append inside `describe('about.template.html content', …)`:

```js
  test('has the invite landing block with fail-closed Telegram CTAs (spec N4)', () => {
    expect(tpl).toMatch(/id="invite-landing"/);
    expect(tpl).toMatch(/id="invite-telegram-cta"[^>]*data-telegram-link="__TELEGRAM_APP_LINK__"/);
    expect(tpl).toMatch(/id="about-telegram-cta"[^>]*data-telegram-link="__TELEGRAM_APP_LINK__"/);
    expect(tpl).toMatch(/id="about-open-cta"/);
    expect(tpl).toMatch(/id="invite-copy-btn"/);
    expect(tpl).toMatch(/id="about-more-btn"/);
    expect(tpl).toContain('js/about-telegram.js');
  });

  test('the framing slot lives inside the landing block (about-invite.js untouched)', () => {
    const landing = tpl.match(/<section id="invite-landing"[\s\S]*?<\/section>/);
    expect(landing).not.toBeNull();
    expect(landing[0]).toMatch(/id="about-invite-framing"/);
    expect(landing[0]).toContain('data-preview-url="__INVITE_PREVIEW_URL__"');
  });

  test('the intro lede survives config #1 (C4: split from the collapsible rest)', () => {
    expect(tpl).toMatch(/class="intro-lede"/);
    expect(tpl).toMatch(/class="intro-more"/);
    expect(readRoot('css/about.css')).toContain('body.invite-first .intro-more');
  });
```

- [ ] **Step 2: Run to verify failure** — `node_modules/.bin/jest tests/about-page.test.js -t "invite landing"`
Expected: FAIL.

- [ ] **Step 3: Implement the template** — in `about.template.html`:

(a) Replace the current `.intro` section (lines 26-38) with:

```html
    <!-- Invite landing block (spec N4): hidden until js/about-telegram.js sees
         a valid ?i=TOKEN. On /invite (config #1) the marketing below collapses
         behind the expander; on /about?i= (config #2) the full page stays. -->
    <section id="invite-landing" class="invite-landing hidden">
      <h2>You&rsquo;re invited to __APP_TITLE__</h2>
      <!-- Moved from .intro; js/about-invite.js is untouched and upgrades this
           line ("You've been invited to follow …") when the preview resolves. -->
      <p id="about-invite-framing" class="invite-framing hidden" data-preview-url="__INVITE_PREVIEW_URL__"></p>
      <p class="invite-hint">Use Telegram? Open the invite there &mdash; it works with your Telegram account, no separate sign-up.</p>
      <a id="invite-telegram-cta" class="cta hidden" data-telegram-link="__TELEGRAM_APP_LINK__">Open in Telegram</a>
      <!-- data-open-app: js/about-cta.js rewrites per platform and appends stay=1 -->
      <a class="cta" href="/" target="_blank" rel="noopener" data-open-app>Continue in browser</a>
      <p class="invite-installed-hint">Already have the app installed? Copy the invite and paste it under &ldquo;Redeem an invite&rdquo;.
        <button id="invite-copy-btn" type="button" class="invite-copy-btn">Copy invite</button></p>
      <p id="invite-copy-fallback" class="invite-copy-fallback hidden"></p>
      <button id="about-more-btn" type="button" class="about-more-btn">More about __APP_TITLE__</button>
    </section>

    <section class="intro">
      <p class="intro-lede">__APP_TITLE__ is about <em>ambient presence</em> &mdash; a soft signal that you're around and open to company, without the pressure of a chat thread.</p>
      <p class="intro-more">Mark yourself available for a little while, and the handful of people you've chosen simply see it. When the timer runs out, you fade back to quiet.</p>
      <!-- intentional: open the app in a new tab to keep this page in place.
           data-open-app: on iOS/Android, js/about-cta.js rewrites this to a
           platform scheme that opens the real browser (escapes in-app browsers
           like Telegram); on desktop it stays this normal new-tab link. -->
      <a id="about-open-cta" class="cta" href="/" target="_blank" rel="noopener" data-open-app>Open __APP_TITLE__ &rarr;</a>
      <!-- Standing bare Telegram door (A3): unhidden by js/about-telegram.js on
           token-less pages when the build substituted a real deep link. -->
      <a id="about-telegram-cta" class="cta hidden" data-telegram-link="__TELEGRAM_APP_LINK__" target="_blank" rel="noopener">Open in Telegram</a>
    </section>
```

Preserve the original `<em>ambient presence</em>` markup exactly — the status-color easter egg styles it (`css/about.css` `var(--status-echo, var(--green))`) and its test must keep passing.

(b) Add the new script tag BEFORE the two existing ones (the pass-through should run first; all three are classic, CSP `script-src 'self'`, no hash needed):

```html
  <!-- Invite landing + Telegram doors + identity pass-through (spec N4). -->
  <script src="js/about-telegram.js"></script>
```

(Task 8 creates the file; an unresolvable script tag is harmless in the meantime but keep Tasks 7+8 in the same session.)

- [ ] **Step 4: Implement the styles** — append to `css/about.css`:

```css
/* ---- Invite landing (spec N4) ---- */
.invite-landing { text-align: center; }
.invite-landing .cta { display: block; margin: 12px auto; max-width: 320px; }
.invite-hint,
.invite-installed-hint { font-size: 0.9rem; opacity: 0.85; }
.invite-copy-btn { font: inherit; }
.invite-copy-fallback { user-select: all; word-break: break-all; font-size: 0.85rem; }
.about-more-btn { display: none; font: inherit; margin: 18px auto 0; }
/* Config #1 (/invite?i=): marketing collapses behind the expander; the lede
   stays visible (C4) so a stranger has minimum context to choose a door. */
body.invite-first .intro-more,
body.invite-first .features,
body.invite-first .privacy-short,
body.invite-first .privacy-detail { display: none; }
body.invite-first .about-more-btn { display: block; }
/* C5 (implement-and-evaluate): on iOS, promote the installed-app door. */
body.ios-door-promoted .invite-installed-hint { font-size: 1rem; opacity: 1; }
```

Visual fine-tuning is the operator's on-device call — keep these minimal.

- [ ] **Step 5: Run** — `node_modules/.bin/jest tests/about-page.test.js`
Expected: PASS — including the pre-existing "invite-framing slot" and "theme bootstrap parity" and "easter egg" tests (the framing element moved but kept its id/attributes; the inline head scripts are untouched).

- [ ] **Step 6: Commit**

```bash
git add about.template.html css/about.css tests/about-page.test.js
git commit -m "feat(about): invite landing block, standing Telegram door, config #1 collapse styles (spec N4)"
```

---

### Task 8: Landing behavior script (spec N4 — `about-telegram.js`)

**Files:**
- Create: `js/about-telegram.js` (classic script)
- Test: `tests/about-page.test.js` (new describe, `vm` harness like the existing `about-cta` one)

**Interfaces:**
- Consumes: Task 7's DOM ids; `statusapp_identity` localStorage key; `__TELEGRAM_APP_LINK__` substitution (placeholder check `indexOf('__') === 0`, mirroring `js/about-invite.js:15`).
- Produces: config selection, one-door rule, C1 pass-through (`location.replace('/?i=TOKEN&stay=1')`), copy + C7 fallback, `invite-first`/`ios-door-promoted` body classes.

- [ ] **Step 1: Write the failing tests** — append to `tests/about-page.test.js`:

```js
describe('about-telegram behavior (spec N4: configs, doors, pass-through)', () => {
  const vm = require('vm');
  const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';

  function makeEl(attrs = {}) {
    const cls = new Set(['hidden']);
    return {
      attrs: { ...attrs }, handlers: {}, textContent: '',
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener(t, f) { this.handlers[t] = f; },
    };
  }

  function runScript({ pathname = '/invite', search = '', link = 'https://t.me/bot/app', identity = null, ua = 'Mozilla/5.0 (Linux; Android 14) Chrome/120', clipboardOk = true } = {}) {
    const els = {
      'about-telegram-cta': makeEl({ 'data-telegram-link': link }),
      'about-open-cta': makeEl(),
      'invite-landing': makeEl(),
      'invite-telegram-cta': makeEl({ 'data-telegram-link': link }),
      'invite-copy-btn': makeEl(),
      'invite-copy-fallback': makeEl(),
      'about-more-btn': makeEl(),
    };
    const bodyCls = new Set();
    const replaced = [];
    const sandbox = {
      URLSearchParams, Promise,
      setTimeout: (f) => f(),
      navigator: {
        userAgent: ua, maxTouchPoints: 0,
        clipboard: { writeText: () => (clipboardOk ? Promise.resolve() : Promise.reject(new Error('denied'))) },
      },
      localStorage: { getItem: (k) => (k === 'statusapp_identity' ? identity : null) },
      location: { pathname, search, origin: 'https://knock.example', replace: (u) => replaced.push(u) },
      document: {
        getElementById: (id) => els[id] || null,
        body: { classList: { add: (c) => bodyCls.add(c), remove: (c) => bodyCls.delete(c), contains: (c) => bodyCls.has(c) } },
      },
    };
    vm.runInNewContext(readRoot('js/about-telegram.js'), sandbox);
    return { els, bodyCls, replaced };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  test('token-less page: standing bare CTA unhides with a real link (A3)', () => {
    const { els } = runScript({ pathname: '/about', search: '' });
    expect(els['about-telegram-cta'].classList.contains('hidden')).toBe(false);
    expect(els['about-telegram-cta'].attrs.href).toBe('https://t.me/bot/app');
    expect(els['invite-landing'].classList.contains('hidden')).toBe(true);
  });

  test('token-less + unsubstituted placeholder: everything stays hidden (fail-closed)', () => {
    const { els } = runScript({ pathname: '/about', search: '', link: '__TELEGRAM_APP_LINK__' });
    expect(els['about-telegram-cta'].classList.contains('hidden')).toBe(true);
  });

  test('config #1 (/invite + token): landing shows, token CTA composed, intro doors hidden, marketing collapsed', () => {
    const { els, bodyCls } = runScript({ search: `?i=${TOKEN}` });
    expect(els['invite-landing'].classList.contains('hidden')).toBe(false);
    expect(els['invite-telegram-cta'].attrs.href).toBe(`https://t.me/bot/app?startapp=${TOKEN}`);
    expect(els['invite-telegram-cta'].classList.contains('hidden')).toBe(false);
    expect(els['about-telegram-cta'].classList.contains('hidden')).toBe(true);
    expect(els['about-open-cta'].classList.contains('hidden')).toBe(true);
    expect(bodyCls.has('invite-first')).toBe(true);
  });

  test('config #2 (/about + token): landing shows, marketing NOT collapsed', () => {
    const { els, bodyCls } = runScript({ pathname: '/about', search: `?i=${TOKEN}` });
    expect(els['invite-landing'].classList.contains('hidden')).toBe(false);
    expect(bodyCls.has('invite-first')).toBe(false);
  });

  test('placeholder link with a token: Telegram CTA stays hidden, landing still shows', () => {
    const { els } = runScript({ search: `?i=${TOKEN}`, link: '__TELEGRAM_APP_LINK__' });
    expect(els['invite-telegram-cta'].classList.contains('hidden')).toBe(true);
    expect(els['invite-landing'].classList.contains('hidden')).toBe(false);
  });

  test('C1 pass-through: /invite + token + identity → replace(/?i=…&stay=1), landing untouched', () => {
    const { els, replaced } = runScript({ search: `?i=${TOKEN}`, identity: '{"userId":"u1"}' });
    expect(replaced).toEqual([`/?i=${TOKEN}&stay=1`]);
    expect(els['invite-landing'].classList.contains('hidden')).toBe(true);
  });

  test('no pass-through on /about?i= (config #2 is a reading page)', () => {
    const { replaced, els } = runScript({ pathname: '/about', search: `?i=${TOKEN}`, identity: '{"userId":"u1"}' });
    expect(replaced).toEqual([]);
    expect(els['invite-landing'].classList.contains('hidden')).toBe(false);
  });

  test('malformed token behaves as token-less', () => {
    const { els } = runScript({ search: '?i=' + encodeURIComponent('bad token!') });
    expect(els['invite-landing'].classList.contains('hidden')).toBe(true);
    expect(els['about-telegram-cta'].classList.contains('hidden')).toBe(false);
  });

  test('copy: success gives button feedback', async () => {
    const { els } = runScript({ search: `?i=${TOKEN}` });
    els['invite-copy-btn'].handlers.click();
    await flush();
    expect(els['invite-copy-btn'].textContent).toBe('Copy invite'); // set to 'Copied' then restored by the immediate fake setTimeout
    expect(els['invite-copy-fallback'].classList.contains('hidden')).toBe(true);
  });

  test('copy: denied clipboard falls back to a selectable URL (C7)', async () => {
    const { els } = runScript({ search: `?i=${TOKEN}`, clipboardOk: false });
    els['invite-copy-btn'].handlers.click();
    await flush();
    expect(els['invite-copy-fallback'].textContent).toBe(`https://knock.example/invite?i=${TOKEN}`);
    expect(els['invite-copy-fallback'].classList.contains('hidden')).toBe(false);
  });

  test('iOS UA promotes the installed-app door (C5)', () => {
    const { bodyCls } = runScript({ search: `?i=${TOKEN}`, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari/604.1' });
    expect(bodyCls.has('ios-door-promoted')).toBe(true);
  });

  test('expander click un-collapses config #1', () => {
    const { els, bodyCls } = runScript({ search: `?i=${TOKEN}` });
    expect(bodyCls.has('invite-first')).toBe(true);
    els['about-more-btn'].handlers.click();
    expect(bodyCls.has('invite-first')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `node_modules/.bin/jest tests/about-page.test.js -t "about-telegram"`
Expected: FAIL — cannot read `js/about-telegram.js`.

- [ ] **Step 3: Implement** — create `js/about-telegram.js`:

```js
// js/about-telegram.js
// /about + /invite only. Owns the Telegram-facing page behavior (spec N4):
//   - token-less pages: unhide the standing bare "Open in Telegram" CTA when
//     the build substituted a real deep link (fail-closed on __…__);
//   - valid ?i=TOKEN: show the invite block (one set of doors — the intro's
//     CTAs hide), compose the token-carrying Telegram CTA, wire the copy
//     button (with a selectable-text fallback, C7);
//   - /invite (config #1): identity-aware pass-through when this browser
//     already holds an account (no mint risk — straight into the app, C1),
//     else collapse the marketing behind the "More about …" expander.
// Plain classic script (CSP script-src 'self'); tested via vm sandbox.
(function () {
  function realLink(el) {
    var v = el && el.getAttribute('data-telegram-link');
    return (v && v.indexOf('__') !== 0) ? v : null; // unsubstituted placeholder → no link
  }

  var t = null;
  try { t = new URLSearchParams(location.search).get('i'); } catch (e) { /* unusual URL */ }
  var token = (t && /^[A-Za-z0-9_-]{1,64}$/.test(t)) ? t : null;

  var introTg = document.getElementById('about-telegram-cta');

  if (!token) {
    // Plain marketing page: just the standing bare Telegram door (A3).
    var bare = realLink(introTg);
    if (bare) { introTg.setAttribute('href', bare); introTg.classList.remove('hidden'); }
    return;
  }

  var onInvitePath = location.pathname === '/invite';

  // Identity-aware pass-through (C1): an account in THIS browser means no mint
  // risk — skip the landing entirely. stay=1 keeps the boot gate from bouncing
  // back. /about?i= deliberately does not pass through (it is a reading page).
  if (onInvitePath) {
    var hasIdentity = false;
    try { hasIdentity = !!localStorage.getItem('statusapp_identity'); } catch (e) { /* storage blocked */ }
    if (hasIdentity) { location.replace('/?i=' + token + '&stay=1'); return; }
  }

  var landing = document.getElementById('invite-landing');
  if (!landing) return; // stale cached page without the block — do nothing

  // One set of doors: while the invite block shows, the intro's CTAs hide —
  // two "Open in Telegram" buttons where only one carries the invite would
  // silently drop the token on the wrong tap.
  if (introTg) introTg.classList.add('hidden');
  var introOpen = document.getElementById('about-open-cta');
  if (introOpen) introOpen.classList.add('hidden');

  var tgCta = document.getElementById('invite-telegram-cta');
  var deep = realLink(tgCta);
  if (deep) {
    tgCta.setAttribute('href', deep + '?startapp=' + token);
    tgCta.classList.remove('hidden');
  }

  landing.classList.remove('hidden');

  // Config #1: marketing collapses behind the expander (CSS keys off the class;
  // script-off fallback = fully expanded page, nothing unreachable).
  if (onInvitePath) document.body.classList.add('invite-first');

  // C5 (implement-and-evaluate): promote the installed-app door on iOS.
  // Mirrors about-cta.js's inline check (iPadOS reports as Macintosh + touch).
  var ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 0)) {
    document.body.classList.add('ios-door-promoted');
  }

  var moreBtn = document.getElementById('about-more-btn');
  if (moreBtn) {
    moreBtn.addEventListener('click', function () {
      document.body.classList.remove('invite-first');
    });
  }

  var copyBtn = document.getElementById('invite-copy-btn');
  var copyOut = document.getElementById('invite-copy-fallback');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var url = location.origin + '/invite?i=' + token;
      var write = (navigator.clipboard && navigator.clipboard.writeText)
        ? navigator.clipboard.writeText(url)
        : Promise.reject(new Error('no clipboard api'));
      write.then(function () {
        copyBtn.textContent = 'Copied';
        setTimeout(function () { copyBtn.textContent = 'Copy invite'; }, 1500);
      }).catch(function () {
        // Webviews commonly deny clipboard writes (C7) — show the URL to select.
        if (copyOut) { copyOut.textContent = url; copyOut.classList.remove('hidden'); }
      });
    });
  }
})();
```

- [ ] **Step 4: Run** — `node_modules/.bin/jest tests/about-page.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/about-telegram.js tests/about-page.test.js
git commit -m "feat(about): landing behavior — configs, Telegram doors, C1 pass-through, C7 copy fallback (spec N4)"
```

---

### Task 9: Unconditional `stay=1` loop guard (spec N4/C2)

**Files:**
- Modify: `js/about-cta.js:21-25`
- Test: `tests/about-page.test.js` ("about-cta link rewriting" describe — update expectations)

**Interfaces:**
- Produces: every rewritten `data-open-app` link carries `stay=1` (token or not); desktop links are rewritten only when a token needs carrying (a desktop tab is never a webview, so no loop risk there).

- [ ] **Step 1: Update the tests to the new contract** — in the `about-cta link rewriting` describe, replace the four affected tests:

```js
  test('desktop with no token: link is left untouched', () => {
    const link = runCta({ ua: DESKTOP, search: '' });
    expect(link.attrs.href).toBeUndefined();
  });
  test('desktop with token: carries ?i= AND stay=1 on the normal link (C2)', () => {
    const link = runCta({ ua: DESKTOP, search: '?i=ABC123' });
    expect(link.attrs.href).toBe('/?i=ABC123&stay=1');
  });
  test('iOS: x-safari-https carries token + stay=1, drops target', () => {
    const link = runCta({ ua: IPHONE, search: '?i=ABC123' });
    expect(link.attrs.href).toBe('x-safari-https://knock.example/?i=ABC123&stay=1');
    expect(link.attrs.target).toBeUndefined();
  });
  test('iOS with no token: stay=1 still rides (C2 — tokenless loop guard)', () => {
    const link = runCta({ ua: IPHONE, search: '' });
    expect(link.attrs.href).toBe('x-safari-https://knock.example/?stay=1');
  });
  test('Android: intent:// with token + stay=1, fallback URL carries both too', () => {
    const link = runCta({ ua: ANDROID, search: '?i=ABC123' });
    expect(link.attrs.href).toContain('intent://knock.example/?i=ABC123&stay=1#Intent;scheme=https;');
    expect(link.attrs.href).toContain('browser_fallback_url=' + encodeURIComponent('https://knock.example/?i=ABC123&stay=1'));
    expect(link.attrs.href).toMatch(/;end$/);
  });
  test('Android with no token: stay=1 still rides, incl. the fallback URL', () => {
    const link = runCta({ ua: ANDROID, search: '' });
    expect(link.attrs.href).toContain('intent://knock.example/?stay=1#Intent');
    expect(link.attrs.href).toContain('browser_fallback_url=' + encodeURIComponent('https://knock.example/?stay=1'));
  });
  test('malformed token on desktop: treated as none → untouched', () => {
    const link = runCta({ ua: DESKTOP, search: '?i=' + encodeURIComponent('bad token!') });
    expect(link.attrs.href).toBeUndefined();
  });
```

- [ ] **Step 2: Run to verify failure** — `node_modules/.bin/jest tests/about-page.test.js -t "about-cta"`
Expected: FAIL — hrefs missing `stay=1`.

- [ ] **Step 3: Implement** — in `js/about-cta.js`, replace lines 21-25:

```js
  var token = new URLSearchParams(location.search).get('i');
  var valid = !!(token && /^[A-Za-z0-9_-]{1,64}$/.test(token));
  // stay=1 rides EVERY rewritten link (spec C2): it tells the app boot "the
  // user chose this from the landing", so the gate never bounces back — and it
  // must survive the tokenless intent:// browser_fallback_url that can
  // re-enter the SAME webview when the intent is blocked (the phase-2 loop).
  var query = valid ? '?i=' + token + '&stay=1' : '?stay=1';

  // Desktop only rewrites when a token needs carrying; a desktop tab is never
  // a webview, so an as-authored link has no loop risk.
  if (!isAndroid && !isIOS && !valid) return;
```

(Also update the file's header comment `?i=…` examples to mention `stay=1`.)

- [ ] **Step 4: Run** — `node_modules/.bin/jest tests/about-page.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/about-cta.js tests/about-page.test.js
git commit -m "feat(about): stay=1 rides every rewritten open-app link (spec C2)"
```

---

### Task 10: Unified "Redeem an invite" form (spec N6)

**Files:**
- Modify: `index.template.html:331-346` (copy, ids, maxlength, status line)
- Modify: `js/following.js` (imports; `initList` signature; input handler at 253-255; `handleAddPerson` at 1145; new `updateAddFormMode`, `handleRedeemInvite`, `redeemFailureMessage`; `closeAddForm` at 1207)
- Modify: `js/firstRun.js:61-62` (remove the relabel)
- Modify: `js/app.js` (the single `initList(` call — pass the redemption callback)
- Test: `tests/following.test.js` (fixture + new describe), `tests/firstRun.test.js` (drop relabel assertions)

**Interfaces:**
- Consumes: Task 3's `extractInviteTokenFromText` (from `js/inviteText.js`); existing `attemptRedeemFromUrl(token, uid, code, opts)` / `resolveInvitePreview(token)` (`js/invites.js`); `showGroupDisplayNamePrompt(groupName, prefill)` (`js/groupDisplayNamePrompt.js` — same import app.js uses).
- Produces: `initList(myUserId, myCode, { onInviteRedeemed })` — the callback receives an `ok` redemption result; app.js supplies toast + group navigation.

- [ ] **Step 1: Template copy** — replace `index.template.html:331-346` with:

```html
      <div id="add-person-area">
      <button id="add-person-btn" class="add-btn">Redeem an invite</button>
      <div id="add-person-form">
        <div class="add-form">
          <label class="field-label" for="add-code-input">Code or invite link</label>
          <input id="add-code-input" type="text" maxlength="200" placeholder="e.g. XK7P2M or an invite link" class="code-input" autocomplete="off" />
          <p id="add-invite-status" class="hint hidden"></p>
          <label id="add-label-label" class="field-label" for="add-label-input">Name (optional)</label>
          <input id="add-label-input" type="text" maxlength="40" placeholder="e.g. Partner, Mom" class="text-input" />
          <p id="add-error" class="error-msg hidden"></p>
          <div style="display:flex;gap:8px">
            <button id="add-submit-btn" class="primary-btn">Follow</button>
            <button id="add-cancel-btn" class="ghost-btn">Cancel</button>
          </div>
        </div>
      </div>
      </div>
```

(Changes: button text, label text + `id="add-label-label"`, `maxlength="6"`→`"200"`, new placeholder, new `#add-invite-status` line. Everything else byte-identical.)

- [ ] **Step 2: Remove the first-run relabel** — in `js/firstRun.js`, delete lines 61-62:

```js
  const addBtn = document.getElementById('add-person-btn');
  if (addBtn) addBtn.textContent = empty ? 'Add by code' : 'Add a person';
```

(The `first-run-demoted` class toggle on line 60 stays — presentation only. Operator decision: "Redeem an invite" reads correctly in every state, so the relabel machinery goes.)

- [ ] **Step 3: Update the failing firstRun tests** — in `tests/firstRun.test.js`, the assertions at lines 57, 66, 75-82 assert the old relabel. Replace them so the tests assert the button text is NOT touched:

```js
  // at ~:57 (empty state):
  expect(document.getElementById('add-person-btn').textContent).toBe('Redeem an invite');
  // at ~:66 (non-empty state):
  expect(document.getElementById('add-person-btn').textContent).toBe('Redeem an invite');
```

The DOM fixture at `tests/firstRun.test.js:18` must set the button's initial text to `Redeem an invite` (mirroring the template). The "sentinel" test (~:75-82) inverts: setListEmpty must now LEAVE `sentinel` in place in both states — update both its assertions to `toBe('sentinel')`.

- [ ] **Step 4: Run to verify the firstRun suite passes** — `node_modules/.bin/jest tests/firstRun.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing form-mode tests** — in `tests/following.test.js`:

(a) Add module mocks next to the existing ones (top of file — `js/invites.js` and `js/groupDisplayNamePrompt.js` are NEW imports of following.js, so they must be mocked; `js/inviteText.js` is pure and stays real):

```js
jest.mock('../js/invites.js', () => ({
  attemptRedeemFromUrl: jest.fn(),
  resolveInvitePreview: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../js/groupDisplayNamePrompt.js', () => ({
  showGroupDisplayNamePrompt: jest.fn(() => Promise.resolve('Me')),
}));
```

(b) In the DOM fixture (the template literal around lines 185-190 containing `add-person-form`), mirror the new template: add `<p id="add-invite-status" class="hint hidden"></p>` after the code input and `id="add-label-label"` on the name label.

(c) New describe (place after the existing add-person-form-mode describe, reusing the file's established init pattern — call `initList` exactly the way the neighboring tests do, adding the third argument):

```js
describe('unified redeem form (spec N6)', () => {
  const { attemptRedeemFromUrl, resolveInvitePreview } = require('../js/invites.js');
  const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
  const INVITE_URL = `https://knock.example/invite?i=${TOKEN}`;
  const input = () => document.getElementById('add-code-input');
  const type = (v) => { input().value = v; input().dispatchEvent(new Event('input', { bubbles: true })); };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  test('typing a code keeps code mode: uppercased, Name visible, button "Follow"', () => {
    type('xk7p2m');
    expect(input().value).toBe('XK7P2M');
    expect(document.getElementById('add-label-input').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('add-submit-btn').textContent).toBe('Follow');
    expect(document.getElementById('add-invite-status').classList.contains('hidden')).toBe(true);
  });

  test('pasting an invite link switches to invite mode: no uppercasing, Name hidden, button "Redeem invite", status line shown', () => {
    type(INVITE_URL);
    expect(input().value).toBe(INVITE_URL); // case preserved — tokens are case-sensitive
    expect(document.getElementById('add-label-input').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('add-label-label').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('add-submit-btn').textContent).toBe('Redeem invite');
    expect(document.getElementById('add-invite-status').textContent).toBe('Invite link detected');
  });

  test('preview upgrades the status line (fail-soft covered by the default null mock elsewhere)', async () => {
    resolveInvitePreview.mockResolvedValueOnce({ scope: 'personal', label: 'Ana' });
    type(INVITE_URL);
    await flush();
    expect(document.getElementById('add-invite-status').textContent).toBe("You'll follow Ana");
  });

  test('clearing the input restores code mode', () => {
    type(INVITE_URL);
    type('');
    expect(document.getElementById('add-label-input').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('add-submit-btn').textContent).toBe('Follow');
  });

  test('submit in invite mode redeems through the existing pipeline and fires the callback on ok', async () => {
    attemptRedeemFromUrl.mockResolvedValueOnce({ ok: true, creatorLabel: 'Ana' });
    type(INVITE_URL);
    document.getElementById('add-submit-btn').click();
    await flush();
    expect(attemptRedeemFromUrl).toHaveBeenCalledWith(TOKEN, expect.anything(), expect.anything(), {});
    expect(onInviteRedeemed).toHaveBeenCalledWith({ ok: true, creatorLabel: 'Ana' }); // the spy passed to initList
  });

  test('group invite prompts for a display name mid-flight, passing the cache forward', async () => {
    attemptRedeemFromUrl
      .mockResolvedValueOnce({ ok: false, reason: 'needs-display-name', groupId: 'G1', groupName: 'Hikers', cache: { marker: 1 } })
      .mockResolvedValueOnce({ ok: true, groupId: 'G1', groupName: 'Hikers' });
    type(INVITE_URL);
    document.getElementById('add-submit-btn').click();
    await flush();
    expect(attemptRedeemFromUrl).toHaveBeenLastCalledWith(TOKEN, expect.anything(), expect.anything(),
      { displayName: 'Me', cache: { marker: 1 } });
  });

  test('failure maps to an inline error, form stays open', async () => {
    attemptRedeemFromUrl.mockResolvedValueOnce({ ok: false, reason: 'expired' });
    type(INVITE_URL);
    document.getElementById('add-submit-btn').click();
    await flush();
    expect(document.getElementById('add-error').textContent).toBe('This invite link has expired.');
    expect(document.getElementById('add-error').classList.contains('hidden')).toBe(false);
  });

  test('garbage on submit gets the unified error', async () => {
    type('hello there');
    document.getElementById('add-submit-btn').click();
    await flush();
    expect(document.getElementById('add-error').textContent).toBe("That doesn't look like a code or an invite link.");
  });
});
```

`onInviteRedeemed` is a `jest.fn()` the describe's setup passes as `initList(USER, CODE, { onInviteRedeemed })` — mirror the file's existing `initList` setup (beforeEach) with the extra argument, and define the spy there.

- [ ] **Step 6: Run to verify failure** — `node_modules/.bin/jest tests/following.test.js -t "unified redeem"`
Expected: FAIL.

- [ ] **Step 7: Implement `js/following.js`:**

(a) Imports (top of file):

```js
import { extractInviteTokenFromText } from './inviteText.js';
import { attemptRedeemFromUrl, resolveInvitePreview } from './invites.js';
import { showGroupDisplayNamePrompt } from './groupDisplayNamePrompt.js';
```

(b) `initList` signature (line 95) becomes:

```js
export function initList(myUserId, myCode, { onInviteRedeemed = null } = {}) {
  _onInviteRedeemed = onInviteRedeemed;
```

with a module-level `let _onInviteRedeemed = null;` near the other module state.

(c) Replace the uppercasing input handler (lines 253-255):

```js
  document.getElementById('add-code-input').addEventListener('input', (e) => {
    // Invite links/tokens are case-sensitive — only code mode uppercases.
    if (updateAddFormMode(e.target.value) === 'code') e.target.value = e.target.value.toUpperCase();
  });
```

(d) Add the mode functions (place next to `handleAddPerson`):

```js
// Invite-vs-code mode for the unified "Redeem an invite" form (spec N6). The
// status line doubles as the preview surface: it upgrades to "You'll follow …"
// when resolveInvitePreview lands, and stays at the generic detection text on
// any preview failure (fail-soft — submit still redeems).
let _inviteModeToken = null;
let _previewSeq = 0;
function updateAddFormMode(raw) {
  const token = extractInviteTokenFromText(raw);
  if (token !== null && token === _inviteModeToken) return 'invite'; // unchanged — don't re-fire the preview
  _inviteModeToken = token;
  const statusEl = document.getElementById('add-invite-status');
  const submit = document.getElementById('add-submit-btn');
  const labelEls = [document.getElementById('add-label-label'), document.getElementById('add-label-input')];
  if (!token) {
    statusEl.textContent = '';
    statusEl.classList.add('hidden');
    labelEls.forEach((el) => el && el.classList.remove('hidden'));
    submit.textContent = 'Follow';
    return 'code';
  }
  labelEls.forEach((el) => el && el.classList.add('hidden'));
  submit.textContent = 'Redeem invite';
  statusEl.textContent = 'Invite link detected';
  statusEl.classList.remove('hidden');
  const seq = ++_previewSeq;
  resolveInvitePreview(token).then((p) => {
    if (seq !== _previewSeq || !p) return; // stale input or dead token — keep the generic text
    statusEl.textContent = p.scope === 'group'
      ? `You'll join '${p.groupName || 'a group'}'`
      : `You'll follow ${p.label || 'someone'}`;
  }).catch(() => { /* fail-soft (spec N6) */ });
  return 'invite';
}

function redeemFailureMessage(reason) {
  switch (reason) {
    case 'already-following': return "You're already following them.";
    case 'already-member': return "You're already in that group.";
    case 'self': return "That's your own invite.";
    case 'revoked':
    case 'expired': return 'This invite link has expired.';
    case 'cap': return 'This invite has reached its limit.';
    default: return "That invite link isn't valid.";
  }
}

// Invite-mode submit (spec N6): the exact boot-redemption pipeline, reused.
// Group invites prompt for a display name mid-flight, same as the URL flow
// (app.js:675) — the cache handoff skips the duplicate index/group reads.
async function handleRedeemInvite(myUserId, myCode, token) {
  const errorEl = document.getElementById('add-error');
  const submit = document.getElementById('add-submit-btn');
  errorEl.classList.add('hidden');
  submit.disabled = true;
  try {
    let result = await attemptRedeemFromUrl(token, myUserId, myCode, {});
    if (result && result.ok === false && result.reason === 'needs-display-name') {
      const displayName = await showGroupDisplayNamePrompt(result.groupName || 'this group', '');
      result = await attemptRedeemFromUrl(token, myUserId, myCode, { displayName, cache: result.cache });
    }
    if (result && result.ok) {
      closeAddForm();
      renderList();
      if (_onInviteRedeemed) await _onInviteRedeemed(result);
      return;
    }
    showError(errorEl, redeemFailureMessage(result && result.reason));
  } finally {
    submit.disabled = false;
  }
}
```

(e) Branch `handleAddPerson` (line 1145) — after reading the input, before the code validation:

```js
  const raw = codeInput.value.trim();
  const inviteToken = extractInviteTokenFromText(raw);
  if (inviteToken) return handleRedeemInvite(myUserId, myCode, inviteToken);
  const code = raw.toUpperCase();
```

and change the shape-error message (the old `'Code must be 6 letters and numbers.'` in BOTH `handleAddPerson` and the Enter-key handler at line 264) to the unified copy:

```js
    showError(errorEl, "That doesn't look like a code or an invite link.");
```

(f) Reset the mode when the form closes — at the end of `closeAddForm` (line 1207), after the existing resets:

```js
  updateAddFormMode(''); // back to code mode (labels, button, status line)
```

- [ ] **Step 8: Wire the callback in `js/app.js`** — find the single `initList(` call and extend it:

```js
  initList(userId, code, {
    // In-app redemption (spec N6): same success surface as the URL flow —
    // the first-follow beat toast, and group joins navigate into the group.
    onInviteRedeemed: async (result) => {
      handleInviteRedemptionResult(result);
      if (result.groupId) {
        if (result.groupName) setLastKnownGroupName(result.groupId, result.groupName);
        await navigateToGroup(result.groupId);
      }
    },
  });
```

(All three symbols — `handleInviteRedemptionResult`, `setLastKnownGroupName`, `navigateToGroup` — are already in `app.js`'s scope; see lines 693-706. The callback keeps following.js free of an app.js import cycle.)

- [ ] **Step 9: Run** — `node_modules/.bin/jest tests/following.test.js tests/firstRun.test.js`
Expected: PASS — the new describe and every pre-existing following test (code mode is byte-for-byte today's behavior; the Enter-key handler still works on codes).

- [ ] **Step 10: Commit**

```bash
git add index.template.html js/following.js js/firstRun.js js/app.js tests/following.test.js tests/firstRun.test.js
git commit -m "feat(follow): unified 'Redeem an invite' form — content-detected mode + preview (spec N6)"
```

---

### Task 11: Interstitial "What is KnockKnock?" link (spec N8)

**Files:**
- Modify: `index.template.html:62-70` (one button), `js/telegramFirstRun.js:63-90, 151`
- Test: `tests/telegramFirstRun.test.js` (fixture + new tests)

**Interfaces:**
- Consumes: `tgWebApp()` (already imported in telegramFirstRun.js); Task 5's `/invite` route.
- Produces: `showInterstitial(preview, isNew, token)` (third parameter added; the gate's call site passes the token it already holds).

- [ ] **Step 1: Write the failing tests** — in `tests/telegramFirstRun.test.js`: add the button to the `SCREEN` fixture (after the dismiss button):

```html
    <button id="tg-invite-about-btn" class="hidden"></button>
```

and append:

```js
describe('interstitial info link (spec N8/A4)', () => {
  const arm = (preview) => {
    mockWa.initDataUnsafe = { start_param: TOKEN };
    resolveInvitePreview.mockResolvedValue(preview || { scope: 'personal', label: 'Ana' });
  };

  test('first-ever open (isNew): link visible; returning-unlinked: hidden', async () => {
    arm();
    let gate = telegramInviteGate({ linked: false, isNew: true, dismissSplash: jest.fn() });
    await flush();
    expect(document.getElementById('tg-invite-about-btn').classList.contains('hidden')).toBe(false);
    document.getElementById('tg-invite-dismiss-btn').click();
    await gate;
    localStorage.clear(); // un-stamp the dismissal so the gate re-offers
    gate = telegramInviteGate({ linked: false, isNew: false, dismissSplash: jest.fn() });
    await flush();
    expect(document.getElementById('tg-invite-about-btn').classList.contains('hidden')).toBe(true);
    document.getElementById('tg-invite-dismiss-btn').click();
    await gate;
  });

  test('click opens /invite?i=TOKEN via openLink and does NOT resolve the interstitial', async () => {
    arm();
    mockWa.openLink = jest.fn();
    const gate = telegramInviteGate({ linked: false, isNew: true, dismissSplash: jest.fn() });
    await flush();
    document.getElementById('tg-invite-about-btn').click();
    expect(mockWa.openLink).toHaveBeenCalledWith(`${window.location.origin}/invite?i=${TOKEN}`);
    // still open — accepting afterwards works normally
    document.getElementById('tg-invite-accept-btn').click();
    await expect(gate).resolves.toMatchObject({ token: TOKEN, silent: false });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `node_modules/.bin/jest tests/telegramFirstRun.test.js -t "info link"`
Expected: FAIL — the button stays hidden / `openLink` never called.

- [ ] **Step 3: Implement:**

(a) `index.template.html` — inside `#tg-invite-screen`, after the dismiss button (line 68):

```html
      <!-- A4: answers "what am I signing up to" for t.me-link arrivals; opens
           the /invite landing in Telegram's browser so the user returns here.
           First-ever open only (isNew) — js/telegramFirstRun.js toggles it. -->
      <button id="tg-invite-about-btn" class="ghost-btn hidden" type="button">What is KnockKnock?</button>
```

(b) `js/telegramFirstRun.js` — `showInterstitial` gains the token and the wiring:

```js
function showInterstitial(preview, isNew, token) {
  const el = document.getElementById('tg-invite-screen');
  if (!el) return Promise.resolve('dismiss');
  document.getElementById('tg-invite-framing').textContent = framingText(preview);
  // "& get started" only on a first-ever open — a returning Mini App user
  // started long ago, so they get a plain "Accept" (spec 2026-07-07).
  document.getElementById('tg-invite-accept-btn').textContent =
    isNew ? 'Accept & get started' : 'Accept';
  // "What is KnockKnock?" rides the same isNew flag (A4): only a first-ever
  // open needs the pitch; it opens the /invite landing and returns here.
  const about = document.getElementById('tg-invite-about-btn');
  if (about) about.classList.toggle('hidden', !isNew);
  el.classList.remove('hidden');
  return new Promise((resolve) => {
    const accept = document.getElementById('tg-invite-accept-btn');
    const phrase = document.getElementById('tg-invite-phrase-btn');
    const dismiss = document.getElementById('tg-invite-dismiss-btn');
    function pick(choice) {
      accept.removeEventListener('click', onAccept);
      phrase.removeEventListener('click', onPhrase);
      dismiss.removeEventListener('click', onDismiss);
      if (about) about.removeEventListener('click', onAbout);
      el.classList.add('hidden');
      resolve(choice);
    }
    function onAccept() { pick('accept'); }
    function onPhrase() { pick('phrase'); }
    function onDismiss() { pick('dismiss'); }
    function onAbout() {
      // Deliberately does NOT resolve — the user reads and comes back.
      const url = window.location.origin + '/invite?i=' + token;
      const wa = tgWebApp();
      if (wa && typeof wa.openLink === 'function') wa.openLink(url);
      else window.open(url, '_blank', 'noopener');
    }
    accept.addEventListener('click', onAccept);
    phrase.addEventListener('click', onPhrase);
    dismiss.addEventListener('click', onDismiss);
    if (about) about.addEventListener('click', onAbout);
  });
}
```

(c) The gate's call site (line 151): `showInterstitial(preview, isNew)` → `showInterstitial(preview, isNew, token)`.

- [ ] **Step 4: Run** — `node_modules/.bin/jest tests/telegramFirstRun.test.js`
Expected: PASS (all pre-existing gate tests unchanged — the parameter is additive).

- [ ] **Step 5: Commit**

```bash
git add index.template.html js/telegramFirstRun.js tests/telegramFirstRun.test.js
git commit -m "feat(telegram): isNew-gated 'What is KnockKnock?' link on the invite interstitial (spec N8)"
```

---

### Task 12: Integration sweep

**Files:** none new — verification only.

- [ ] **Step 1: Full web suite** — `node_modules/.bin/jest`
Expected: PASS, zero failures. Any failure traces to a stale `/?i=` or copy expectation — fix the expectation to the spec'd behavior, never by reverting the feature.

- [ ] **Step 2: Build** — `npm run build`
Expected: completes; then verify the substitution landed and nothing leaked:

```bash
grep -c "__TELEGRAM_APP_LINK__" about.html   # expected: 0
grep -c "invite-landing" about.html          # expected: >= 1
```

(With no `.env.local`, the link substitutes to `''` — CTAs fail closed; that is correct.)

- [ ] **Step 3: Functions suite untouched sanity** — `cd functions && npm test && cd ..`
Expected: PASS (nothing in this plan touches functions; this guards against accidental fallout).

- [ ] **Step 4: Commit any expectation fixes**

```bash
git add -A
git commit -m "test: integration sweep for invite-arrival phase 1"
```

(Skip the commit if the sweep changed nothing.)

- [ ] **Step 5: Hand back to the operator** — phase 1 "done" is the on-device walkthrough (spec §5), not the green suite: iOS Telegram · iOS Safari · Android Telegram · Android Chrome · Android Instagram-class webview · desktop · installed-PWA per platform, plus the UNKNOWNs list (auto-hop interception, `intent://` round-trips, rewrite query preservation, desktop-Telegram `/invite?i=` routing, webview clipboard, iOS door discovery).

---

## Self-Review Notes (already applied)

- Spec coverage: N1→Task 2, N2→Task 5, N3→Task 4, N4→Tasks 7-9, N5→Task 6, N6→Tasks 3+10, N7→Task 1, N8→Task 11. Phase-1 exclusions (tokenless branch, panel removal) are deliberately absent; the panel's `stay=1` skip IS phase 1 and lives in Task 4.
- Type consistency: `decideBootRedirect` returns `{kind, url}|null` everywhere; `extractInviteTokenFromText` lives in `js/inviteText.js` (NOT `js/invites.js`) — Tasks 3 and 10 agree; `initList(myUserId, myCode, { onInviteRedeemed })` matches between Tasks 10(b) and 10 Step 8.
- Known judgment calls an implementer must not "fix": desktop tokenless links stay unrewritten (Task 9 — no webview, no loop); `/about?i=` never passes through (Task 8); code-mode behavior byte-identical including the Enter-to-lookup handler (Task 10).
