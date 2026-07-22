# Location sharing — design spec

**Date:** 2026-07-18
**Status:** Approved design, pre-implementation
**Approach:** Rules-gated coordinates, client-computed distance (Approach A; alternatives B "server-mediated projections" and C "on-demand callable" considered and rejected as heavier than the app's grain requires)

## 1. Summary

Opt-in location sharing that surfaces **distance** (never position, never a map) on the cards where people already render. Two visibility tiers, both requiring that *both* parties are actively sharing:

- **Mutuals** (each follows the other): **precise** distance, meter-level ("120 m", "2.3 km").
- **Shared-group co-members** (not mutuals): **coarse** distance, structurally floored at "<1 km away".
- **Everyone else** — including followers you don't follow back and any non-sharer: **nothing**. No distances, no empty slots, no nag.

Distance is ambient context for knocking — a soft signal on existing contact cards, not a meetup feature. Publication is **tied to availability**: location is published only while the user is Available, refreshed every minute while the app is foreground, and reciprocity is enforced *by database rules*, not client politeness.

## 2. Decisions log

| # | Question | Decision |
|---|----------|----------|
| 1 | Purpose | Ambient context on existing cards; no map. Precision may go to meter level (amended from "coarse"). |
| 2 | Audience | Tiered: mutuals precise; shared-group co-members coarse (never finer than "<1 km"); all others nothing. |
| 3 | Capture | Tied to availability; refresh every 60 s while app foreground; **silent staleness** — no "as of" labels, values update when fresh data lands or hold otherwise. |
| 4 | Opt-in shape | Per-context glyph toggles (amended twice from "account-wide drawer toggle"): the location glyph **is** the control. Direct glyph → precise tier on/off; each group's glyph → that group's coarse tier on/off. No drawer toggle, no settings rows. |
| 5 | Telegram | Full parity in v1: Mini App capture via `Telegram.WebApp.LocationManager`, shared-client display, and bot `/who` distance text. |
| 6 | Architecture | Approach A. Explicit sign-off on the trade-off: **sharing mutuals can read each other's raw lat/lng from the DB** (the UI shows only distance, but the data grants position). |

## 3. Data model

Two new top-level RTDB subtrees plus private prefs. Nothing touches `users/{uid}/presence` — presence is world-readable to any authed user (`database.rules.json:14`), so coordinates must not live there.

### 3.1 `locations/{uid}` — precise tier

```
locations/{uid} = { lat: number, lng: number, updatedAt: number }
```

- Written by the owner every 60 s while: Direct opt-in ∧ Available ∧ app foreground ∧ permission granted.
- **Existence of this node is the public "currently publishing" signal.** Reciprocity rules key off it (§4).
- Deleted (multi-path, together with all cells) when: Direct opt-in toggled off, availability ends (manual, or expiry write-back in `writeBackExpired`), permission revoked, logout/user-switch.
- `updatedAt` is client `Date.now()`, consistent with the `lastSeen` convention. Nothing gates on it in v1 (silent staleness), so clock skew is cosmetic.

### 3.2 `locationCells/{gid}/{uid}` — coarse tier

```
locationCells/{gid}/{uid} = { lat: number, lng: number, updatedAt: number }
```

- Same tick, same conditions, but per-group opt-in: written only for groups where `userPrefs/{uid}/location/groups/{gid}` is true.
- Coordinates are **snapped to a ~1 km grid (0.01°)** before writing. A snapped point is *incapable* of sub-kilometer precision — the "<1 km floor" is structural, not cosmetic.
- Top-level rather than under `groups/{gid}/members/{uid}/`: RTDB cannot narrow a child read below a parent grant (the group node's member-gated `.read` would expose cells to *all* co-members unconditionally), and a fresh path lets the coarse tier get rules-enforced reciprocity of its own.

### 3.3 `userPrefs/{uid}/location` — private opt-in state

```
userPrefs/{uid}/location = {
  direct: true,            // precise tier on
  groups: { {gid}: true }  // coarse tier on, per group
}
```

- Owner-only R/W (inherits the existing `userPrefs` grant), cross-device synced via `mergeUserPrefs` — follows the presence-schema split (`js/db/social.ts:156-174`): the *setting* is private; only the *published data* is visible.
- Default absent = off everywhere. No master switch.
- Opt-in state survives unavailability: going unavailable deletes the published nodes but does not flip the opt-in — returning to Available resumes publishing automatically.

### 3.4 Reciprocity consequence (pinned)

Because visibility requires the reader's own published node to exist, **you see distances only while you yourself are actively publishing in that context**. A sharing-but-currently-unavailable user sees no distances. A member who opts out of group X's tier loses X's coarse distances too. Symmetric by construction, per-surface.

## 4. Security rules (`database.rules.json`)

### 4.1 `locations/{$uid}`

- **Write:** `auth != null && auth.uid === $uid`.
- **Validate:** `lat` number in [-90, 90]; `lng` number in [-180, 180]; `updatedAt` number; no unknown children (`$other: { ".validate": false }`).
- **Read:** `auth != null && (auth.uid === $uid || (` mutuality ∧ reciprocity `))` where:
  - reader follows target: `root.child('users').child($uid).child('followers').child(auth.uid).exists()`
  - target follows reader: `root.child('users').child(auth.uid).child('followers').child($uid).exists()`
  - reader is publishing: `root.child('locations').child(auth.uid).exists()`

All three checks are expressible in the current rules grammar against existing data (followers entries at `database.rules.json:32-37`).

### 4.2 `locationCells/{$gid}/{$uid}`

- **Write:** `auth != null && auth.uid === $uid && (` writer is a member: `root.child('groups').child($gid).child('members').child(auth.uid).exists()` `|| !newData.exists())` — the delete-only carve-out lets a kicked user clean up their orphaned cell (§8).
- **Validate:** same coordinate/`updatedAt` validators as §4.1.
- **Read:** reader is a member of `$gid` ∧ `root.child('locationCells').child($gid).child(auth.uid).exists()` (coarse reciprocity — you read a group's cells only while publishing into that group).

Both subtrees are added above the catch-all `$other` deny (`database.rules.json:177-181`). Presence rules are untouched.

### 4.3 What rules do NOT enforce (known limits)

- The coarse-tier *precision* floor is enforced by the client snapping before write, not by rules (rules cannot verify grid alignment). A hostile client could write precise coords into its own cell — exposing only **its own** location more precisely, which is self-harm, not attack surface on others.
- Admin SDK (Cloud Functions) bypasses rules; the bot must re-implement the gates explicitly (§7).

## 5. Capture — `js/locationShare.ts`

New module owning the whole capture lifecycle. One loop, evaluated per context:

- **Start conditions (per context):** context opt-in ∧ own status Available ∧ `document.visibilityState === 'visible'` ∧ permission granted.
- **Tick:** every 60 s — `navigator.geolocation.getCurrentPosition({ enableHighAccuracy: true })`; on success, one multi-path `update()` writing `locations/{uid}` (if Direct on) and each opted-in group's snapped cell. Multi-path atomic-write precedent: `writePendingInvite`, `startCall`.
- **Telegram branch:** in `isTelegramContext()`, capture goes through `Telegram.WebApp.LocationManager` (init → `getLocation`) instead of `navigator.geolocation` — the same branch point the notification flow uses (`js/notifyPrompt.ts`). Everything downstream (writes, display) is shared.
- **Visibility:** timer pauses on hidden, immediate capture + resume on visible.
- **Failed/timed-out tick:** skipped silently — last written value stands, no UI change (Decision 3).
- **Teardown paths** (each deletes the relevant published nodes in one update):
  - Context toggled off → that context's node(s).
  - Going unavailable (manual toggle in `js/me.ts`, or expiry via `writeBackExpired` in `js/db/social.ts:277-279`) → all published nodes.
  - Permission revoked mid-flight (tick fails with `PERMISSION_DENIED`) → loop stops, all nodes deleted, glyphs render the denied-guidance state.
  - Logout/user-switch → all nodes, loop torn down.
- **Permission prompt** fires only on the first glyph tap (explicit intent), mirroring `ensureNotificationsReady`'s gating (`js/notifyPrompt.ts:122-152`). Capability detection and denied/unsupported guidance reuse the `installGuidance` pattern (`detectNotifyCapability` / `guidanceCopyFor` analog for geolocation).

## 6. Display

### 6.1 The glyph — the only control surface

- **Direct header:** a location glyph next to `#time-remaining` (`js/me.ts` header). Tap toggles the **precise tier**. Off by default; dimmed when off, active when on.
- **Group band:** the same glyph in each group's own-status band (`js/groupContext.ts` ~`:396-442`). Tap toggles **that group's coarse tier**, independently per group.
- The glyph reflects *opt-in state*; publishing follows availability automatically. Exact visual treatment of off / on / on-but-not-publishing, and the glyph itself, are settled on-device with the operator ("done" is the operator's call on anything visual).
- First tap in any context runs the permission flow (§5). Denied → disabled-guidance state.
- No drawer toggle. No group-settings row. No other settings surface.

### 6.2 Distance rendering

- **Mutual cards** (Direct list, Mutuals section — `js/following.ts` `updateFolloweeRow`): distance appended to the existing status line — "Available for 2h · 120 m". Only on **available** cards (same predicate as the green dot), only while own publishing in Direct is live.
- **Group roster** (`js/groupContext.ts` `paintRosterRow`): coarse text from cells — "<1 km away", else "~N km" (whole km). Only on available members, only while own cell in that group is live.
- **Precise wins everywhere:** a co-member who is also a mutual shows precise distance in the group roster too, **when the precise gate passes** (both parties publishing in Direct); if only the group gate passes (either party is group-publishing but not Direct-publishing), the roster falls back to coarse.
- **Formatting** (single shared util, §7): `< 1 km` → meters ("120 m"); `< 10 km` → one decimal ("2.3 km"); else whole km ("23 km"). Metric only in v1.
- **Subscriptions** ride a new `js/locationHub.ts` multiplexer cloned from `js/presenceHub.ts` — one `onValue` per watched node, fanned out, cache-and-replay. Subscriptions are opened only while the viewer is publishing in the relevant context; non-sharers open nothing (rules would deny the reads anyway — the client just never attempts them).
- **60 s label refresh:** distance text repaints on data arrival (RTDB push), not on the `_refreshTimeLabels` tick — no timer coupling needed.

## 7. Shared code and server

### 7.1 `shared/geo.js`

`haversineMeters(lat1, lng1, lat2, lng2)`, `snapToCell(lat, lng)` (0.01° grid), `formatDistancePrecise(m)`, `formatDistanceCoarse(m)`. Single source in `shared/`, mirrored to `functions/_shared/` via `npm run sync-shared` (never hand-edit the mirror), pinned by:
- `tests/sharedMirror.test.js` / `functions/test/shared-mirror.test.js` (mirror identity), and
- a new parity test in the `tests/presencePredicateParity.test.js` mold if any client/server predicate divergence risk appears (at minimum, a vector-table test over the formatters and haversine shared by both sides).

### 7.2 Bot (`functions/telegram.js`)

Admin SDK bypasses rules, so handlers re-implement the gates explicitly:

- **`/who`** (`handleSocialCommand`, `:531-550`): for each listed available followee — requester publishing (`locations/{requesterUid}` exists) ∧ target publishing ∧ mutuality (both `followers` entries) → append "· 120 m" via `formatDistancePrecise`.
- **`/who <group>`** (`handleWhoGroup`, `:445-464`): requester's cell exists in that group ∧ target cell exists → append coarse text via `formatDistanceCoarse`.
- Requester not publishing → no distance text anywhere (bot output mirrors app behavior exactly; shared formatters keep the text identical).

### 7.3 Explicit non-goals for v1

- No new RTDB triggers, no location-based notifications ("X is nearby" is a possible future issue, out of scope).
- No server sweep for stale rows (see §8 stale-rows entry).
- No maps, no direction/bearing, no location history — `locations/{uid}` holds exactly one point, overwritten in place.
- No imperial units / locale formatting.

## 8. Edge cases

| Case | Behavior |
|------|----------|
| Permission denied mid-flight | Loop stops, published nodes deleted, glyphs show denied-guidance state. |
| Stale rows (app closed while Available) | `locations/{uid}` persists until expiry write-back or next launch. Invisible in practice — distance renders only on available cards and reads are reciprocity-gated — cleanup is opportunistic client-side delete on next launch. |
| Leaving a group | Own cell deleted in the same update as the leave. |
| Kicked from a group | Cell orphans; roster removal hides it from viewers immediately; the kicked user's next tick or launch cleans it. Rules note: an orphaned cell under a group the user no longer belongs to is unreadable by them for cleanup via the member-gated write — cleanup delete must be permitted for `auth.uid === $uid` regardless of membership (delete-only carve-out: allow the write when `!newData.exists()`). |
| Group deleted by owner | `locationCells/{gid}` orphans server-side; harmless (unreadable — no members exist to pass the read gate) but noted for a future sweep. |
| Multi-device, both publishing | Last-write-wins on a single node; coherent — it is one person. |
| Telegram client without `LocationManager` | Glyph renders in unavailable-with-guidance state (capability detection, mirroring notification support detection). |
| In-app browsers | Geolocation is typically blocked or unreliable; same `isInAppBrowser()` detection path gates the glyph into guidance state. |
| Antimeridian / poles | Haversine handles both; snap grid degrades gracefully at extreme latitudes (cells narrow in longitude — floor still holds, cells only get *smaller* in one axis at latitudes where nobody's 1 km circle is honest anyway; accepted). |
| Trilateration of a sharer by a moving viewer | Precise tier: mutuals-only by rule — accepted intimacy trade-off (Decision 6). Coarse tier: floor-limited by grid snap. Mitigation posture: audience scoping + one-tap kill (toggle off = immediate delete), not blurring. |
| Viewer opted in but unavailable | Own node absent → rules deny all location reads → no distances shown. Consistent with §3.4. |
| Clock skew in `updatedAt` | Cosmetic only; nothing gates on it in v1. |

## 9. Platform work

- **CSP / headers** (`firebase.json:27`): no `connect-src` additions needed (no external geo services — device API only). A `Permissions-Policy` header allowing `geolocation=(self)` should be added, and the Telegram iframe path documented: inside Telegram, capture uses `LocationManager`, not `navigator.geolocation`, so no iframe `allow` attribute is required from Telegram's embedder. CSP/header changes are guarded by `tests/deploy-workflows.test.js` / `tests/build-env.test.js` — update those pins in the same change.
- **Authoring boundaries:** client modules in TS with `.js` import specifiers; `functions/` stays JS+JSDoc; `js/features.js` and `about-*.js` untouched; no inline `<script>` changes (CSP hashes).

## 10. Testing

- **Rules:** new `tests/rules/locations.test.js` — matrix over: owner R/W; mutual+both-publishing read allowed; mutual+reader-not-publishing denied; non-mutual denied; follower-only denied; unauthenticated denied; validators (range, type, unknown children); cells: member+publishing read allowed, member-not-publishing denied, non-member denied, non-member write denied, delete-only carve-out for orphaned cells.
- **Client (jest/jsdom):** `tests/locationShare.test.js` — loop start/stop conditions per context, 60 s tick with fake timers, mocked geolocation success/failure/denial, visibility pause/resume, teardown deletes, multi-path write shape. `tests/locationHub.test.js` — multiplexing, cache-and-replay (clone of `presenceHub` suite). Formatting vectors. Render integration in `tests/following.test.js` / `tests/groupContext.test.js` (distance line present/absent per gate). Note the `following.test.js` mid-file-require landmine: bind exports at describe-eval time.
- **Functions:** `/who` and `/who <group>` gate matrix with injected fake deps (`store-deps.js` pattern).
- **Parity/mirror:** `shared/geo` vector table on both sides; sync-shared mirror pins.
- Mocking stays at the `./db.js` barrel boundary, per convention.

## 11. Surfaces touched (implementation map)

| Surface | File(s) | Change |
|---------|---------|--------|
| Capture loop | `js/locationShare.ts` (new) | Whole lifecycle |
| DB primitives | `js/db/social.ts` (or new `js/db/location.ts` re-exported via `js/db.ts` barrel) | write/delete/watch helpers |
| Fan-out hub | `js/locationHub.ts` (new) | presenceHub clone |
| Direct header glyph | `js/me.ts`, `index.template.html`, `css/app.css` | Toggle + states |
| Group band glyph | `js/groupContext.ts`, `css/app.css` | Toggle + states, per group |
| Direct card distance | `js/following.ts` | Status-line suffix |
| Roster distance | `js/groupContext.ts` | Status-line suffix |
| Shared geo | `shared/geo.js` (+ mirror) | New module |
| Bot | `functions/telegram.js` | `/who` distance text |
| Rules | `database.rules.json` | Two new subtrees |
| Headers | `firebase.json` | `Permissions-Policy` |
| Prefs | `js/prefs.ts` | `location` subtree accessors |
