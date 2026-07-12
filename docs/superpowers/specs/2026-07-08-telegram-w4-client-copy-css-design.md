# Telegram W4 — client copy + CSS sweep (design)

Date: 2026-07-08
Branch: cut from the `t1r1jp` tip (canonical, carries W1+W2+W3).
Source: `docs/superpowers/2026-07-07-telegram-feature-analysis.md` §1.4 (C#4, C#9, C#13, C#14, C#10, C#11, C#12) + the C#5 reframe below.

This is one of two W4 specs. This one covers the **client** surface — copy voice,
two real CSS bugs, and two small behavior fixes — and is accepted by a **web /
Mini-App walkthrough**. The bot-side delight batch is the companion spec
(`…-w4-bot-delight-design.md`).

## Why these are grouped

They share a surface (`js/`, `css/`, `index.template.html`) and an acceptance
gate (the web/webview walkthrough). Individually cheap; together one PR-shaped
chunk. Delivered as **four commits** so the mechanical copy edits stay separate
from the behavior changes (which each get their own on-device check):

1. Copy sweep (pure strings)
2. CSS token fix + touch target
3. C#5 behavior — empty-picker share shortcut
4. C#11 behavior — graduation dialog on the confirm primitive

## Commit 1 — copy sweep

Pure string edits. No behavior change.

### C#4 — one entry label for the phrase-link flow
The same `showLinkScreen()` launches under three labels. Winner: **"I have a
secret phrase"** as the entry affordance (matches the web welcome/stale screens);
**"Link account"** stays only on the submit button.

- `index.template.html:302` — first-run panel `Link your account` → **`I have a secret phrase`**.
- Already correct (leave): `js/telegramSettings.js:22` and `index.template.html:65` (`I have a secret phrase`); `js/telegramSettings.js:94` submit (`Link account`).

### C#9 — error-string voice
Normalize new failure strings to the contraction form + straight apostrophe:
**"Couldn't … Try again."**

- `js/inbox.js:286,337` — `Could not … Please try again.` → `Couldn't … Try again.`
- `js/inviteModal.js:126` (and the same string at `:132,:167,:212,:228`) — `Could not create/regenerate/revoke invite. Try again.` → `Couldn't …`
- `js/notifyPrompt.js:91` — curly `Couldn’t` → straight `Couldn't`.
- Already correct (leave): `js/telegramSettings.js:116`, `js/graduation.js:52`.
- **Exception (decided):** `js/app.js:118` keeps `Couldn't start KnockKnock. Please try again in a moment.` — the softer phrasing earns its keep on the boot dead-end.

### C#13 — bare group names + Leave-confirm message
User-chosen group names read as scare quotes when wrapped. Winner: **bare**
(the Telegram/bot majority style).

- Drop the surrounding straight quotes: `js/inbox.js:206` (`join 'X'.`), `js/app.js:275`, `js/groupContext.js:908` (`Delete 'X'?`), `js/groupContext.js:925` (`Leave 'X'?`).
- Related nit folded in: the **Leave** confirm (`groupContext.js:925`) passes no explanatory message while Delete (`:908`) and the unfollow sheet (`js/following.js:119`) do. Add a matching one-line explanatory message so the three confirms are consistent.

### C#14 — drawer chip boot label
The markup default disagrees with the runtime steady state, so every non-empty
boot renames the chip after the first roster render (flash).

- Runtime steady state: `js/firstRun.js:82` renders `Share code` (code-only empty state) vs **`Levers & knobs`** (every other state).
- `index.template.html:251` default is `Share code`. Change the markup default to the majority steady-state label so the boot flash disappears. (The empty-state code-only case still renames to `Share code` at runtime — that path is unchanged.)

## Commit 2 — CSS token fix + touch target

### C#10 — `.drawer-section` invents nonexistent tokens
`css/app.css:320-321` uses `var(--border, …)` and `var(--text-dim, …)`; neither
token is defined (`css/app.css:4-25`, theme-restore `index.template.html:25`), so
the static fallbacks always render and never follow a palette swap.

- `border` → `1px solid var(--surface2)` (the established border token, e.g. `app.css:504-507`).
- `color` → `var(--text-muted)` (the established secondary-text token).

### C#12 — grow the "?" help badge hit area (folded in)
`css/app.css:1461-1469` gives the graduation "?" a ~18px (`1.15rem`) target — the
smallest interactive control in the app on a mobile-first surface. Keep the visual
size; grow the hit area toward the ~28px neighbors (padding or a `::before`
hit-slop). Both placements (`index.template.html:302`, `js/telegramSettings.js:23`).

## Commit 3 — C#5 (reframed): empty-picker share shortcut

**No label changes.** The apparent "Share / Share on Telegram / Share to Telegram"
drift is not drift: each label is contextually correct.

- `#invite-modal-share-btn` (`index.template.html:105`) — **"Share"** in Telegram (native sheet); relabeled **"Share to Telegram"** on web (`js/inviteModal.js:185`). Both stay.
- `#invite-modal-tg-share-btn` (`index.template.html:114`) — **"Share on Telegram"** in the TG group modal. This label is meaningful *by contrast with the "Invite specific people directly…" in-app picker below it* (share-out vs share-in-app). It stays.

The real improvement is behavioral: when the TG group modal would show **no
displayable contacts** in that picker, there is nothing to contrast against, so
the modal is pointless — **skip it and open the native Telegram share sheet
directly**.

### Design
- Extract a pure predicate **`hasDisplayableInvitees({followers, mutuals, currentMemberUids, inviterUid})`** in `js/invitePicker.js`, computed from the same two filters that build the rendered rows (`invitePicker.js:32-43`): mutuals present in `followers`, minus current members, minus self, unioned with non-mutual followers minus current members minus self. `renderInvitePicker` is refactored to derive its row list from the same source so the check cannot drift from what actually renders.
  - Note: pending-invitee UIDs do **not** affect the count — pending contacts still render as (disabled) rows (`invitePicker.js:94,108`). So emptiness is knowable **synchronously**, without the `readPendingInviteesForGroup` await.
- In `js/inviteModal.js` `openInviteModal`, for the TG group path (`tgGroupShare === true`): if `!hasDisplayableInvitees(...)` → do not show the modal; call `createGroupInvite(userId, groupId)` then `shareInviteLink({token,url}, shareCaption('group', groupName))` — the exact action the "Share on Telegram" button performs.
- **Error fallback:** if the direct `createGroupInvite` throws, fall back to opening the modal (its existing inline error surface shows the failure). The shortcut never swallows an error.

### Tests (red-first)
- `hasDisplayableInvitees` truth table: some mutuals, only current-members, only self, empty followers, mixed with pending (pending still counts as displayable).
- `openInviteModal` TG group, no displayable contacts → modal stays hidden, `createGroupInvite` + share called.
- Same, with displayable contacts → modal shows as today (picker renders).
- Direct-share `createGroupInvite` rejects → modal opens with the error.

## Commit 4 — C#11: graduation dialog on the confirm primitive

The graduation "info toast" is a `role="dialog"` two-choice decision UI ("I want
an account" / "Close") wearing a bottom-snackbar skin (`js/graduation.js:22-40`,
`.graduation-toast` at `css/app.css:1474-1483`) — **no backdrop, no Escape, no
back-button coverage**, while every other two-choice decision on this branch uses
`.confirm-overlay` (backdrop-tap + Escape + cancel), e.g. `js/promptModal.js:61-94`,
`js/telegramSettings.js:43-64`.

### Design
- Rebuild `showGraduationInfo()` on the shared `.confirm-overlay` primitive: `INFO_TEXT` body, primary "I want an account" → `startGraduation()`, cancel "Close". Gains backdrop-tap dismiss, Escape, and back-button coverage for free from the primitive.
- Retire `.graduation-toast` CSS (`css/app.css:1474-1483`) once nothing references it. (Its geometry near-duplicated `.group-removal-toast` — no longer relevant after the move.)
- Keep the "?" entry affordance and the downstream `startGraduation` ceremony (recovery modal → `callGraduateTelegram`) unchanged.

### Tests (red-first)
- `showGraduationInfo` mounts a `.confirm-overlay` (not `.graduation-toast`).
- Backdrop tap dismisses; Escape dismisses; "I want an account" invokes `startGraduation`.
- No `.graduation-toast` element remains in the DOM after open.

## Shared units introduced
- `hasDisplayableInvitees(...)` — pure, in `js/invitePicker.js`; single source of truth for "is the picker empty".

## Out of scope (named, not done)
- J#9 (no revoke/manage path in TG) — a separate future item; C#5 does not add manage UI.
- The `notifyChannel`/`notifySuppression`/`notifier` three-reader predicate — untouched (landmine).

## Acceptance
Green suites are necessary, not sufficient. On-device gate (operator):
- Web walkthrough: copy reads consistently; drawer chip does not flash-rename on boot; `.drawer-section` rethemes with a palette swap; "?" is comfortably tappable.
- Mini-App: TG group invite with zero eligible contacts opens the share sheet directly; with contacts, the modal shows as before; graduation "?" opens a proper dialog dismissable by backdrop/Escape/back.

## Testing commands
- Web: `npx jest` (repo root, baseline 1461).
