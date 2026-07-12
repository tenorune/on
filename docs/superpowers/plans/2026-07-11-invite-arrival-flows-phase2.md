# Invite Arrival Flows — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bare (tokenless) arrivals trapped in a *detected* in-app browser redirect to the mint-free `/about` page (Q5=B), and the old dismissible boot panel retires (Q6=A).

**Architecture:** One new branch in the existing pure boot gate (`js/inviteBootGate.js`, created in phase 1) plus deletion of `showInAppBrowserRedirect` and its DOM. No new surfaces — `/about` already carries both doors (the standing Telegram CTA and the per-platform browser break-out with `stay=1`, both shipped in phase 1).

**Tech Stack:** Same as phase 1 (vanilla ES modules, Jest).

**Spec:** `docs/superpowers/specs/2026-07-10-invite-arrival-flows-design.md` §N3 (phase-2 sentence), Q5=B, Q6=A, F8.

**Precondition:** Phase 1 (`2026-07-11-invite-arrival-flows-phase1.md`) is implemented AND has passed the operator's on-device walkthrough. Do not start this plan before that gate — the whole phasing exists so the loop guard (`stay=1`, C2) is device-proven before bare arrivals depend on it.

## Global Constraints

- Run web tests as `node_modules/.bin/jest` from the repo root.
- The redirect target for bare arrivals is plain `/about` (no query) — Q5=B: the standing page already offers both doors; there is no token to carry.
- iOS-undetected bare boots must NOT redirect in this phase — that is phase 3's separately-gated widening (Q8=C).
- Do NOT push, bump versions, or open PRs — the operator drives integration (CLAUDE.md).

---

### Task 1: Tokenless gate branch (spec N3 phase 2, flow F8)

**Files:**
- Modify: `js/inviteBootGate.js` (`decideBootRedirect` — restructure so the fresh-boot guards run before the token check)
- Test: `tests/inviteBootGate.test.js`

**Interfaces:**
- Consumes: the phase-1 gate shape — `decideBootRedirect(ctx)` with ctx fields `{ token, telegramContext, stay, hasIdentity, standalone, telegramAndroid, deepLink, inAppBrowser, ios, sharingEnabled }`; `readBootRedirectContext` already populates every field on tokenless boots (`deepLink` is null).
- Produces: tokenless + fresh + `inAppBrowser` → `{ kind: 'landing', url: '/about' }`. All other tokenless boots → `null`. Token behavior byte-identical to phase 1.

- [ ] **Step 1: Write the failing tests** — in `tests/inviteBootGate.test.js`, replace the phase-1 `rule 0: no token → null` test with a tokenless describe:

```js
describe('tokenless boots (phase 2, Q5=B / F8)', () => {
  test('fresh + detected in-app browser → /about (no query — nothing to carry)', () => {
    expect(decideBootRedirect(fresh({ token: null, deepLink: null, inAppBrowser: true })))
      .toEqual({ kind: 'landing', url: '/about' });
  });
  test('fresh + Telegram-Android → /about too (bare gets the CHOICE, not the Q4 auto-hop)', () => {
    expect(decideBootRedirect(fresh({ token: null, deepLink: null, telegramAndroid: true, inAppBrowser: true })))
      .toEqual({ kind: 'landing', url: '/about' });
  });
  test('fresh + iOS undetected → null (phase 3, not yet)', () => {
    expect(decideBootRedirect(fresh({ token: null, deepLink: null, ios: true }))).toBeNull();
  });
  test('guards still outrank: identity / standalone / stay / Mini App → null even in a webview', () => {
    expect(decideBootRedirect(fresh({ token: null, deepLink: null, inAppBrowser: true, hasIdentity: true }))).toBeNull();
    expect(decideBootRedirect(fresh({ token: null, deepLink: null, inAppBrowser: true, standalone: true }))).toBeNull();
    expect(decideBootRedirect(fresh({ token: null, deepLink: null, inAppBrowser: true, stay: true }))).toBeNull();
    expect(decideBootRedirect(fresh({ token: null, deepLink: null, inAppBrowser: true, telegramContext: true }))).toBeNull();
  });
  test('fresh desktop / real browser bare boot → null', () => {
    expect(decideBootRedirect(fresh({ token: null, deepLink: null }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `node_modules/.bin/jest tests/inviteBootGate.test.js -t "tokenless"`
Expected: FAIL — tokenless currently returns null unconditionally.

- [ ] **Step 3: Implement** — in `decideBootRedirect`, move the token check BELOW the shared guards and give it the phase-2 branch. The full function becomes:

```js
// Ordered; first match wins. Returns { kind: 'hop' | 'landing', url } or null
// (= proceed with today's boot).
export function decideBootRedirect(ctx) {
  if (ctx.telegramContext) return null;               // 1 · Mini App boots itself
  if (ctx.stay) return null;                          // 2 · landing already chose
  if (ctx.hasIdentity || ctx.standalone) return null; // 3 · existing identity wins (C3)
  if (!ctx.token) {
    // Phase 2 (Q5=B / F8): a bare arrival trapped in a DETECTED webview gets the
    // standing /about page — both doors, no token to carry, no auto-hop (bare
    // Telegram-Android gets the choice; Q4=A was answered for invites).
    // iOS-undetected bare boots don't redirect until phase 3 (Q8=C).
    return ctx.inAppBrowser ? { kind: 'landing', url: '/about' } : null;
  }
  if (ctx.telegramAndroid && ctx.deepLink) {
    return { kind: 'hop', url: ctx.deepLink };        // 4 · Q4=A zero-tap rescue
  }
  if (ctx.inAppBrowser) {
    return { kind: 'landing', url: '/invite?i=' + ctx.token }; // 5 · any webview (holistic)
  }
  if (ctx.ios && ctx.sharingEnabled) {
    return { kind: 'landing', url: '/invite?i=' + ctx.token }; // 6 · undetectable-iOS net
  }
  return null;                                        // 7 · today's flow
}
```

(Ordering note: moving guards 1–3 above the token check does not change any phase-1 token outcome — every token rule already sat below them.)

- [ ] **Step 4: Run the full gate suite** — `node_modules/.bin/jest tests/inviteBootGate.test.js`
Expected: PASS — all phase-1 token tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add js/inviteBootGate.js tests/inviteBootGate.test.js
git commit -m "feat(boot): bare in-app-browser arrivals redirect to /about (spec N3 phase 2, Q5=B)"
```

---

### Task 2: Retire the boot panel (Q6=A)

**Files:**
- Modify: `js/app.js` (delete the call-site block — the `onboardingLane(...) === 'in-app-browser'` check with the `!hasStayParam()` guard, added around line 214 in phase 1 — and the whole `showInAppBrowserRedirect` function at ~468-479)
- Modify: `index.template.html:249-255` (delete the `#browser-redirect` block)
- Test: none reference the panel (verified: only `js/app.js` does) — existing suites guard the removal.

**Interfaces:**
- Consumes: nothing. Produces: nothing — pure deletion. The `onboardingLane` `'in-app-browser'` lane itself STAYS (`detectNotifyCapability` and the lane selector still classify webviews; only the boot interstitial dies). `hasStayParam` also stays — the gate's ctx reader uses it.

- [ ] **Step 1: Delete the call site** — in `js/app.js`, remove the whole block (phase-1 shape shown; delete all of it):

```js
  // stay=1 = the user just chose "Continue in browser" on the landing, which
  // already said everything this panel says (Q6=A) — don't nag twice.
  if (onboardingLane({ installPromptAvailable: false }) === 'in-app-browser' && !hasStayParam()) {
    await showInAppBrowserRedirect(); // informational; user may continue here anyway
  }
```

Rationale to leave in its place (one line, so the next reader knows this is deliberate):

```js
  // The old in-app-browser interstitial is gone (spec Q6=A): fresh webview
  // arrivals are redirected by inviteBootGate before reaching this point.
```

- [ ] **Step 2: Delete the function** — remove `showInAppBrowserRedirect` (`js/app.js` ~468-479, the whole function incl. its comment block). If `hasStayParam` was imported solely for the deleted call site, keep the import only if it is still used elsewhere in the file; otherwise drop it from the import list (the gate module itself still exports and uses it).

- [ ] **Step 3: Delete the DOM** — remove from `index.template.html` (lines 249-255):

```html
  <div id="browser-redirect" class="welcome-screen hidden">
    <div class="modal-card">
      <h3 id="browser-redirect-title">Open in your browser</h3>
      <p id="browser-redirect-body"></p>
      <button id="browser-redirect-continue-btn" class="ghost-btn" type="button">Continue here anyway</button>
    </div>
  </div>
```

- [ ] **Step 4: Sweep for stragglers**

Run: `grep -rn "browser-redirect\|showInAppBrowserRedirect" js/ tests/ css/ index.template.html`
Expected: zero hits. If `css/app.css` styles `#browser-redirect` specifically, delete that rule too (generic `.welcome-screen`/`.modal-card` rules stay — other screens share them).

- [ ] **Step 5: Run the app suites** — `node_modules/.bin/jest tests/app-boot-cacheOwner.test.js tests/app-first-follow.test.js tests/app-call-recovery.test.js tests/installGuidance.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add js/app.js index.template.html css/app.css
git commit -m "feat(boot): retire the in-app-browser interstitial — the gate redirect replaces it (Q6=A)"
```

(Omit `css/app.css` from the add if Step 4 found nothing there.)

---

### Task 3: Integration sweep + walkthrough handoff

- [ ] **Step 1: Full web suite** — `node_modules/.bin/jest`
Expected: PASS.

- [ ] **Step 2: Build sanity** — `npm run build`, then `grep -c "browser-redirect" index.html` → expected `0`.

- [ ] **Step 3: Commit any expectation fixes** (skip if clean):

```bash
git add -A && git commit -m "test: integration sweep for invite-arrival phase 2"
```

- [ ] **Step 4: Hand back to the operator** — phase-2 walkthrough items (spec §5): bare link in Android Telegram / Instagram-class webview → lands on `/about`, both doors work, `intent://` fallback with `stay=1` does NOT loop (the C2 guard, now load-bearing); bare link with an existing webview identity passes straight into the app; iOS bare unchanged (still the accepted interim limit). Phase 3 has its own gate after this walkthrough.

---

## Self-Review Notes (already applied)

- Spec coverage: N3 phase-2 sentence → Task 1; Q6=A panel retirement → Task 2; F8 (bare Telegram-Android gets the choice, not the hop) → Task 1 test 2.
- The guard reorder in Task 1 Step 3 is outcome-preserving for tokens — stated and covered by the untouched phase-1 tests.
- Deliberately absent: any iOS tokenless behavior (phase 3), any `/about` page change (phase 1 shipped both doors).
