# Pre-prod smoke test

A manual checklist to run against the **dev** build before merging `dev → main`
and cutting a production release. This is deliberately hands-on — it covers the
flows that automated tests can't (real devices, real cross-device sync, real
push, real OS install prompts).

**How to use it**

- Run through the sections in order. Check a box only when you've seen the
  expected result with your own eyes.
- Anything that fails is a ship-blocker until triaged — note it under
  [Findings](#findings) with exact repro steps.
- The **Palette & color** and **Cross-device** sections are where regressions
  cluster; budget the most time there.

**You will need**

- **Two devices** signed into the **same account** (same 4-word phrase) — call
  them **Device A** and **Device B**. A laptop + phone is ideal because it also
  exercises the install/notification differences.
- **A second account** (a different phrase) that is a **mutual** with the first,
  to exercise knock / call / availability / groups end-to-end.
- The dev URL, and the build running the **current `dev`** (rebuild before you
  start — a stale bundle is the #1 cause of phantom "bugs").

> Sanity check before you start: `git -C . log --oneline -1` on `dev`, rebuild
> (`npm run dev` or a fresh deploy), then hard-reload both devices so the
> service worker picks up the new bundle.

---

## 0. Smoke

- [ ] App loads to the main screen with no console errors.
- [ ] Service worker registers; an update applied without a manual cache clear
      (watch for the auto-update reload).
- [ ] Refresh while signed in → still signed in (no phrase re-prompt).

## 1. Identity & recovery

- [ ] Fresh/incognito session → prompted for a phrase; generating a new identity
      lands you on the main screen.
- [ ] Sign out (or clear storage) and sign back in with the **same phrase** →
      same account, same contacts, same color.
- [ ] Enter a **wrong/garbage phrase** → rejected, no account created, no crash.
- [ ] On a second device, type the same phrase → both devices now drive the same
      account (this is the setup for the Cross-device section).
- [ ] Rapidly retry a phrase several times → rate-limited gracefully by
      `validateRecovery` (no hard error, no lockout of the legit user).

## 2. Presence & availability

- [ ] Go **available** with a timer → your own dot/state reflects it
      immediately; the mutual (other account) sees you go available in real time.
- [ ] Timer counts down and **auto-expires**; both sides return to unavailable.
- [ ] **Go available → go unavailable** manually before expiry → propagates to
      the mutual.
- [ ] Your availability shows in **your selected status color** on the mutual's
      card (not a default).

## 3. Palette & color  ← spend the most time here

The Direct (primary) color picker has **two sets** — **Set 1 Natural** and
**Set 2 Electric** — each with a base mode (key swatch + reverse-lookup) and a
**palette mode** (tap a swatch a second time to reveal its key swatch + 7
complements). Each set independently remembers `{ selectedKey, selectedColor,
activePaletteKey }`. The **active** set's color is what broadcasts to contacts.

### 3a. Single-device, base mode

- [ ] Pick a swatch in **Set 1** → selected indicator (white circle) sits on it;
      go available → contacts see that color.
- [ ] Switch to **Set 2**, pick a different swatch → indicator + go-available
      color both track Set 2.
- [ ] Switch back to **Set 1** → your earlier Set 1 choice is still selected
      (each set remembers independently).

### 3b. Single-device, palette mode (regression-prone)

- [ ] Tap a swatch a **second time** to activate its palette → key swatch + 7
      complements appear; the white selected-circle is visible on the active
      selection.
- [ ] Select a **complement** → indicator stays visible on it; go available →
      contacts see the **complement** color (not the base).
- [ ] **Cross-set palette check (was a regression):** in palette mode, pick a
      complement in Set 2 → switch to Set 1 → switch back to Set 2.
  - [ ] The white selected-circle is **still present** in Set 2.
  - [ ] Go available → the dot is the **Set 2** color you actually selected
        (NOT the other set's color).
- [ ] Tap the active key swatch again to **collapse** the palette → returns to
      base mode without losing the set's remembered selection.

### 3c. Cross-device palette sync (regression-prone)

Set up: Device A and Device B on the **same account**.

- [ ] On **A**: Set 1 = pick swatch X (e.g. "ember"); Set 2 = pick swatch Y
      (e.g. "venom"). Leave A on **Set 1**.
- [ ] On **B** (sign in fresh): the **active** set (Set 1) shows X selected.
- [ ] On **B**: switch to **Set 2** → it shows **Y** (the value A set), **not**
      the default (volt/forest). *(This was the inactive-set-loss regression.)*
- [ ] Reverse it: configure both sets on **B**, leave B on Set 2, open **A** →
      A's Set 2 shows B's choice and Set 1 is preserved.
- [ ] Change the active set's color on A → B reflects it live (own-status watch),
      and the **inactive** set on B is **not** clobbered.

### 3d. Favorites / adopt

- [ ] Save a color combo to **favorites** (up to 8) → persists across reload and
      across devices.
- [ ] **Long-press a mutual's card** → adopt their color + theme; your UI theme
      changes and your broadcast color updates.
- [ ] Saving a 9th favorite is handled gracefully (cap enforced).

### 3e. Theming

- [ ] Each palette applies as a **full UI theme** (CSS custom properties) — not
      just the dot. Switch a couple and confirm the surrounding UI recolors.
- [ ] Reload → the active theme persists.

## 4. Knock

- [ ] Tap a **mutual's card** → they get a knock notification pulse (in-app
      and/or push).
- [ ] Knock when the recipient is **foreground** vs **backgrounded** → both
      land (push covers the background case).
- [ ] Rapid repeated knocks → de-duped / cooled-down, not a spam storm.

## 5. Call mode + shared canvas

- [ ] **Swipe right** on a mutual → call invite sent.
- [ ] Recipient **swipes right to answer** → both land on the **shared canvas**.
- [ ] Draw on one device → strokes appear on the other in real time.
- [ ] Background fill / color tools work; canvas **persists per user-pair** (end
      and re-open → strokes still there).
- [ ] **End the call** from either side → both exit cleanly; re-initiating works.

## 6. Groups

- [ ] **Create a group** → you're owner; it appears in your group nav.
- [ ] Invite a contact **via link** → they open the link → land in the group
      (display-name prompt where applicable).
- [ ] Invite **via in-app picker** → invite shows in the invitee's **Inbox**.
- [ ] Accept from Inbox → membership reflected on both sides; decline →
      cleared, no ghost membership.
- [ ] Set a **per-group status override** (different availability/color than your
      primary) → group members see the override, non-members see your primary.
- [ ] Switch between **Direct context** and a **group context** → the right
      audience/color is shown in each.
- [ ] Owner removes a member / member leaves → reflected on both sides.

## 7. Follow requests & Inbox

- [ ] Send a follow request → appears in the target's **Inbox**.
- [ ] Accept → mutual established (both can see each other's presence); decline →
      no relationship, no leak.
- [ ] Inbox badge/count clears correctly after handling items.

## 8. Push notifications

> See [`docs/notifications-testing.md`](notifications-testing.md) for the full
> platform matrix and the `?notifydebug=1` workflow. Quick pre-prod pass:

- [ ] **Per-contact opt-in**: enable notifications for one contact → you get
      their knock/availability pushes; a non-opted contact doesn't push.
- [ ] Receive a push for each type at least once: **knock, call, availability,
      group invite, follow request**.
- [ ] Tapping a push **routes** to the right place in the app
      (`notifyRouting`).
- [ ] **iOS**: install-to-Home-Screen guidance appears where required; push works
      only from the installed PWA (expected).
- [ ] **macOS/Safari**: the install/Dock nudge is scoped to Safari and shows the
      right copy + icons.
- [ ] Revoke OS notification permission → app degrades gracefully (no crash,
      sane in-app fallback).

## 9. PWA / install / update

- [ ] **Install** the PWA (Add to Home Screen / Install) → launches standalone.
- [ ] Offline shell: kill the network → app still opens to its shell (no white
      screen of death).
- [ ] Ship a new bundle → the **auto-updating service worker** picks it up
      (update applied on next load without manual cache clear).

## 10. Cross-device consistency (final sweep)

With A and B on the same account, confirm these **all** sync live:

- [ ] Availability state + timer
- [ ] Active status color / palette (active set)
- [ ] Inactive set's selection is preserved (not defaulted) — see 3c
- [ ] Favorites list
- [ ] Group memberships and per-group overrides
- [ ] Following/followers list

---

## Regression watchlist

Explicit re-checks for bugs fixed during this release cycle — confirm each is
**gone**:

- [ ] **Inactive-set loss on cross-device sign-in** (3c): signing in on a new
      device no longer resets the non-visible set to its default.
- [ ] **Cross-set echo mis-attribution** (3b): in palette mode, switching sets
      after selecting a complement no longer drops the white selected-circle or
      broadcasts the wrong set's color on go-available.

---

## Pre-merge gates

Run before merging `dev → main`:

- [ ] Web suite green: `npx jest` (repo root)
- [ ] Functions suite green: `cd functions && npm test`
- [ ] Production bundle builds clean
- [ ] No new console errors during the manual pass above
- [ ] [`docs/DEPLOY-PROD.md`](DEPLOY-PROD.md) prerequisites satisfied (first-ever
      prod functions deploy has extra GCP/IAM setup)

---

## Findings

Log anything that failed here, with device + exact steps, so it survives the
session:

| # | Area | Device | Steps | Expected | Actual | Status |
|---|------|--------|-------|----------|--------|--------|
|   |      |        |       |          |        |        |
