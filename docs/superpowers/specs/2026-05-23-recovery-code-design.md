# Recovery Code Identity — Design

*Date: 2026-05-23*

## Goal

Make a user's identity (and therefore social graph) **survive losing browser storage**. Today, clearing cache or switching browsers means losing the userId — and with it, the user's followers, followees, and accumulated state. Every friend has to re-share their code.

In v2, the user is shown a 4-word recovery code at first launch and can use it to restore the same identity on any browser at any time.

This is Approach A from the design discussion (`brainstorming` thread, 2026-05-23). Approaches B (server-side auth) and C (QR pairing) are documented as future phases at the end of this spec, with the formula choices in A explicitly preserved to make them additive rather than disruptive.

## Out of scope

- **Server-side identity verification** — see "Future phases" below (Phase B).
- **QR pairing for multi-device** — see "Future phases" below (Phase C).
- **Account deletion or merging.**
- **Changing the recovery code** — by construction, the code IS the identity. A user who wants a new identity starts fresh.
- **Cleanup of orphaned v1 records** in Firebase — left in place; cheap and harmless.
- **Multi-user-per-browser** — one identity per browser, same as today.

## Architecture

### Recovery code

- **Format:** 4 random words, lowercase, separated by `-`. Example: `swift-river-amber-dust`.
- **Wordlist:** a curated English wordlist of short (4–7 char) common words, no profanity, no homophones with other words in the list, no proper nouns. Wordlist size and entropy options considered:
  - EFF short wordlist (1296 words, public domain). 4 picks ≈ 41 bits entropy.
  - EFF long wordlist (7776 words, public domain). 4 picks ≈ 52 bits entropy.
  - Either was sufficient for the threat model. **Implementer picked the EFF long wordlist**, filtered to remove the four entries containing hyphens (`drop-down`, `felt-tip`, `t-shirt`, `yo-yo`) so dash-separated normalization is unambiguous. Final list: **7772 words**, ≈51.95 bits entropy on 4 picks. Source: `https://www.eff.org/dice` (`eff_large_wordlist.txt`). The chosen wordlist is the canonical wordlist forever — changing it later means existing recovery codes might no longer parse.
- **Wordlist storage:** bundled into the JS bundle as `js/wordlist.js` (~40 KB).
- **Display form:** lowercase, dash-separated. Used verbatim for storage and clipboard.
- **Input acceptance:** case-insensitive; tokens may be separated by dashes, spaces, or commas. Normalization: lowercase + collapse separators to `-` + trim.
- **Validation:** parse → exactly 4 tokens → each token in wordlist. If any check fails, treat input as invalid (no userId derivation, no Firebase read).

### userId derivation

```js
userId = sha256(normalizedRecoveryCode).slice(0, 32)
```

- 32 hex chars = 128 bits. Compatible shape with the v1 UUID format (after stripping dashes), so `users/{userId}/...` Firebase paths are unaffected.
- Pure client-side derivation. No server involvement, no network call.
- Deterministic: identical normalized code always yields identical userId.
- **Pre-design hook for Phase B:** This formula is *preserved* when Phase B ships. The Phase B Cloud Function will mint Firebase custom tokens with `auth.uid === sha256(recoveryCode)`, so all existing `users/{userId}/...` data continues to validate against the future auth-based rules without any data migration.

### Why we can't distinguish "new user" from "cleared cache"

Both look identical: empty localStorage. The app has no signal to tell them apart. So we don't try — we always show a welcome screen on empty localStorage and let the user declare which case they're in. This is the only behavior difference from v1, where empty localStorage silently created a new account.

## Data model

### localStorage

v1 schema:
```json
{ "userId": "<uuid>", "code": "<6-char share>" }
```

v2 schema (under the same key `statusapp_identity`):
```json
{ "userId": "<32-hex>", "code": "<6-char share>", "recoveryCode": "swift-river-amber-dust" }
```

Presence of `recoveryCode` is the v1-vs-v2 discriminator at migration time.

### Firebase Realtime Database

No schema changes. Existing `users/{userId}/...` paths work as-is. The new userId is the same shape as a v1 UUID (32 hex chars, optionally with dashes removed).

### Security rules

No changes in this spec. The existing `database.rules.json` (wide-open per namespace) remains. Phase B revisits.

## User flows

### Flow 1 — Empty localStorage (new user OR cleared cache)

Show the **welcome screen**: two buttons, no other UI.

```
[  I'm new  ]    [  I have a recovery code  ]
```

- **Tap "I'm new"**
  1. Generate a 4-word recovery code (purely client-side; no derivation or Firebase write yet).
  2. Show the **recovery-code-display modal** with the generated code.
  3. While the modal is open, the user may:
     - Tap **Copy** to copy the displayed code to the clipboard.
     - Tap the **rotate icon (↻)** to discard the current code and generate a fresh one. The modal updates in place. No undo; the previous code is not retained. No limit on regeneration count.
     - Tap **I've saved it** to commit.
  4. On commit:
     - Derive userId via SHA-256 from the displayed code.
     - Generate a 6-char share code; transactionally claim `codeIndex/{shareCode}` (same as today's `initUser`, looping on collision).
     - Write the initial user record to `users/{userId}`.
     - Save `{ userId, code, recoveryCode }` to localStorage.
     - Dismiss the modal.
  5. Proceed to main UI.

- **Tap "I have a recovery code"** → show **restore input screen** (third subsection).

### Flow 2 — Returning user (localStorage intact, valid)

Unchanged from today. Load identity, call `userExists(userId)`, proceed to main UI. No welcome screen.

### Flow 3 — Stale identity (localStorage exists, Firebase record missing)

The existing `#stale-screen` already handles this case with a single "Continue" button that creates a new account. In v2 the screen grows a second button:

```
[  Continue with new account  ]    [  I have a recovery code  ]
```

- "Continue with new account" → clear localStorage and **jump directly to the recovery-code-display modal** (skipping the welcome screen). The user already declared "new account" intent by tapping this button; routing them through the welcome screen to declare it again would force a redundant second tap on "I'm new." The recovery-code-display modal is the actual meaningful step on the "I'm new" path, so we land there directly.
- "I have a recovery code" → restore input screen.

### Flow 4 — v1 → v2 migration (clean break)

On any v2 launch, before doing anything else:

```js
const stored = JSON.parse(localStorage.getItem('statusapp_identity') || 'null');
if (stored && !stored.recoveryCode) {
  // v1 shape — wipe and fall through to welcome screen
  localStorage.removeItem('statusapp_identity');
}
```

Result: every v1 user lands on the welcome screen at first v2 launch. They tap "I'm new", get a fresh recovery code, and re-share their share code with friends. Their v1 Firebase records become orphans (acceptable, free tier easily absorbs).

## UI surfaces

### Welcome screen (new)

Full-screen, replaces the normal app shell until the user makes a choice. Layout:

- **Heading:** the same struck-through glyph string used in `#splash` today (`k&#x0338;n&#x0336;o&#x0338;c&#x0335;k&#x0335; &#x0336;k&#x0338;n&#x0337;o&#x0335;c&#x0338;k&#x0335;`), rendered with the same typographic styling. Treat the splash styling as a reusable visual: extract the relevant CSS rules from `#splash` into a shared class (e.g., `.brand-mark`) that both the splash and this welcome heading reference. No tagline below.
- Two large buttons stacked vertically on narrow screens, side-by-side on wider screens: `[ I'm new ]` and `[ I have a recovery code ]`.
- No other content.

### Recovery-code-display modal (new)

Triggered at the start of the "I'm new" flow, *before* any userId derivation or Firebase write. Hard-gated: only the explicit confirm button **I've saved it** dismisses it. Tap-outside and Escape do nothing.

Content (top to bottom):
- Title: **"This is your recovery code"**
- The code, displayed in large monospace, e.g., `swift-river-amber-dust`
- **[ Copy ]** button (uses same copy-to-clipboard pattern as the share-code drawer)
- Body text: *"Save this somewhere safe. It's the only way to restore your account if you lose this browser. We can't recover it for you."*
- **Rotate icon button** for regenerating the code. Reuses the existing `.rotate-btn` class and `↻` glyph from the share-code drawer (`#rotate-code-btn`). Placed adjacent to or just below the displayed code. `title` / `aria-label`: `"Generate new recovery code"`.
- **[ I've saved it ]** button (primary-btn, the only dismissal)

**Button behavior:**
- **Copy**: writes the currently-displayed code to the clipboard, brief "Copied!" confirm on the button (matching the drawer pill pattern). Modal stays open.
- **Rotate (↻)**: generates a fresh 4-word code → updates the displayed code in place → resets the Copy button label if it was in the "Copied!" state. Modal stays open. No upper limit on regeneration count. No undo (previous codes are not retained).
- **I've saved it**: triggers the commit sequence in Flow 1 above (derive userId, claim share code, Firebase write, localStorage save), then dismisses the modal.

The regenerate affordance is only available **here**, during initial account creation. Once committed, the recovery code is permanent. The drawer pill displays the committed code with Copy only — no regeneration option.

### Restore input screen (new)

Reached from either welcome screen or stale-identity screen. Layout:
- Heading: **"Enter your recovery code"**
- A single text input. Accepts paste. Auto-lowercase as user types. Forgiving about separators (see Validation in Architecture).
- **[ Restore ]** button (primary).
- **[ Cancel ]** button (ghost) — returns to the screen the user came from.
- Inline error area, hidden by default. Used for:
  - "That doesn't look like a recovery code — check that you entered 4 words from the list."
  - "No account found with that code. Check spelling, or tap Cancel to start over."
  - "Couldn't reach the server — check your connection and try again."

On Restore:
1. Validate input (parse + wordlist check). On invalid → show first error; stop.
2. Derive userId.
3. Read `users/{userId}` from Firebase. Three outcomes:
   - **Read succeeds, record exists** → write `{ userId, code: <fetched share code>, recoveryCode: <normalized input> }` to localStorage → proceed to main UI.
   - **Read succeeds, record absent** → show "No account found" error; no localStorage write.
   - **Read fails (network error, timeout, RTDB unreachable)** → show "Couldn't reach the server" error; no localStorage write. The user remains on the restore screen with their input intact so they can retry without re-typing.

**Connectivity requirement:** restore requires a live connection to RTDB. The "no account found" and "couldn't reach the server" cases must be distinguished to avoid telling a disconnected user their account doesn't exist — which would push them toward starting over and losing their identity for real. The Firebase SDK's `get()` rejects on network failure, which is the signal to surface the connectivity error rather than the not-found error.

### Stale-identity screen (modified)

Existing `#stale-screen` with the new second button as described in Flow 3. Styling matches existing screen.

### Code drawer recovery pill (new)

Inside the existing `#code-drawer`, below the existing share-code section, add a single row.

**Three states:**

| State | What's shown | Transition |
|---|---|---|
| **Idle** | Single pill: `[ Show recovery code ]` | Tap pill → enter Revealed |
| **Revealed** | `swift-river-amber-dust  [ Copy ]` (inline, same row) | Tap Copy → enter Copied. 15s idle → return to Idle. |
| **Copied** | `swift-river-amber-dust  [ Copied! ]` (button text change only) | 1.5s elapsed → return to Idle |

Behavior details:
- Entering Revealed starts a 15s idle timer. Tapping the code-text portion of the row (anything except Copy) resets the timer. Tapping Copy transitions to Copied (see below); the 15s timer is cancelled at that moment.
- Tapping Copy: writes recovery code to clipboard, swaps the button text from `Copy` to `Copied!`, cancels the 15s timer, starts a 1.5s timer. When the 1.5s timer fires, the entire row reverts to Idle.
- If the user closes the drawer while in Revealed or Copied state: any active timer continues running. When the timer fires, the row returns to Idle whether the drawer is open or closed. Reopening the drawer shows whatever state the row is currently in (in practice this is almost always Idle by then).
- Drawer styling: the row uses the existing `.chip` pill class for Idle. Revealed and Copied use the same monospace typography as the share-code row above it. Color and weight match.

## UI surface inventory

| Surface | Status |
|---|---|
| Welcome screen | new |
| Recovery-code-display modal | new |
| Restore input screen | new |
| Code drawer recovery-code pill | new |
| Stale-identity screen | modified (adds second button) |
| Main UI (`#app-header`, `#main-list`, etc.) | unchanged |
| `index.template.html`, build pipeline | unchanged |

All visual elements reuse existing tokens (`primary-btn`, `ghost-btn`, `.chip`, drawer typography, modal overlay pattern). No new design tokens, no new colors, no new spacing constants.

## Module changes

| File | Change |
|---|---|
| `js/identity.js` | Add `generateRecoveryCode()`, `parseRecoveryCode(input)`, `deriveUserIdFromRecoveryCode(code)`. Existing `generateUserId()` is removed (no longer used). Save/load helpers grow to handle the new `recoveryCode` field. |
| `js/wordlist.js` | **New.** Exports the 7772-word EFF-long-filtered wordlist as a frozen array. Generated by `scripts/gen-wordlist.js` (one-shot, idempotent). |
| `js/app.js` | `ensureIdentity()` rewritten: detect v1 schema → wipe; detect empty localStorage → show welcome screen and await user choice; detect stale localStorage → show stale-screen with restore option. New helpers `showWelcomeScreen()`, `showRecoveryCodeModal()`, `showRestoreScreen()`. The stale-screen's "Continue with new account" path clears localStorage and calls `showRecoveryCodeModal()` directly, bypassing `showWelcomeScreen()`. |
| `js/mycode.js` | Add recovery-code pill row to the drawer init logic; manage its three-state machine. |
| `index.template.html` | Add markup for welcome screen, recovery-code modal, restore screen. Modify stale screen. |
| `css/app.css` | Styles for welcome/restore screens, recovery modal, pill row state transitions (mostly opacity / text swaps; no new keyframes likely needed). Extract the existing `#splash` typographic styling into a reusable class (e.g., `.brand-mark`) so both the splash and the welcome heading share it. |

Test files updated correspondingly.

## Testing

### Unit tests (likely a new `tests/recovery.test.js`)

- `generateRecoveryCode()`:
  - Returns string matching `^[a-z]+(?:-[a-z]+){3}$`.
  - Each of the 4 tokens is in the bundled wordlist.
  - Statistical sanity: across 1000 calls, no obvious bias to a single word.
- `parseRecoveryCode(input)`:
  - Accepts `"a-b-c-d"`, `"a b c d"`, `"A B C D"`, `"a, b, c, d"`, mixed.
  - Rejects empty, 3 tokens, 5 tokens, tokens not in wordlist.
  - Returns normalized form on success.
- `deriveUserIdFromRecoveryCode(code)`:
  - Same code yields same userId every time.
  - Case and separator variants of the same logical code yield the same userId (because they normalize identically).
  - Different codes yield different userIds (smoke test on a few).
- Combined `parse → derive` matches direct `derive` on a known normalized code.

### Integration tests (jsdom, in `tests/app.test.js` and/or `tests/identity.test.js`)

- **New-user flow:** localStorage empty → welcome screen rendered → tap "I'm new" → recovery-code modal rendered with valid-format code → tap "I've saved it" → main UI rendered → localStorage contains v2-shape identity whose `recoveryCode` matches the displayed code.
- **Regenerate-during-creation flow:** tap "I'm new" → modal shows code A → tap rotate (↻) → modal shows code B ≠ code A → tap rotate again → modal shows code C, distinct from A and B → tap "I've saved it" → committed identity's `recoveryCode` is C; no Firebase writes occurred for codes A or B (assert via mock-call count).
- **Restore flow (success):** welcome screen → tap "I have a recovery code" → restore screen rendered → enter a valid recovery code whose derived userId has a corresponding Firebase record (mocked) → main UI rendered → localStorage contains v2-shape identity for that userId.
- **Restore flow (not found):** as above but Firebase record absent → inline error shown → localStorage unchanged → still on restore screen.
- **Restore flow (bad input):** enter 3-word phrase, or word not in list → inline error shown → no Firebase read attempted.
- **Stale identity → restore:** localStorage has v2 identity but Firebase says no → stale-screen rendered with both buttons → tap "I have a recovery code" → restore screen rendered.
- **Stale identity → new account (direct to modal):** stale-screen rendered → tap "Continue with new account" → recovery-code-display modal rendered directly (welcome screen is not shown in between) → localStorage was cleared as part of the transition.
- **v1 migration:** localStorage has `{userId, code}` only (no `recoveryCode`) → on app boot, localStorage is cleared → welcome screen rendered.
- **Drawer pill state machine:**
  - Idle → tap → Revealed
  - Revealed → wait 15s with no interaction → Idle
  - Revealed → tap Copy → button reads "Copied!" → wait 1.5s → row is back to Idle
  - Revealed → tap row (not Copy) → 15s timer resets
- **Confirm modal hard gate:**
  - Programmatic Escape key does not close the recovery-code modal.
  - Outside-tap (click on the modal overlay backdrop) does not close it.
  - Programmatic `history.back()` / browser back-button / PWA back-gesture does not close it. The modal installs a `popstate` listener that re-pushes the history entry it owns, so navigating back is a visual no-op while the modal is open. The listener is removed only when the user taps "I've saved it" (the legitimate dismissal).
  - Only the explicit confirm button dismisses the modal.
- **Restore connectivity outcomes (per §Restore input screen):**
  - Read succeeds with record → main UI rendered; localStorage written.
  - Read succeeds with no record → "No account found" error; localStorage unchanged.
  - Read rejects (simulate network failure via mocked `get()` rejection) → "Couldn't reach the server" error; localStorage unchanged; input value preserved in the field for retry.

### Out of test scope

- Cryptographic strength of SHA-256 (Node provides this).
- Browser clipboard API (mocked via existing patterns).

## Edge cases worth calling out

- **User enters their own currently-active recovery code:** the derived userId equals the localStorage userId. Restore is idempotent — we just rewrite localStorage with the same values. No special-case needed.
- **User generates a new account, then realizes they have an old code:** they have to clear localStorage manually (or via the stale-screen if they catch it before identity creation). Out of scope for this spec.
- **User loses their recovery code with no backup:** their identity is gone. The recovery-code-display modal's hard gate is the only mitigation. By design we cannot help them further.
- **Two browsers, same recovery code, simultaneous writes:** RTDB last-write-wins. Same as v1's behavior with shared userIds. Acceptable.
- **User's clipboard fails (older browser, permission denied):** Copy button silently no-ops; user can still long-press-select the code visually. Existing share-code Copy handling does the same.

## Future phases (documented; not implemented in this spec)

### Phase B — Server-side identity verification

**Purpose:** replace the honor-system trust model with cryptographically enforced identity. After Phase B, knowing someone's userId is not enough to impersonate them; you must also possess the recovery code, and brute-forcing it goes through a server function that can rate-limit.

**Mechanism:**

1. Deploy a Firebase Cloud Function `validateRecovery(code)`:
   - Normalize and validate the code.
   - Compute `uid = sha256(normalizedCode).slice(0, 32)`.
   - Verify a record exists at `users/{uid}/`.
   - Mint a Firebase custom auth token with `auth.uid === uid`.
   - Rate-limit by IP / by invocation count (e.g., 10/min).
   - Return the custom token.
2. Client signs in via Firebase Auth using the custom token from the function, instead of trusting localStorage.
3. Tighten `database.rules.json`:
   ```json
   "users": { "$userId": {
     ".read": "auth.uid === $userId",
     ".write": "auth.uid === $userId"
   } }
   ```
   And similar for other namespaces as appropriate.

**Migration from Phase A to Phase B:** zero data migration. The `userId = sha256(recoveryCode)` formula in this spec is *deliberately preserved* so existing records remain valid under the new auth-based rules. Client-side: on first launch after Phase B ships, the app reads the existing recoveryCode from localStorage, hits the Cloud Function, signs in, and proceeds. Indistinguishable to the user.

**Cost:** ~$0/month at 50–100 users. All operations sit well within Firebase free tier (Anonymous Auth is free; Cloud Functions free tier is 2M invocations/month, the expected workload is <1000/month). The hard prerequisite is enabling Firebase **Blaze plan** (pay-as-you-go, no monthly minimum), which requires a credit card on the project. Set a $5 billing alert as a safety net.

### Phase C — QR pairing for multi-device

**Purpose:** make adding a second device fast (scan instead of type) without removing the recovery-code fallback.

**Mechanism:**

- The signed-in device generates a QR code on demand ("Pair another device" entry in the drawer).
- The new device scans, decodes, and uses the contents to claim the same identity.

**Two implementation tiers** depending on whether Phase B is in place:

- **Phase C-only (before B ships):** QR contains the recovery code itself. Pros: implementation is trivial — scan, populate the restore screen's input, submit. Cons: anyone briefly seeing the QR captures the long-lived secret. Acceptable for trusted-environment pairings but should be flagged in the UI with explicit confirmation before display ("Show QR only when no one else is looking").
- **Phase C after B ships:** QR contains a short-lived (5-minute, one-shot) pairing token. The signed-in device asks a Cloud Function to issue the token; the new device scans, presents the token to the Cloud Function, and receives a custom auth token bound to the same `auth.uid`. The recovery code never appears in the QR. Significantly safer.

Phase C is independent of Phase B and can ship in either order. Shipping C-only is fine for the trusted-environment use case; ship the harder version once B is in.

## Spec status

Approved approach: A. Phases B and C are documented future work; no implementation in this spec.
