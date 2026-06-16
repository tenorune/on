# User Feature Toggles (experimental) — branch status

**Branch:** `user-feature-toggles` (cut from `dev`)
**As of:** 2026-06-16
**Spec:** `docs/superpowers/specs/2026-06-14-user-feature-toggles-design.md`
**Plan:** `docs/superpowers/plans/2026-06-14-user-feature-toggles.md`
**Tests:** web suite green — 1169 / 42 suites (`npx jest`). No functions/rules changes.

> This branch has grown well beyond the original spec/plan. The plan delivered the
> toggle mechanism; most of the work since has been getting the **"feature off"
> behavior** correct across every surface — and one **design pivot** (see §2).
> Read this before picking the branch back up.

---

## 1. What it does (current behavior)

An experimental per-user feature-toggle section lives in the header `#code-drawer`,
**gated behind the `?features` query param** (ships dark). Two switches:

- **Palettes** — bundles `PALETTES_ENABLED` + `PALETTE_INTERACTIONS_ENABLED`.
- **Groups** — `GROUPS_ENABLED`.

Toggles are per-user, **synced via `userPrefs/{uid}/featureToggles/`**, default on,
and **applied on reload** (the build flags are read once at boot). A user can only
*disable* a build-enabled feature, never enable a build-disabled one.

### Palettes OFF
- **Own view:** no swatch row; status dot + Direct/group cards render the forest
  default; favorites strip hidden; theme vars stay default; the time + share-code
  chips stay visible when unavailable (no swatch row to swap in).
- **Others' view of you:** you keep your saved color/palette server-side but
  broadcast `presence.palettesEnabled = false`; viewers render you as forest with
  no accent, no palette theme, no call-glow color, and **you are not adoptable**.
- **Re-enable:** flip the flag back → your preserved color/palette reappear to
  everyone. Nothing was destroyed.

### Groups OFF
- **Own view:** no nav row (header seats at the top), no group cards, no group
  context, no Inbox, no group-invite entry points, no follow-grants/requests; the
  groups *subscriptions* are gated, not just the rendering.
- **Others' view of you:** you keep your memberships, but broadcast
  `presence.groupsEnabled = false`; co-members **hide you from every group roster**.
  Re-enabling makes you reappear (membership untouched).
- **Group invite link:** opening one while groups are off does **not** silently
  add you — you get a "Turn on Groups to join?" prompt (yes → enable + reload →
  redeem; no → land in Direct). Personal invites are unaffected.

---

## 2. The design pivot (important)

The plan's §1 said "client-side only." During preview testing it became clear that
"feature off" has a **broadcast** dimension: a palettes-off / groups-off user was
still showing their old color / group membership to *other* people.

The **first** attempt cleared the broadcast (`statusColor`/`paletteKey` set to
null; group override color cleared). That was **wrong and reverted** because it was
destructive and inconsistent:
- it lost the user's color, so re-enabling didn't restore it; and
- the group-override clear only ran while the user was *viewing that group*, so a
  co-member kept seeing a stale accent until the user happened to re-enter.

The **shipped** design is non-destructive: **broadcast a capability flag on
presence (`palettesEnabled`, `groupsEnabled`) and have viewers gate on it.** The
user's saved color/palette/membership are never touched; one presence field every
follower already watches drives all the viewer-side rendering, consistently across
Direct and group context. This is the load-bearing pattern on this branch.

**Presence schema additions** (in `users/{uid}/presence`): `palettesEnabled` and
`groupsEnabled` (booleans; absent = enabled, for legacy clients). Written by
`db/social.js` `setPalettesEnabled` / `setGroupsEnabled`, broadcast from
`app.js`'s own-status sync when they differ from the local build flag.

---

## 3. Files touched (beyond the plan)

- `js/featureOverrides.js` (new) — localStorage override store.
- `js/features.js` — effective flags = build default narrowed by override.
- `js/featureSettings.js` (new) — the `?features`-gated drawer section.
- `js/prefs.js` — `get/setFeatureToggle` + cross-device `feature-toggles-synced`.
- `js/db/social.js` — `setPalettesEnabled`, `setGroupsEnabled`.
- `js/app.js` — wire the section; broadcast both flags; groups handler-gating on
  all nav paths; the group-invite-link prompt (`showEnableGroupsPrompt`); cross-
  device reload toast.
- `js/following.js` — viewer gating on the contact's `palettesEnabled` (dot,
  accent via raw color, palette theme, long-press hint, adoption, call-glow).
- `js/groupContext.js` — viewer gating on the member's `palettesEnabled` (dot,
  accent, text, adoption) and `groupsEnabled` (roster visibility); own-row gates
  on the local flag.
- `js/groupNav.js` — nav badge colors gated on `PALETTES_ENABLED`.
- `js/me.js` — keep header chips visible when unavailable + palettes off.
- `css/app.css` — drawer height for the section; header `top:0` when nav row
  hidden; `.feature-settings*` styles.
- `index.template.html` — `#feature-settings` container; hint moved above the
  experimental separator.
- Tests: `tests/featureOverrides.test.js`, `tests/features.test.js`,
  `tests/featureSettings.test.js` (new); extensions to `tests/prefs.test.js`,
  `tests/app-call-recovery.test.js`, `tests/groupContext.test.js`,
  `tests/following.test.js`, `tests/groupNav.test.js`, `tests/me.test.js`.

---

## 4. Open / deferred

- **Invite-picker exclusion of groups-off people (deferred 2026-06-16).** The
  picker is fed only followers' codes + mutuals' labels (no presence), and RTDB
  rules make only the `presence` subtree world-readable — so excluding groups-off
  candidates needs a `presence`-only read helper and a per-candidate read on modal
  open. Deferred because the hidden Inbox + the group-invite-link prompt already
  prevent a groups-off person from actually being pulled into a group; the picker
  filter is only a "don't bother inviting someone who'd have to enable groups
  first" nicety. To implement: add `readPresence(uid)` (or
  `presence/groupsEnabled`) and filter candidates in the picker's caller.
- **Long-press "downpress" visual differs Direct vs group (unrelated).** In group
  context a default-palette member card shows a press/downpress state; Direct
  doesn't (Direct's no-downpress behavior is the desired one). This is a
  pre-existing inconsistency in the long-press/pointer handlers, **not** part of
  the feature-toggle work — handle on a separate branch off `dev`.

---

## 5. Rollout

Ships dark — the section is invisible without `?features`. Build flags stay `true`
on dev + main; the per-user override can only narrow. To preview against the dev
backend:

```bash
node scripts/dev-build.js
npx firebase hosting:channel:deploy feature-toggles --project on-on-22cb4 --expires 7d
```

Open the preview URL with `?features`, open the header share-code drawer →
**Experimental** section. To ungate for everyone later, remove the `?features`
guard in `initFeatureSettings`.
