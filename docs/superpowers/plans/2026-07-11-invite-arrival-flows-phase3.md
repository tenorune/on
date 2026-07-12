# Invite Arrival Flows — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the iOS bare-link blind spot (Q8=C): **every** fresh tokenless boot of `/` redirects to `/about`; signed-in users pass straight through. Root becomes the conventional signed-out-landing / signed-in-app split.

**Architecture:** Drop one condition in the boot gate's tokenless branch and add one gate-wide exemption (`setup=install`). Plus one loop-closure in `about-cta.js` that only becomes necessary now: a fresh **desktop** visitor bounced to `/about` must not bounce back from the page's own "Open" links.

**Tech Stack:** Same as phases 1–2.

**Spec:** `docs/superpowers/specs/2026-07-10-invite-arrival-flows-design.md` — Q8=C row, N3 phase-3 paragraph, §4 phase 3, §5 phase-3 walkthrough items.

**Precondition:** Phase 2 implemented AND walked through on device. This phase has its **own evaluation gate** (Q8=C): it lengthens the primary new-user funnel (one hop everywhere + the "Open in Safari?" prompt on iOS), so the operator evaluates it on device before it is kept. The revert path is deliberately one condition wide (Task 1's tokenless branch) — keep it that way.

## Global Constraints

- Run web tests as `node_modules/.bin/jest` from the repo root.
- Exemption params, exact: `stay=1` (existing) and `setup=install` (`js/app.js`'s Safari install-hop marker, `isSetupInstall`, app.js:118 — a deliberately fresh, identity-less boot that must keep showing install guidance).
- SW cold-start intents (`?inbox=1`, `?direct=1`, `?group=…`) need NO exemption: identity always exists on those boots, so guard 3 passes them through. Do not add special cases for them.
- Do NOT push, bump versions, or open PRs — the operator drives integration (CLAUDE.md).

---

### Task 1: Widen the tokenless branch + gate-wide `setup=install` exemption (Q8=C)

**Files:**
- Modify: `js/inviteBootGate.js` (`hasSetupInstallParam` helper; ctx field; rule 2b; tokenless branch)
- Test: `tests/inviteBootGate.test.js`

**Interfaces:**
- Consumes: the phase-2 gate shape.
- Produces: ctx gains `setupInstall: boolean`; `decideBootRedirect` — new gate-wide rule after `stay`; tokenless branch returns `{ kind: 'landing', url: '/about' }` for EVERY fresh boot (no detection condition). New export `hasSetupInstallParam(): boolean`.

- [ ] **Step 1: Write the failing tests** — in `tests/inviteBootGate.test.js`:

(a) Add `setupInstall: false` to the `fresh()` baseline object.

(b) Replace the phase-2 tokenless describe's detection-dependent expectations and add the exemption tests:

```js
describe('tokenless boots (phase 3, Q8=C: root = signed-out landing)', () => {
  test('EVERY fresh tokenless boot redirects to /about — no detection condition', () => {
    expect(decideBootRedirect(fresh({ token: null, deepLink: null })))
      .toEqual({ kind: 'landing', url: '/about' });                    // desktop / real browser
    expect(decideBootRedirect(fresh({ token: null, deepLink: null, ios: true })))
      .toEqual({ kind: 'landing', url: '/about' });                    // iOS — the blind spot, closed
    expect(decideBootRedirect(fresh({ token: null, deepLink: null, inAppBrowser: true })))
      .toEqual({ kind: 'landing', url: '/about' });                    // webviews as in phase 2
  });
  test('signed-in / standalone / stay / Mini App pass through unchanged', () => {
    expect(decideBootRedirect(fresh({ token: null, deepLink: null, hasIdentity: true }))).toBeNull();
    expect(decideBootRedirect(fresh({ token: null, deepLink: null, standalone: true }))).toBeNull();
    expect(decideBootRedirect(fresh({ token: null, deepLink: null, stay: true }))).toBeNull();
    expect(decideBootRedirect(fresh({ token: null, deepLink: null, telegramContext: true }))).toBeNull();
  });
});

describe('setup=install exemption (Q8=C: the Safari install-hop is deliberately fresh)', () => {
  test('gate-wide: exempts tokenless AND token boots', () => {
    expect(decideBootRedirect(fresh({ token: null, deepLink: null, setupInstall: true }))).toBeNull();
    expect(decideBootRedirect(fresh({ setupInstall: true, ios: true }))).toBeNull();
    expect(decideBootRedirect(fresh({ setupInstall: true, telegramAndroid: true, inAppBrowser: true }))).toBeNull();
  });
  test('readBootRedirectContext reads it from the URL', () => {
    window.history.replaceState(null, '', '/?setup=install');
    expect(readBootRedirectContext(null).setupInstall).toBe(true);
    window.history.replaceState(null, '', '/');
    expect(readBootRedirectContext(null).setupInstall).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `node_modules/.bin/jest tests/inviteBootGate.test.js -t "phase 3"`
Expected: FAIL — desktop/iOS tokenless currently return null; `setupInstall` unknown.

- [ ] **Step 3: Implement** — in `js/inviteBootGate.js`:

(a) Helper next to `hasStayParam`:

```js
// setup=install marks the Safari install-hop (app.js isSetupInstall): a
// DELIBERATELY fresh, identity-less boot mid-install-ceremony. Gate-wide
// exemption (Q8=C) — bouncing it to marketing would strand the install step.
export function hasSetupInstallParam() {
  try { return new URLSearchParams(window.location.search).get('setup') === 'install'; }
  catch { return false; }
}
```

(b) Add to `readBootRedirectContext`'s returned object:

```js
    setupInstall: hasSetupInstallParam(),
```

(c) In `decideBootRedirect`, insert after the `stay` rule and rewrite the tokenless branch:

```js
  if (ctx.stay) return null;                          // 2 · landing already chose
  if (ctx.setupInstall) return null;                  // 2b · Safari install-hop (Q8=C)
  if (ctx.hasIdentity || ctx.standalone) return null; // 3 · existing identity wins (C3)
  if (!ctx.token) {
    // Phase 3 (Q8=C): root is signed-out-landing / signed-in-app. EVERY fresh
    // tokenless boot goes to /about — detection no longer matters, which is
    // exactly what closes the undetectable-iOS bare blind spot. Funnel cost
    // (one hop + the iOS prompt) is under an explicit on-device evaluation
    // gate; revert = restore the `ctx.inAppBrowser ?` condition on this line.
    return { kind: 'landing', url: '/about' };
  }
```

- [ ] **Step 4: Run the full gate suite** — `node_modules/.bin/jest tests/inviteBootGate.test.js`
Expected: PASS — all phase-1/2 token tests unchanged (the new rule 2b only fires on `setupInstall`, which every other test leaves false).

- [ ] **Step 5: Commit**

```bash
git add js/inviteBootGate.js tests/inviteBootGate.test.js
git commit -m "feat(boot): all fresh tokenless boots land on /about; setup=install exempt (Q8=C phase 3)"
```

---

### Task 2: Close the desktop return-loop in `about-cta.js`

**Files:**
- Modify: `js/about-cta.js` (drop the desktop-tokenless early return)
- Test: `tests/about-page.test.js` ("about-cta link rewriting" describe)

**Interfaces:**
- Consumes: the phase-1 shape (`query` always contains `stay=1`).
- Produces: EVERY `data-open-app` link is rewritten on every platform — desktop tokenless becomes `/?stay=1`.

**Why now:** through phase 2 a fresh desktop visitor never landed on `/about` by redirect, so its unrewritten `href="/"` links were harmless. Phase 3 sends fresh desktop visitors there; an unrewritten link would boot fresh → redirect → `/about` again (a soft loop in new tabs). C2's "stay rides every rewritten link" now requires desktop to *be* rewritten.

- [ ] **Step 1: Update the tests** — in the `about-cta link rewriting` describe, replace the two desktop-tokenless expectations:

```js
  test('desktop with no token: rewritten to /?stay=1 (phase 3 — the landing must not bounce back)', () => {
    const link = runCta({ ua: DESKTOP, search: '' });
    expect(link.attrs.href).toBe('/?stay=1');
  });
  test('malformed token on desktop: treated as none → /?stay=1', () => {
    const link = runCta({ ua: DESKTOP, search: '?i=' + encodeURIComponent('bad token!') });
    expect(link.attrs.href).toBe('/?stay=1');
  });
```

- [ ] **Step 2: Run to verify failure** — `node_modules/.bin/jest tests/about-page.test.js -t "about-cta"`
Expected: FAIL — desktop tokenless href undefined.

- [ ] **Step 3: Implement** — in `js/about-cta.js`, delete the early return:

```js
  // Desktop only rewrites when a token needs carrying; a desktop tab is never
  // a webview, so an as-authored link has no loop risk.
  if (!isAndroid && !isIOS && !valid) return;
```

and replace it with:

```js
  // Every platform rewrites (phase 3): fresh tokenless boots of / redirect to
  // this page, so even a desktop link must carry stay=1 or it bounces back.
```

(The loop below already writes `'/' + query` for desktop; `query` is `'?stay=1'` when tokenless.)

- [ ] **Step 4: Run** — `node_modules/.bin/jest tests/about-page.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/about-cta.js tests/about-page.test.js
git commit -m "feat(about): desktop open-app links carry stay=1 — no bounce-back from the root landing (phase 3)"
```

---

### Task 3: Integration sweep + funnel-evaluation handoff

- [ ] **Step 1: Full web suite** — `node_modules/.bin/jest`
Expected: PASS.

- [ ] **Step 2: Build sanity** — `npm run build` completes.

- [ ] **Step 3: Commit any expectation fixes** (skip if clean):

```bash
git add -A && git commit -m "test: integration sweep for invite-arrival phase 3"
```

- [ ] **Step 4: Hand back to the operator — this phase's own evaluation gate (Q8=C).** Walk, per spec §5: new-user first touch on EVERY platform (the extra hop; the iOS "Open in Safari?" prompt); `setup=install` regression (create an account in a webview, hop to Safari, install guidance must still show); fresh-device restore reachability (bookmark `/` on a clean browser → `/about` → open app → welcome → Restore); iOS-Telegram bare link now lands on `/about` (the blind spot, closed); no `/about` bounce-loops on any platform (desktop included — Task 2). **Keep or revert is the operator's call**; revert = restore the one `ctx.inAppBrowser ?` condition (Task 1 Step 3 comment marks the line).

---

## Self-Review Notes (already applied)

- Spec coverage: Q8=C row + N3 phase-3 paragraph → Task 1 (widening, both exemptions, gate-wide `setup=install`); §5 phase-3 walkthrough items → Task 3 Step 4. Task 2 is a consequence the spec's C2 rationale implies but phase 1 deliberately deferred ("a desktop tab is never a webview") — the phase-1 plan's judgment-call note anticipated this flip.
- The `setup=install` exemption is gate-wide (rule 2b), not tokenless-only: the spec's exemption-set sentence reads gate-wide, and a token+`setup=install` boot mid-install-ceremony must not be yanked to the landing either.
- SW cold-start intents intentionally untouched (identity → guard 3), stated in Global Constraints so no one "helpfully" adds exemptions.
