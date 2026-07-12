# Web group-invite modal: hide the in-app picker when nobody is eligible

**Date:** 2026-07-11
**Status:** Approved (approach A)
**Scope:** `js/inviteModal.js` (one gate), tests.

## Problem

On the web surface, the group invite modal always shows Section 2 — the in-app
invite picker ("Invite specific people directly into the group.", the Invite
button, and the contact list) — whenever `scope === 'group'`
(`js/inviteModal.js:109-112`). When the owner has no eligible contacts, that
section renders as a framing line, a permanently-disabled Invite button, and an
empty list: dead UI.

The Telegram surface already handles the empty case: with no displayable
invitees it skips the modal entirely and opens the share sheet
(`js/inviteModal.js:248`), using the predicate
`hasDisplayableInvitees({ followers, mutuals, currentMemberUids, inviterUid })`
(`js/invitePicker.js:25`).

## Behavior change

In `openInviteModal`, gate Section 2's visibility on
`scope === 'group' && hasDisplayableInvitees(...)` instead of
`scope === 'group'` alone — the same predicate the Telegram shortcut uses.

- **Web, group scope, no eligible contacts:** only the link UI shows
  (create, or manage: copy / regenerate / revoke / share). No picker section.
- **Web, group scope, ≥1 eligible contact:** unchanged — link UI + picker.
- **Personal scope:** unchanged — picker was already hidden.
- **Telegram, group scope:** normally unchanged (empty case never opens the
  modal). On the `createGroupInvite`-failure fall-through, the modal no longer
  shows the empty picker section — same gate, for consistency.

## Design notes

- The predicate is synchronous over data the caller already passes in
  (`followers`, `mutuals`, `currentMemberUids`), so the toggle is decided
  before the modal paints — no pop-in or flash. The async
  `readPendingInviteesForGroup` fetch does not affect eligibility.
- People with a pending invite still count as displayable (they are followers
  with an "Invited" pill), so an owner with outstanding invites keeps the
  section and its un-invite path. This falls out of the existing predicate.
- Eligibility stays defined in one place (`hasDisplayableInvitees`), already
  documented as mirroring the picker's own row filters.

## Rejected alternative

**B — hide inside `renderInvitePicker` when zero rows render.** Runs after the
modal is shown (behind the async pending-invitee fetch), so the empty section
would flash before disappearing; also splits the eligibility decision across
two modules.

## Testing

TDD in the existing jest suite (`tests/`, run `node_modules/.bin/jest` from
repo root):

1. Web group scope, no displayable invitees → `#invite-modal-picker` has
   `hidden`.
2. Web group scope, ≥1 displayable invitee → picker visible (regression
   guard on existing behavior).
3. Personal scope → picker hidden (unchanged).

## Acceptance

Opening "Invite to <group>" on web with no eligible contacts shows only the
link create/manage UI; with eligible contacts the modal is unchanged.
Operator confirms on-device.
