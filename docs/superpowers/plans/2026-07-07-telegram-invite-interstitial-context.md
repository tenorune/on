# Contextual Telegram Invite Interstitial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The invite interstitial's accept button reads "Accept & get started" only on a user's first-ever Mini App open; returning unlinked users see "Accept" (spec: `docs/superpowers/specs/2026-07-07-telegram-invite-interstitial-context-design.md`).

**Architecture:** `telegramInviteGate` gains an `isNew` input (the server's `created` flag, already held by the `app.js` call site); `showInterstitial` sets the accept button's `textContent` from it. Linked arrivals keep bypassing the interstitial entirely (silent redeem). No template/server changes.

**Tech Stack:** vanilla ES modules, jest + jsdom (`tests/telegramFirstRun.test.js` harness: mocked `js/telegram.js` / `js/invites.js` / `js/telegramSettings.js`, minimal DOM fixture).

## Global Constraints

- Exact labels: `Accept & get started` (isNew) / `Accept` (returning). Framing text, phrase/dismiss buttons, choice semantics, and the linked silent path are untouched.
- TDD: failing tests first. Test command: `cd /home/user/on && npx jest tests/telegramFirstRun.test.js` (full web suite: `npx jest`).
- Work directly on branch `claude/telegram-app-adaptation-t1r1jp` (operator's instruction — no new branch). Do NOT push.
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01ChMZjWY3kT1EUKs4fpRDhM`

---

### Task 1: Contextual accept label

**Files:**
- Modify: `js/telegramFirstRun.js` (showInterstitial ~:23-46, telegramInviteGate ~:53-64, header comment)
- Modify: `js/app.js:542-545` (gate call site — one added field)
- Modify: `docs/superpowers/specs/2026-07-05-telegram-onboarding-ux-design.md` ("As-built deltas" section — one appended bullet)
- Test: `tests/telegramFirstRun.test.js`

**Interfaces:**
- Consumes: `isNew` at the `app.js` call site — already in scope (`const { identity, isNew } = await ensureIdentity(...)`, app.js:526).
- Produces: `telegramInviteGate({ linked, isNew, dismissSplash })` — `isNew: boolean` (missing/undefined behaves as returning, i.e. label `Accept`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/telegramFirstRun.test.js`:

```js
test('returning unlinked arrival sees "Accept", not "& get started"', async () => {
  mockWa.initDataUnsafe = { start_param: TOKEN };
  resolveInvitePreview.mockResolvedValue({ scope: 'personal', label: 'Ana' });
  const p = telegramInviteGate({ linked: false, isNew: false, dismissSplash: jest.fn() });
  await Promise.resolve(); await Promise.resolve();
  expect(document.getElementById('tg-invite-accept-btn').textContent).toBe('Accept');
  document.getElementById('tg-invite-dismiss-btn').click();
  await p;
});

test('first-ever open keeps "Accept & get started"', async () => {
  mockWa.initDataUnsafe = { start_param: TOKEN };
  resolveInvitePreview.mockResolvedValue({ scope: 'personal', label: 'Ana' });
  const p = telegramInviteGate({ linked: false, isNew: true, dismissSplash: jest.fn() });
  await Promise.resolve(); await Promise.resolve();
  expect(document.getElementById('tg-invite-accept-btn').textContent).toBe('Accept & get started');
  document.getElementById('tg-invite-dismiss-btn').click();
  await p;
});
```

(Existing tests pass `{ linked, dismissSplash }` with no `isNew` — leave them untouched; undefined → returning → `Accept`, and none of them assert the label.)

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `cd /home/user/on && npx jest tests/telegramFirstRun.test.js`
Expected: the two new tests FAIL — the fixture's accept button has empty textContent and the code never sets it (`''` ≠ `'Accept'` / `'Accept & get started'`). All 8 pre-existing tests PASS.

- [ ] **Step 3: Implement**

In `js/telegramFirstRun.js`:

`showInterstitial` — add the label line and the `isNew` param:

```js
function showInterstitial(preview, isNew) {
  const el = document.getElementById('tg-invite-screen');
  if (!el) return Promise.resolve('dismiss');
  document.getElementById('tg-invite-framing').textContent = framingText(preview);
  // "& get started" only on a first-ever open — a returning Mini App user
  // started long ago, so they get a plain "Accept" (spec 2026-07-07).
  document.getElementById('tg-invite-accept-btn').textContent =
    isNew ? 'Accept & get started' : 'Accept';
  el.classList.remove('hidden');
```

(The rest of the function is unchanged.)

`telegramInviteGate` — thread the new input (comment gains one clause):

```js
// Returns { token, preview, silent } to feed pendingInviteToken, or null.
//  - linked account: silent redeem (caller toasts on success) — no interstitial
//  - unlinked: interstitial (accept label contextual on isNew); Accept →
//    redeem; phrase → link flow (its reload re-runs this gate with
//    linked=true → silent redeem into the right account); Not now →
//    proceed unredeemed (the empty state catches them).
export async function telegramInviteGate({ linked, isNew, dismissSplash }) {
  const token = extractStartParamToken();
  if (!token) return null;
  const preview = await resolveInvitePreview(token); // null → invalid/revoked/expired
  if (!preview) return null;
  if (linked) return { token, preview, silent: true };
  dismissSplash();
  const choice = await showInterstitial(preview, isNew);
  if (choice === 'accept') return { token, preview, silent: false };
  if (choice === 'phrase') showLinkScreen(); // reloads on success; cancel falls through
  return null;
}
```

In `js/app.js` (~:542), add the field:

```js
    tgInvite = await telegramInviteGate({
      linked: telegramLinkState()?.linked === true,
      isNew,
      dismissSplash,
    });
```

- [ ] **Step 4: Run the file's tests, then the full web suite**

Run: `cd /home/user/on && npx jest tests/telegramFirstRun.test.js`
Expected: 10/10 PASS.

Run: `cd /home/user/on && npx jest`
Expected: PASS, 1387 tests (1385 + 2).

- [ ] **Step 5: Record the as-built delta**

In `docs/superpowers/specs/2026-07-05-telegram-onboarding-ux-design.md`, find the **"As-built deltas"** section and append one bullet:

```markdown
- **§1 interstitial accept label is contextual (2026-07-07):** "Accept & get
  started" only when the account was bootstrapped this very boot (server
  `created` flag → `isNew`); a returning unlinked arrival sees "Accept".
  Linked arrivals still redeem silently (no interstitial). See
  `2026-07-07-telegram-invite-interstitial-context-design.md`.
```

- [ ] **Step 6: Commit**

```bash
cd /home/user/on && git add js/telegramFirstRun.js js/app.js tests/telegramFirstRun.test.js docs/superpowers/specs/2026-07-05-telegram-onboarding-ux-design.md && git commit -m "feat(telegram): contextual invite-interstitial accept label for returning users

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ChMZjWY3kT1EUKs4fpRDhM"
```
