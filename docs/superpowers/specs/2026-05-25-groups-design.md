# Groups — Design

*Date: 2026-05-25*

A design exploration for a multi-status, multi-audience "groups" feature. Captured from a brainstorming session; not an implementation plan. All decisions below are locked from that conversation unless explicitly noted as deferred.

---

## Goal

Two underlying motivations:

- **B — Scaling.** Clubs, organizations, friend circles. Members opt in to share status with others in the group without exchanging share codes one-by-one. Replaces N×N share-code exchanges with one invite link.
- **C+A — Contextual status.** A user wants their status to vary by audience. *"Available to family for 2h while invisible to work-chat."* Today, a single status per user collapses these contexts together.

Plus a tactic:

- **D — Onboarding via link.** New users can join the app *via* a group invite link, bypassing the existing share-code exchange. This is a delivery mechanism that serves both B and C+A.

---

## Status model

**Per-audience independent statuses, with the user's primary (Direct) status as the broadcast source.**

- Direct contacts is the home; the primary status is what your direct followers see.
- For each group, a **"Set a unique group status"** toggle:
  - **OFF (default):** group sees the user's primary status (Direct's status). Going available in Direct broadcasts to all groups whose toggle is OFF.
  - **ON:** group sees an audience-specific status, independent from Direct. **Initial value when toggled on: Unavailable.** User explicitly goes available there with their own duration.
- "Followers" itself participates symmetrically — the same toggle exists for the followers audience.
- No abstract "default" concept floating above the audiences. The Direct status IS the broadcast source.

**Why this:** Satisfies B without per-group overhead (most users just have one status everywhere). Satisfies C+A by allowing per-audience divergence when needed. Defaulting to OFF + opt-in to Unavailable on toggle makes the override an explicit choice — no accidental hiding.

---

## Identity model (display names)

- Each user has a **per-group display name**, set during join (asked as a step in onboarding for new users; first-time prompt for existing users entering a group). Editable later within the group's context.
- **No cross-context leakage in MVP.** A follower of mine who isn't in `Family` never sees my `Family` display name. Display names are scoped to their context.
- For direct followers, today's behavior persists — followers set labels for themselves, visible only to that follower.
- **Cross-referencing** (consenting users opt to surface their per-context names) is post-MVP.

---

## Navigation

**Navigation IV** — direct contacts is the "home"; each group is a separate context. The user is in exactly one context at a time. Persistent across sessions and devices.

### Entry points from Direct

A thin horizontal row of **group cards** at the top of Direct context (above the Mutuals / Following / Followers sections). Each card carries:

- Group name (small)
- Indicators (e.g., unread knock count badge)
- Color/theme reflecting the user's status for that group:
  - Override toggle **ON** → card shows the override's color/theme.
  - Override toggle **OFF** → card shows a neutral surface color.

After the last group card, a small `+` affordance creates a new group.

**Zero state:** when the user has no groups, the `+` expands to a full-width *"Create your first group"* call-to-action.

### Entry point from a group context (back to Direct)

A thin **breadcrumb bar above the header** showing just the back-arrow plus the current group's name:

```
←  Family
```

Tap the arrow → return to Direct. No "Direct" word anywhere — the arrow alone is the affordance. Cross-group navigation (Family → Skydivers) is a two-tap operation: arrow back to Direct, then tap the destination group's card.

### Persistence

- `currentContext` is a piece of user state stored in Firebase + localStorage. Synced via the existing `watchStatus` pattern.
- New users default to Direct (no group history to restore).
- If a user is removed from a group while their app is closed, on next launch the saved context is invalid → fall back to Direct.

### Collapse strategy for many groups

Deferred to post-MVP. Live with the horizontal stretch in v1. Candidate strategies for later: horizontal scroll, collapse-to-pill, max-pinned + overflow.

---

## Group entity

```
groups/{groupId}:
  name: string                     // not unique; collisions OK in v1
  ownerId: userId
  createdAt: timestamp             // stored, not surfaced in MVP UI
  color?: string                   // post-MVP, owner-configurable
  paletteKey?: string              // post-MVP
  members/{memberUid}:
    role: 'owner' | 'admin' | 'member'    // MVP only uses 'owner' and 'member'
    displayName: string
    joinedAt: timestamp
    pendingApproval?: boolean              // reserved for post-MVP gating
  invites/{inviteId}:
    scope: 'group'
    token: string
    creatorUid: userId
    createdAt: timestamp
    expiresAt: timestamp | null
    redemptionCap: number | null    // null = unlimited; 1 = single-use
    redemptionsUsed: number
    revoked: boolean

users/{uid}:
  // existing fields ...
  groups/{groupId}: { role, displayName, statusOverride? }
  currentContext: 'direct' | 'group:{groupId}'
  pendingInvites/{groupId}: { from, ts }   // Phase 3 (Shape X in-app invites)
```

**Group ID:** 8-char alphanumeric random, transactionally allocated against a `groupIdIndex` (same pattern as `codeIndex` for share codes).

**Group name:** free text, max 40 chars, not unique. Two different owners can create groups with the same name. Disambiguation when a user is in multiple groups of the same name is deferred to post-MVP (live with the ambiguity in v1).

**Open/closed status:** likely derived from "any valid invite links exist + a member with invite permission exists" rather than a separate stored flag. To be locked once permissions are clearer.

---

## Roles

| Role | Powers |
|---|---|
| **Owner** | Everything: rename, delete, set color/palette (post-MVP), promote/demote admins (post-MVP), invite (links + in-app), kick |
| **Admin** *(post-MVP)* | Invite (links + in-app), kick, set color (configurable subset of owner powers) |
| **Member** | See roster, set their own status (incl. per-group override), edit own display name, leave |

- **Single owner per group.** Owner is the creator.
- **Owner cannot leave** the group in MVP. Ownership transfer is post-MVP.
- **Multiple admins allowed** (post-MVP). Only the owner promotes/demotes admins.
- **Orphan groups** (owner abandons account without transfer) remain functional indefinitely. Post-MVP: optional reminder to owners to designate an admin or successor.
- MVP collapses to **Owner + Member** only; the `role` field exists in the data model so admins can be added later without migration.

---

## Invite system

**One primitive, two scopes.** A single `invite-link` entity with a `scope` discriminator: `personal` (follow-me) or `group:{id}`. Shared lifecycle code paths; divergent redemption logic.

### Lifecycle

- **Create.** Owner (or admin, post-MVP) generates an invite link. Optional cap (1, N, unlimited). Optional TTL. Token = unguessable URL-safe random string.
- **Revoke.** Creator can revoke at any time. Revoked links return a friendly error on redemption.
- **Regenerate.** Replace one link with a fresh token. Old link returns a friendly error.
- **Cap.** Each redemption decrements remaining count. At zero, link returns a friendly error.
- **TTL.** Optional expiry timestamp. Past expiry, link returns a friendly error.

### Redemption

- **Personal scope** (`scope: 'personal'`): redemption establishes a follow from redeemer → creator. The follow is independent of any group membership.
- **Group scope** (`scope: 'group:{id}'`): redemption adds redeemer to the group's member list.
- **Failure modes** (revoked / expired / capped) show a friendly message and offer to keep using the app normally — no hard error, no disruption.
- **Preview content:** group name only. No owner-name, member-count, or other metadata in v1.

### Pending/approval gating

**Post-MVP.** Schema includes a `pendingApproval` slot on the member record, but MVP code always auto-accepts on link redemption. Future: admins can configure a group to require owner/admin approval before joiners are admitted.

---

## Join flows

### Existing user via group-invite link

1. Tap link → app opens with the token in the URL query string.
2. App boots → finds a v2 identity in localStorage → user is logged in.
3. Token validated.
4. **Auto-join silently.** User lands on the group's context. No confirmation card.

*Confirmation-card-on-existing-user-redemption is post-MVP.*

### Brand-new user via group-invite link — α'

1. Tap link → app opens. No identity in localStorage.
2. **Welcome screen** with explicit framing that separates the secret phrase from the group join:
   ```
   [KnockKnock glyph]
   You've been invited to join 'Family'.
   First, let's set up your account.

   [I'm new]   [I have a secret phrase]
   ```
3. Tap `I'm new` → standard secret-phrase modal (unchanged from current behavior — no group framing inside the modal).
4. After "I've saved it" → new step: **"Your name in 'Family'"** with a text input and Continue button.
5. Main UI loads with the user in the group context.

### Brand-new user via personal-scope ("follow me") link

Same shape as α', adapted: welcome screen says *"You've been invited to follow Alex."* No display-name step (display names are per-group; the follower-relationship uses today's labeling).

### Existing user via in-app push invite *(Phase 3, Shape X)*

1. **Inviter** taps a follower's card → "Invite to a group" → picks the destination group → invite sent.
2. **Recipient** sees an inline card at the top of her main list: *"Mike invited you to join 'Family'. [Join] [Decline]"*.
3. Card persists until accepted, declined, or revoked. **No TTL** in MVP.
4. **Inviter can revoke** a pending invite at any time.
5. **Multi-device sync** via existing `watchStatus` pattern: accepting/declining on one device clears the card on the user's other devices.
6. **Bulk in-app invites:** post-MVP. Link-based "bulk" (one link, N redemptions) IS MVP.

---

## Bridging: group → 1:1 follow

*(Post-MVP, Phase 4+.)*

A user can request to follow a co-member they don't already follow, using a button on the co-member's card in the group's roster view. Flow:

1. Tap "Request to follow" on Alice's card in `Family`.
2. Alice receives a notification.
3. Alice approves or declines.
4. On approval, a 1:1 follow is created.

**Critically, the follow is independent of group membership.** If Alice leaves `Family`, the follow established this way persists. Group membership and follow relationships are orthogonal.

In MVP, this affordance doesn't exist. Knocks from non-mutual co-members are pure notifications.

---

## Communication primitives in groups

**MVP:** existing 1:1 primitives (knock, call, canvas, palette adoption) stay mutuals-only. Group membership alone does not grant access to them. Each remains gated by its existing flag (`KNOCK_ENABLED`, `CALL_ENABLED`, `PALETTES_ENABLED`).

**Post-MVP relaxation** (no new flag): the eligibility check for 1:1 primitives widens to *"mutual OR co-member in any group."* The same existing flags continue to gate the features themselves.

**Exception in MVP: knock-via-group-context** ships in Phase 1. See next section.

**Not on roadmap:** group calls, multi-party canvas, group knock broadcasts ("@channel"), direct messaging within groups. Groups are about ambient presence; 1:1 communication continues to be the rich path between any two people.

---

## Knock-via-group-context

A non-mutual co-member can send a knock. Treated as a pure notification — no follow-back implied (request-to-follow is a separate post-MVP affordance).

### Behavior

- X (in `Family`) taps Y's card → Knock → knock recorded.
- If Y is currently in `Family` context: pulse animation on Y's card; card **floats to top** of the group view.
- If Y is in another context (Direct or another group): unread-knock badge appears on the `Family` card in Direct's group cards row. When Y next navigates into `Family`, the deferred pulse + float-to-top fire.
- Knocked-by-someone cards anchor at the top of the list for **20 seconds** from the moment Y can see them (i.e., when Y enters the relevant context for deferred knocks, or immediately for live).
- Multiple knocks from the **same person** reset the 20s timer.
- Multiple **different** knockers stack at top, sorted by most-recent-knock. Each has its own 20s anchor window.

### Apply float-to-top to direct contacts too

Today's direct-contacts knock behavior just pulses the knocker's card in its sorted position. With long contact lists or many sections, the knocker can be buried below the fold. The same 20s float-to-top model applies in Direct context, addressing this latent issue.

### Animation timing

- Live knock pulse: 2s box-shadow decay (existing, unchanged).
- Deferred knock pulse: 5s CSS keyframe animation (existing, unchanged).
- Float-to-top anchor window: 20s.

---

## Cross-device sync

All group-related user state syncs across devices using the existing `watchStatus` pattern.

Synced state:

- Group memberships (membership list + role + display name + statusOverride)
- Current context (which group, or `direct`)
- Pending in-app invites (Phase 3)
- Group cards order (derived from currentContext history, most-recently-visited first)

No new sync machinery needed — reuses what's already proven in the recovery-code identity work.

---

## Feature gating

- **New `GROUPS_ENABLED` flag** in `js/features.js`. Gates the entire groups feature.
- **Existing flags** (`PALETTES_ENABLED`, `KNOCK_ENABLED`, `CALL_ENABLED`, `PALETTE_INTERACTIONS_ENABLED`) continue to gate their respective features.
- **No new gates** for sub-features (e.g., no separate "co-member knocks" flag). The post-MVP relaxation that lets co-members use 1:1 primitives without being mutuals is just a widening of the eligibility check inside existing-flag-gated code.

---

## Phasing

### Phase 0 — Invite-link infrastructure (1:1 follow-me)

Standalone feature. Adds the invite-link primitive and the personal-scope use case.

- Invite-link primitive in Firebase (scope discriminator, lifecycle fields)
- Create / revoke / regenerate; TTL; redemption cap
- URL parsing and redemption flow
- Personal-scope redemption: follow created
- New-user onboarding via link (α' framing adapted for "follow Alex")
- Friendly failure messages
- `GROUPS_ENABLED` flag exists but gates only group-scoped behavior; personal links work regardless

*Ships as standalone. Replaces share-code typing with link sharing for the "I want them to follow me" case. Validates the link infrastructure before groups exist.*

### Phase 1 — Groups minimum

- Group entity (id, name, owner, member list, createdAt)
- Owner-only ops: create, rename, delete (with member notification on delete)
- Group-scope invite links (reuses Phase 0 primitive)
- Existing-user link redemption: auto-join silent
- New-user link redemption: α' + display-name step
- Member ops: see roster, edit own display name, leave
- Navigation: group cards row in Direct (with `+` and zero-state CTA), `←  GroupName` breadcrumb in group context
- Persistent context across sessions/devices
- Cross-device sync of group state
- Knock-via-group-context: pulse + float-to-top + group card indicator badge
- Float-to-top behavior applied to direct contacts too
- `GROUPS_ENABLED` gating
- Members all see the user's single (Direct) status — no per-audience overrides yet

*The smallest interesting groups release. Satisfies motivation B fully.*

### Phase 2 — Per-audience status overrides

- "Set a unique group status" toggle per audience (followers + each group)
- Default OFF; ON → audience-specific status, initial value Unavailable
- Header status chip controls the current context's status (Direct or current group)
- Group card visual reflects override color/theme when override is ON
- Group context view shows the override status on the user's own card; member roster shows each member's context-appropriate status

*Satisfies motivation C+A. The "set status per audience" stories light up here.*

### Phase 3 — In-app invites (Shape X)

- Inviter selects a follower → picks a group → sends invite
- Recipient sees inline card at top of main list with Join / Decline
- Inviter can revoke
- Multi-device sync of pending invites

### Phase 4+ — Post-MVP polish

In rough priority order:

- Admin role + permissions (data model already in place from Phase 1)
- Owner ownership transfer
- Group color / palette B/C semantics — owner-configurable between:
  - **B "member uniform":** members appear in the group's color when viewed in that group's context.
  - **C "default palette suggestion":** group's color is just a suggested default for new members; they can override.
- Confirmation card on existing-user link redemption
- Request-to-follow from a non-mutual co-member's card
- Pending/approval moderation gating
- Bulk in-app invites
- Cross-referencing display names
- Co-members can use 1:1 primitives without mutual (gated by existing flags)
- Group name disambiguation UI
- Collapse strategy for >5 groups
- Orphan group reminder for owners
- Group description / avatar / metadata
- "Hide group from nav without leaving"
- Sort/search affordances for large member lists (>100)
- "Live members here right now" indicator
- Notifications on admin actions (rename, color change, kick)
- Push notifications via service worker

---

## MVP scope

**MVP = Phases 0 + 1 + 2.** Ships:

- Invite-link primitive (Phase 0)
- 1:1 follow-me links (Phase 0)
- Groups MVP — entity, owner-only ops, invites, members, navigation (Phase 1)
- Knock-via-group-context with float-to-top (Phase 1)
- Per-audience status overrides (Phase 2)

**Rationale:** motivation B is fulfilled by Phase 1 alone, but motivation C+A requires Phase 2. Without Phase 2, groups feel like "shared followers" without the contextual differentiation that's half the reason to want them. Including Phase 2 in MVP delivers both motivations together.

**Phase 3** (in-app invites) and **Phase 4+** ship subsequently.

---

## Deferred / out of scope

The full list of things explicitly deferred during the brainstorm:

- Owner ownership transfer
- Admin role (data model leaves space; UI/code post-MVP)
- Group color B/C semantics (owner-configurable, post-MVP)
- Confirmation card on existing-user link redemption
- Request-to-follow from a co-member's card
- Pending/approval moderation gating
- Bulk in-app invites
- Cross-referencing display names
- Co-members 1:1 primitives without mutual (existing-flag-gated)
- Group name disambiguation UI
- Collapse strategy beyond 5 groups
- Orphan group reminder
- Group description / avatar / metadata
- Group calls, multi-party canvas, group knock broadcast, group DMs
- Read receipts on knocks
- "Hide group from nav without leaving"
- Sort/search for large member lists

---

## Implementation considerations (not designed; for the implementation plan)

- Group ID generation: random with transactional claim, same pattern as share codes
- Invite token format: URL-safe random string, high entropy
- Firebase RTDB rules tightening for groups, members, invites — coordinate with the Phase B identity work (auth.uid rules)
- Performance of large groups (>100 members): defer optimization until needed
- The existing canvas / call / knock code paths are unchanged in MVP — groups don't refactor them
