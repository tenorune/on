# Groups — Design Specification

*Date: 2026-05-25 (rev 2)*

## 1. Background

### What KnockKnock is today

KnockKnock is a small Progressive Web App for sharing **ambient presence** — i.e., a binary "available" or "unavailable" status, optionally with a time-to-expire ("available for 2 hours"). The app's vocabulary:

- **Share code** — a 6-character alphanumeric identifier (e.g., `XK7P2M`) that uniquely identifies a user. It's how people add each other.
- **Follow** — a one-way relationship. If Alice has Bob's share code, Alice can add Bob; Alice now sees Bob's status. Bob is unaware unless he also adds Alice.
- **Mutual** — when two users both follow each other. Mutuals are the only users who can use 1:1 communication primitives:
  - **Knock** — sending a short notification ping to a specific mutual.
  - **Call** — initiating a direct interactive session with a mutual (swipe-right gesture on their card).
  - **Canvas** — a shared drawing surface available during a call.
  - **Palette adoption** — long-pressing a mutual's card to "adopt" their current color/palette as your own status appearance.
- **Status color** — a hex color associated with a user's "available" state. Users pick this from a palette grid.
- **Palette** — a curated set of available colors organized into themes (Forest, Ocean, Iris, etc.) that also dictate the UI's overall theme variables (`--bg`, `--surface`, `--text`, etc.) when active.

The current app's main UI is a single screen showing the user's own status header at the top, followed by a list of their direct contacts organized into three sections: Mutuals (people who follow you back), Following (people you follow who don't follow back), and Followers (people who follow you, whom you don't follow yet).

### What this design proposes

A new concept: **groups**. A group is a named collection of users with an owner. Members of a group can see each other's statuses (a richer presence experience) without needing to exchange share codes one-by-one. The design also introduces **multi-status semantics**: a user can present a different status to different audiences (different groups, or their followers).

This document is the design specification for that feature. The implementation has not started; this file is a planning artifact only. An implementation plan should be derived from this spec via the project's `writing-plans` skill.

## 2. Motivation

Three underlying problems drive the design:

### Motivation B — Scaling

Today, if you want 10 people in a club to follow you, you must exchange 10 share codes one-by-one. With a group, you generate one invite link, share it with the club, and all 10 members redeem it. The setup cost drops from quadratic (in number of mutual relationships) to linear (one invite per new joiner). This is the headline motivation for groups in social-presence apps: replacing N×N share-code exchanges with one-to-many invitation links.

### Motivation C+A — Contextual status

Today, every follower of a user sees the same status. If a user goes "available for 2 hours" on a weekend morning, both their family and their work colleagues see the same thing. That's often not what the user wants.

The two facets of this problem:

- **C (contextual identity):** the user may want to appear as "Mike" to family and "Mr. Gomez" to a work group, with possibly different colors per context. Their *identity presentation* should vary by context.
- **A (audience scoping):** the user may want to be "available to family for 2 hours" but show as "unavailable to work-chat." Their *status content* should vary by audience.

Together, C+A means: groups aren't just about scaling — they're about expressing yourself differently to different parts of your network.

### Motivation D — Onboarding via link

A related but separable benefit: a brand-new user who's never heard of the app can be brought in by *tapping a link*. They land on the app, set up an account, and join the group as part of the same flow. This is significantly lower-friction than "find this app, install it, exchange a code with me." It's a delivery mechanism, not a problem in itself, but it shapes some design decisions (especially the join-flow).

## 3. Vocabulary

These terms recur throughout the doc and are precise — please use them consistently:

- **Group** — a named entity with an owner and members. Group members can see each other's statuses (when not overridden by the seer's per-group settings).
- **Owner** — the user who created the group. Has the most powers. Single per group.
- **Admin** — a member with elevated permissions, granted by the owner. Multiple per group allowed. *Post-MVP role.*
- **Member** — a regular member with no special permissions. Can see the roster, set their own status, leave.
- **Audience** — a logical recipient of a user's status. Each user has one **followers** audience (their direct followers) plus one audience per group they're a member of. With 4 groups, a user has 5 audiences total.
- **Direct contacts context** (often shortened to "Direct") — the existing app's main view: your direct followers/following/mutuals. The "home" context.
- **Group context** — a separate view focused on one specific group. Shows that group's members and a status header for that group's audience.
- **Current context** — at any moment, the user is in exactly one context (Direct or a specific group). The app's UI reflects whichever context is current.
- **Primary status** — the status a user has chosen for their Direct context. Also serves as the broadcast default to any group whose override toggle is off.
- **Override** — when a user has explicitly opted to give a specific audience (group or followers) a status different from their primary. Controlled per-audience by a "Set a unique status" toggle.
- **Invite link** — a URL with a redemption token that, when tapped, performs an action (follow the link's creator, or join the link's group). Has lifecycle: TTL, redemption cap, revocation, regeneration.
- **Personal-scope invite** — an invite link whose redemption action is "follow the creator." A user has **at most one active personal-scope invite** at a time.
- **Group-scope invite** — an invite link whose redemption action is "join the link's group." A user has **at most one active group-scope invite per group they administer** at a time.
- **Creator label** — a name (free text) chosen by the creator of a personal-scope invite, shown to the redeemer as the human-readable identifier of who they're being invited to follow. Stored on the invite record itself.
- **Knock-via-group-context** — when a non-mutual group co-member sends a knock to another member.
- **Invite index** — the global `inviteIndex/{token}` lookup table that maps an invite token to the path of the invite record it belongs to. The mechanism by which a redeemer with only a URL token can find the invite to redeem.

## 4. Status model

The defining feature of multi-status presence. This section walks through the model in detail.

### Foundational decisions

1. **A user's primary status is the status they have in Direct context.** This is conceptually the same as today's single status. The user goes available for, say, 2 hours, and the app stores `status: 'available', availableUntil: now + 2h`. This is the **broadcast source** — the default that propagates everywhere unless explicitly overridden.

2. **Each audience has a "Set a unique status" toggle.** This toggle controls whether the audience sees the primary status (toggle OFF) or its own dedicated status (toggle ON). Each group is one audience; the followers audience is another. Toggles are independent per audience.

3. **Toggle default state: OFF.** When a user joins a new group, that group's toggle is OFF by default. The group sees the user's primary status. This satisfies Motivation B with no extra setup — the user shares one status to all members automatically.

4. **When the toggle is flipped ON, the initial value is "Unavailable."** Turning on the toggle is a deliberate action. The user has decided this audience should see something different. The safe default is to hide their availability — i.e., appear as Unavailable — until they explicitly go available in that audience's context.

### Concrete examples

**Example 1: a brand-new group member, single status across everyone.**

Alice joins the Skydivers group. Skydivers has 20 members. Alice's Skydivers override toggle is OFF (default). Alice goes available for 4 hours in her Direct context.

- All Skydivers members see Alice as "Available for ~4h" (in her primary status color).
- All Alice's direct followers also see her as "Available for ~4h."

Alice did one action; 20 people in Skydivers plus her followers all see her status. This is Motivation B in action.

**Example 2: Alice wants to be available to family for the day but invisible at work.**

Alice is in two groups: Family and Work-Chat. She:

1. Goes to Direct context.
2. Goes available for 8 hours. (Primary status set.)
3. Navigates to Work-Chat group context.
4. Turns ON the "Set a unique status" toggle for Work-Chat. Status defaults to Unavailable.
5. Leaves the Work-Chat override at Unavailable.

Now:

- Direct followers see Alice "Available for 8h."
- Family group members see Alice "Available for 8h" (Family's toggle is OFF, inherits primary).
- Work-Chat group members see Alice "Unavailable."

If Alice later wants to go available in Work-Chat with a different duration, she navigates to Work-Chat and goes available there — independent of her Direct status. This is Motivation C+A in action.

**Example 3: per-audience customization is symmetric.**

The followers audience itself has the same toggle. So Alice could choose to override followers (turn ON the followers toggle) and let groups inherit the primary status — though this is unusual.

### Mental model

A user has one or more **audiences** (followers + each group they're in). Each audience has its own status state that can be either inherited from the primary or independent (override). The primary is the user's status in Direct context — there's no separate "default" floating above the audiences. The Direct status is the broadcast.

### Status display in views

- **In Direct context:** the header shows the user's primary status; the audience for that status is the user's direct followers.
- **In a group context:** the header shows that group's status — i.e., the user's override for that group (if toggle ON) or the primary status (if toggle OFF, inherited from Direct).
- **Group members' statuses (what other members look like):** each member's card in the group's roster shows that member's status *for this group's audience* — i.e., their group override if ON, otherwise their primary. Override data lives on the member's record under the group (see §7), so reading another member's group-scoped status doesn't require reading their user record.

### Status durations and the time chip

The time chip in the header controls how long the user is "available for." When the user is in Direct context, the time chip controls the primary status's duration. When in a group context with the override ON, the time chip controls the override's duration. The time chip's selected value also syncs across devices (using the existing time-chip sync infrastructure).

## 5. Identity model (display names)

### Per-group display name

Each user has a **display name** for each group they're in. Set at join time. Editable later from within the group's context.

This is distinct from the user's share code (which doesn't change between contexts) and from the per-follower labels (which the *follower* sets for themselves to label *the user*).

For instance: a user might be `XK7P2M` (share code, immutable for them), labeled by their friend Alice as "Mike" (Alice's label, visible only to Alice), and have a display name "M.P." in the Skydivers group (the user's own choice, visible to all Skydivers members).

### Validation

A group display name is validated the same way as the existing follow-label inputs (`add-label-input`, rename input on a follower card):

- **Trimmed** (leading/trailing whitespace removed) on save.
- **Non-empty after trim.**
- **Max 40 characters** (`maxlength="40"` on the input element).
- No character-class restriction beyond what the input element accepts.

### No cross-context leakage in MVP

A user's per-group display names are scoped to their respective groups. A follower of the user who is *not* in the user's Family group never sees the user's Family display name. The follower sees whatever label they set themselves for that user, plus the user's share code; nothing else.

### Cross-referencing (post-MVP)

A future enhancement could let users opt to cross-reference their identities (e.g., "let my followers also see my Family display name"). This is intentionally not in scope for MVP — it crosses the privacy line in a way that needs more thought.

## 6. Navigation

The user has potentially many contexts (Direct + N groups). The app must support moving between them.

### Choice: each context is a "place," not a "tab"

The user is in *exactly one* context at a time, and the entire UI (header, status chip, main list, footer affordances) reflects that current context. Switching contexts is an explicit action that re-orients the entire view, not a tab-flip that changes a sub-section.

This deliberately rejects a tab-bar UI where all contexts are constantly visible at the top of the screen. The reason: with persistent context (see below), a user who's focused on a group for an extended period shouldn't have to look at their direct contacts list in the background. Each context is its own "place" — visiting one means leaving the others.

### Persistent context across sessions and devices

The user's currently-active context is **stored as user state and synced across devices.** If the user is in the Family group when they close the app on their phone, opening the app on their laptop ten minutes later puts them in Family. Closing and reopening their phone next week — still in Family.

This is implemented as a `currentContext` field on the user's record in Firebase, synced via the existing `watchStatus` subscription pattern (the same mechanism that syncs status color, palette, etc.).

A brand-new user defaults to Direct context (no group history exists yet). If a user is removed from a group while their app is closed, on next launch the saved context is invalid → app falls back to Direct.

### Entry points: from Direct to a group

The Direct context has a thin row of **group cards** at the top, above the existing Mutuals/Following/Followers sections. Each card is a small visual element with:

- The group's name (small, single line).
- Any pending indicators (e.g., an unread-knock count badge — see §13).
- A color/theme that reflects the user's status for that group:
  - If the override toggle is ON for this group, the card shows the override's color (so the user can see their per-group persona at a glance).
  - If the toggle is OFF, the card shows a neutral surface color (consistent with the rest of Direct context).

Tapping a card navigates the user into that group's context.

After the last group card, an affordance to **create a new group**:

- Default state: a small `+` button.
- Zero state (user has no groups yet): the `+` expands to a full-width *"Create your first group"* call-to-action.

### Entry point: from a group to Direct

A group context has a thin breadcrumb bar at the very top of the view, above the existing header. The breadcrumb shows only an arrow and the group's name:

```
←  Family
```

Tapping the arrow returns the user to Direct context. The group's name is displayed for orientation but is not tappable.

The word "Direct" intentionally does not appear in the breadcrumb. The arrow alone is sufficient; the home concept is implicit.

### Cross-group navigation

To switch from `Family` to `Skydivers`, the user taps the arrow back to Direct, then taps the Skydivers group card. **Two taps for group-to-group**, one tap for group-to-Direct. This is a deliberate choice — direct cross-group jumps would have required a more complex UI element (a context switcher), and the two-tap path puts the user "home" briefly, which preserves the home-vs-place mental model.

### Group cards order

The user's group cards are ordered by **most-recently-visited first.** To support this, the user's per-group enumeration record (see §7) carries an optional `lastVisited` timestamp. When the user navigates into a group context, the app writes `lastVisited: now` to their `users/{uid}/groups/{groupId}` record. The cards row sorts by that field, descending.

Groups the user has never visited (e.g., just joined on another device and not yet visited on this device) fall back to ordering by `joinedAt` (read from the group-side member record).

### Collapse strategy for many groups

If the user is in more than 5 groups, the horizontal row of cards may stretch beyond the viewport. **Not handled in MVP** — the row just stretches; horizontal scrolling may be implicit if the cards overflow. Post-MVP candidate strategies:

- Horizontal scroll on touch
- Collapse to a single "Groups (N)" pill that opens an expanded list on tap
- A pinned-vs-overflow split with the user choosing which groups appear pinned

## 7. Data model

This section is the canonical schema. Where a previous draft of this spec mirrored fields between group-side and user-side records, this revision **consolidates the canonical data to a single location** and reduces the user-side record to an enumeration index. The motivation is to avoid the dual-write coordination problem and to remove a forward-compatibility blocker for the Phase B identity work (tightened `auth.uid` rules).

### Storage layout

```
groups/{groupId}:
  name: string                       // free text, trim, max 40 chars, NOT unique
  ownerId: userId
  createdAt: timestamp               // stored, not shown in MVP UI
  color?: string                     // post-MVP, owner-configurable
  paletteKey?: string                // post-MVP, owner-configurable
  members/{memberUid}:
    role: 'owner' | 'admin' | 'member'   // MVP only uses 'owner' and 'member'
    displayName: string                   // user's name in this group
    joinedAt: timestamp
    statusOverride?: {
      enabled: boolean                    // the "Set a unique status" toggle
      status?: 'available' | 'unavailable'
      availableUntil?: timestamp
      statusColor?: string                // optional, override of primary color
      paletteKey?: string                 // optional
    }
    pendingApproval?: boolean             // reserved for post-MVP gating
  invites/{inviteId}:
    scope: 'group'
    token: string                       // unguessable URL-safe random
    creatorUid: userId                  // owner or admin who made it
    createdAt: timestamp
    expiresAt: timestamp | null         // null = no expiry
    redemptionCap: number | null        // null = unlimited; 1 = single-use
    redemptionsUsed: number
    revoked: boolean

users/{uid}:
  // existing fields ...
  groups/{groupId}:                       // enumeration index only
    lastVisited?: timestamp               // for group cards ordering
  currentContext: 'direct' | 'group:{groupId}'
  invites/{inviteId}:                     // personal-scope invites created by this user
    scope: 'personal'
    token: string
    creatorLabel: string                  // name shown to redeemers ("follow {creatorLabel}")
    createdAt: timestamp
    expiresAt: timestamp | null
    redemptionCap: number | null
    redemptionsUsed: number
    revoked: boolean

inviteIndex/{token}:                      // global lookup: token → invite record
  scope: 'personal' | 'group'
  ownerPath: string                       // e.g., "users/<uid>/invites/<inviteId>"
                                          // or   "groups/<groupId>/invites/<inviteId>"

groupIdIndex/{groupId}: true              // existence lock for transactional ID allocation
                                          // (same pattern as the existing codeIndex)

pendingInvites/{inviteeUid}/{groupId}:   // Phase 3 in-app push invites; see §10 Flow C
  from: userId                            // the inviter (owner)
  ts: timestamp
                                          // Keyed by groupId (not a random
                                          // inviteId) so re-inviting the same
                                          // person to the same group is a
                                          // natural overwrite — no duplicate
                                          // entries, no race window between
                                          // read-check and write.
```

### Why the canonical-location consolidation

The previous draft of this spec stored `role` and `displayName` at *both* `groups/{groupId}/members/{memberUid}/...` and `users/{uid}/groups/{groupId}/...`. That created three problems:

1. **Dual-write coordination.** Edits to a display name or a role would need to atomically update two paths. Firebase RTDB supports multi-path updates, but the coordination logic is error-prone (especially across kick/leave/promote paths) and easy to leave inconsistent if a write partially fails.
2. **Phase B forward-compatibility friction.** Under a tightened rules model where only the owner of `users/$userId` can write to it, certain operations (e.g., the owner-kicks-a-member flow writing to the member's user-side record) become impossible without a Cloud Function. The honor-system MVP would work; the eventual Phase B port would force a backend service into a feature that doesn't otherwise need one.
3. **Read-side cost is not actually saved.** The roster view already needs to subscribe to `groups/{groupId}/members/`. The user-side mirror would have been a second source of the same data, with no read-path that prefers it.

By making `groups/{groupId}/members/{memberUid}/...` the single source of truth for membership facts (role, displayName, joinedAt, statusOverride) and reducing the user-side record to a thin enumeration index, the model:

- Has one writer per piece of data (the member writes their own member record).
- Stays writable under Phase B rules: `groups/{groupId}/members/{memberUid}/...` is writable when `auth.uid === $memberUid` for self-edits; owner/admin writes (kick, promote) use a separate rule path.
- Costs one extra read at group-cards-row-render time (read `groups/{groupId}/name` per group), which is bounded by the number of groups the user is in and not a roster-size problem.

### Group ID format

8-character alphanumeric random (uppercase letters + digits). Generated transactionally: a new ID is reserved in `groupIdIndex/{groupId}` via a transaction, and on collision the generator retries. Same pattern used today for share codes (`codeIndex`).

### Group names

Free text up to 40 characters (validated like display names — trim, non-empty, max 40). Names are **not unique** — two different owners can each create a group called "Family." This is deliberate: users typically name their groups after social roles ("Family", "Work", "Book Club") that are common in their respective contexts.

A user could potentially be a member of multiple groups with the same name. The MVP does not address this disambiguation in the UI; both groups appear in the group cards row with identical labels. Future work could add per-user aliases or owner-name suffixes.

### Invite index

A global `inviteIndex/{token}` table maps every active invite's token to the path of the invite record it belongs to. This is the lookup mechanism for redemption: a redeemer arrives with only `?i={token}` in the URL and must find the invite to validate.

- **Allocation.** Invite creation transactionally allocates the token in `inviteIndex/{token}` with the `ownerPath`. On collision (vanishingly rare for 128-bit tokens), retry with a new token. Same pattern as `groupIdIndex` and `codeIndex`.
- **Resolution.** Redemption reads `inviteIndex/{token}` → gets `ownerPath` → reads the invite record at that path → validates it.
- **Cleanup.** When an invite is revoked, the `inviteIndex` entry is removed (so a revoked token returns a quick "not found" rather than reading the revoked record). When an invite expires by TTL, the entry remains until a cleanup pass removes it; redemption-time validation will still catch the expiry. (Periodic cleanup is post-MVP; orphans are harmless in the meantime.)
- **Why a separate index instead of putting all invites at a top-level path:** invite records carry creator/group context that's most natural to read alongside their owning entity (e.g., the group's owner viewing their own group's invites). The index is a cheap pointer table that adds one read at redemption time without restructuring the natural ownership hierarchy.

### Open / closed state

The user stories mention "Open or close a group to new members." In the MVP, this state is **derived**, not stored separately: a group is effectively "open" when at least one valid (non-revoked, non-expired, non-exhausted) invite link exists *and* at least one member has permission to use it. When all invite links are revoked/expired/exhausted *and* no member has invite permission, the group is effectively closed.

This means owners don't need an explicit "lock the group" toggle in MVP. To stop new joins, they revoke their invite links. Post-MVP, an explicit "closed" flag could be added if a clearer UX is needed.

## 8. Roles & permissions

### Three roles

| Role | Powers |
|---|---|
| **Owner** | Everything. Rename the group, delete it, set color/palette (post-MVP), promote/demote admins (post-MVP), create/revoke/regenerate invite links, send in-app invites, kick members. |
| **Admin** *(post-MVP)* | Create/revoke/regenerate invite links, send in-app invites, kick members, set color/palette (subset of owner powers, exact subset configurable post-MVP). |
| **Member** | See the roster, set their own status (including per-group override), edit their own display name, leave the group. |

### MVP constraints on roles

- Single owner per group. The owner is the user who created it.
- **Owner ownership transfer is post-MVP.** In MVP, once you're an owner, you remain the owner. You cannot leave the group while you're its owner — to leave, the group must be deleted first.
- **Admins are post-MVP.** The data model supports the admin role, but in MVP only owner and member exist functionally. The role field in member records can store 'admin', but no MVP code path reads or writes that value.

### Orphan groups

If an owner abandons their account (loses their secret phrase, clears localStorage, never returns), their group becomes effectively orphaned: no one can rename, delete, or manage it. In MVP, **orphan groups remain functional indefinitely** — members continue to use the group as a presence-sharing surface. They just lack the ability to administer it.

Post-MVP: a reminder mechanism could prompt owners to designate an admin or successor — to be designed once admins exist.

### Promotion / demotion of admins (post-MVP)

When admins exist, only the owner can promote a member to admin or demote an admin back to member. Admins cannot promote other admins. (This deliberately limits the proliferation of admin status.)

## 9. Invite system

The invite system is **one primitive with a scope discriminator.** A single "invite link" entity supports both 1:1 follow-me invitations and group-join invitations; the difference is the action performed at redemption. The two scopes also **share a single modal UI pattern** — see §9.4.

### 9.1 Invite-link record

Stored under `users/{uid}/invites/{inviteId}` for personal-scope, and under `groups/{groupId}/invites/{inviteId}` for group-scope. Different paths, same general shape; personal-scope has an additional `creatorLabel`. (See §7 for the canonical schema.)

The token in each record is also registered in `inviteIndex/{token} → { scope, ownerPath }`, which is what the redeemer's URL lookup hits.

### 9.2 Lifecycle operations

All operations apply to both scopes uniformly, with one constraint difference (§9.3):

- **Create.** A link is generated with optional cap (default unlimited), optional TTL (default no expiry). Token is a fresh URL-safe random string, transactionally allocated in `inviteIndex/{token}`. Resulting URL: `https://[hosting-domain]/?i={token}`.
- **Copy.** Copy the URL to the clipboard (existing clipboard helper).
- **Revoke.** Sets `revoked: true` on the record and removes the `inviteIndex/{token}` entry. The URL still resolves as a request, but the lookup returns "not found" and the redeemer sees a friendly error.
- **Regenerate.** Atomic: revoke the current link (including removal from `inviteIndex`), generate a fresh token, allocate it in `inviteIndex`, write the new record with reset `redemptionsUsed: 0`. The previous URL stops working immediately.

### 9.3 One-active-invite constraint

To keep the UX simple and avoid invite-link sprawl, MVP enforces:

- **At most one active personal-scope invite per user.** A user has either zero or one personal invite at a time. "Active" means not revoked. (Expired/capped invites also count as active until revoked or regenerated — the UI still shows them so the user can revoke or regenerate.)
- **At most one active group-scope invite per (creator, group) pair.** Each member who can create invites (owner in MVP; admin post-MVP) has at most one invite per group they administer. Multiple admins can each have their own one.

When the create button is invoked while an active invite already exists, the modal shows the existing invite instead of creating a new one. To replace it, the user uses **regenerate**, which is a single explicit operation (one tap, no confirmation needed in MVP — the act of regenerating is its own confirmation that the old link should die).

### 9.4 Modal pattern (shared by personal-scope and group-scope)

A **single modal component** handles invite-link management for both scopes. Internally it adapts to whether an active invite exists; from the user's perspective there is one modal with one set of always-present sections that fill in differently based on state.

**Modal layout (group scope, both states):**

```
   [ Title: "Invite to {group name}" ]

   [ Section 1 — Link ]
     If no active invite:
       [ Create invite link ]
     If active invite:
       https://knockknock.app/?i={token}
       [ Copy ]   [ Regenerate ]   [ Revoke ]
       ( Optional metadata: "Used N times" / "Expires {date}" — MVP minimal )

   [ Section 2 — In-app invites (Phase 3, group scope only) ]
     "Invite specific people directly into the group."
     [ Invite ]   ← sends to all currently selected
     ┌─────────────────────────────────────────────────┐
     │ Scrollable list, mutuals first, then non-mutual │
     │ followers. Each row: avatar dot + label-or-code │
     │ + selection-state indicator. Tap to toggle.     │
     │ Rows already in the group are excluded.         │
     │ Rows with pending invite show an "Invited" pill │
     │ in place of the selection indicator; tap "Invited"
     │ to un-invite (revokes the pending record).      │
     └─────────────────────────────────────────────────┘
```

**Modal layout (personal scope, both states):**

```
   [ Title: "Your invite link" ]

   [ Section 1 — Link ]
     If no active invite:
       [ Creator label input ]   ( e.g., "Mike P." )
       [ Create invite link ]
     If active invite:
       https://knockknock.app/?i={token}
       [ Copy ]   [ Regenerate ]   [ Revoke ]

   ( No Section 2. Personal scope has no in-app push-invite affordance;
     bridging to a 1:1 follow is post-MVP, see §11. )
```

**Dismiss.** Both modals dismiss by tapping outside the card (the overlay area). No Cancel / Close button. This is consistent with the rest of the app's modal UX and removes the bottom-of-modal action ambiguity.

**Scope-specific differences (small):**

| Aspect | Personal scope | Group scope |
|---|---|---|
| Modal title | "Your invite link" | "Invite to {group name}" |
| Creator label field | Shown when no active invite; editable later via regenerate | Not shown (group name carries the context) |
| Subtitle text | "People who tap this link will follow you." | "People who tap this link will join {group name}." |
| Section 2 (in-app picker) | Not present | Present in both link states; see §10 Flow C |
| Entry points | Code drawer (see §9.5) | Group settings "Invite" + roster "+ Invite to group" row (see §9.6 + §10 Flow C) |

Implementers should build one component parameterized by scope, not two near-duplicates.

**Creator label editing.** For personal-scope invites, the label is set at creation and re-editable by regenerating the link (which is the only point at which the existing creator label is replaced). The label field is *not* an inline editor in the manage view; changing it is intentionally tied to regeneration, since a label change is essentially a different invite from the redeemer's perspective. MVP keeps this simple; post-MVP could allow in-place edit.

### 9.5 Phase 0 entry point — personal-scope invite

The personal-scope invite is reachable from the **code drawer**, just below the existing share-code Copy button. New row:

```
   Your share code:  XK7P2M  [ Copy ]
   Your invite link:           [ Create invite link ]   ← when no active invite
                               [ View invite link ]     ← when an active invite exists
```

Tapping the Create / View button opens the modal in State A or State B respectively.

The drawer's existing "Show recovery code" pill (from the recovery-code work) sits above or below this row — exact ordering to be settled in implementation, but the recovery-code pill stays a distinct row.

### 9.6 Phase 1 entry point — group-scope invite

The group-scope invite is reachable from a **group settings affordance** within a group context. The exact affordance (gear icon? long-press on the breadcrumb? "Settings" link in the group context's header area?) is an implementation detail. What matters for this design: only the owner (and post-MVP, admins) sees it, and tapping it opens the same modal pattern parameterized for group scope.

### 9.7 Redemption flow

When a user taps an invite URL, the app extracts `i={token}` from the URL query string and validates it via `inviteIndex`:

1. `inviteIndex/{token}` exists? If not → friendly error ("This invite link isn't valid").
2. Read `ownerPath` → load the invite record at that path.
3. `revoked === true`? If so → friendly error ("This invite link has been revoked"). (Should be rare in practice because revoke also removes the index entry; but a record could exist in a not-yet-cleaned-up state.)
4. Past `expiresAt`? If so → friendly error ("This invite link has expired").
5. `redemptionsUsed >= redemptionCap`? If so → friendly error ("This invite link is no longer accepting new joiners").
6. All checks pass → perform the scope-specific action (§9.8).

### 9.8 Scope-specific redemption

**Personal scope (`scope: 'personal'`):** create a follow relationship from the redeemer to the invite's owner (the user whose `users/{uid}/invites/{inviteId}` this is). Increment `redemptionsUsed`. The follow is independent of any group; the link's role ends there.

**Group scope (`scope: 'group'`):** add the redeemer to the group's member list with default role `member` and the display name they provided (Flow B step 8 for new users; for existing users, the display name comes from a brief in-line prompt — see §10 Flow A note). Increment `redemptionsUsed`. Write the user-side enumeration entry at `users/{redeemerUid}/groups/{groupId}`.

### 9.9 Failure UX

On any failure, the redeemer sees a small overlay with text appropriate to the failure mode and a single **Continue** button. Tapping Continue dismisses the overlay. The user is then returned to:

- Their **current context** (Direct or whichever group they were in) if they have an existing v2 identity.
- The **welcome screen** if they're a brand-new user with no identity yet.

Notably: an existing user who taps a busted group invite *while inside another group context* is returned to that other group context, not bounced to Direct.

### 9.10 Preview content

When a user is about to redeem a link (or when they're shown the welcome screen for a brand-new user redeeming a group-scope link), the only metadata surfaced is:

- For group-scope: the group's **name**.
- For personal-scope: the inviter's **creator label** (the value of the `creatorLabel` field on the invite record).

No owner name, no member count, no description, no share code. This intentionally minimal preview prevents leaking metadata to potentially-malicious link recipients.

### 9.11 Pending/approval gating (post-MVP)

The schema's `pendingApproval` field on member records is reserved for a future feature: owners (or admins) could configure a group to require manual approval before new joiners are admitted. The flow would be:

1. Redeemer taps link → token validated → instead of joining immediately, the redeemer is added to the member list with `pendingApproval: true`.
2. Redeemer sees "Your request to join 'Family' is awaiting approval."
3. Owners and admins see pending requests in the group's settings, with Approve / Reject actions.
4. On Approve → `pendingApproval` removed; user is fully in. On Reject → user is removed from the member list.

This is **not in MVP**. MVP redemption always auto-accepts. The field exists in the schema so the feature can be added later without a data migration.

## 10. Join flows

Each flow is described step-by-step, with the user-visible behavior at each point.

### Flow A: existing user redeeming a group-scope invite link

1. User taps invite link in a chat / email / etc.
2. Their device's browser opens the app's URL with `?i={token}`.
3. App boots. Detects v2 identity in localStorage. User is logged in.
4. App detects the invite token in the URL before fully rendering the main UI.
5. Token is validated against `inviteIndex` and the invite record.
6. The redeemer is asked for a display name via a small inline prompt: *"Your name in '{group name}'"* — a single text input with Continue. The input uses the same validation as add/rename labels (trim, non-empty, max 40).
7. On Continue: the redeemer is added to the group as a member with the provided display name. `users/{uid}/groups/{groupId}` is written. `currentContext` is updated to `group:{groupId}`. They land directly in the group's context.
8. No further confirmation card, no toast, no banner. The user is in the group; the UI reflects it.

**Why a name-prompt step for existing users (vs. silent join):** earlier revisions of this spec had existing-user join be fully silent. Display names are MVP-mandatory and per-group (§5), so the join has to capture one. Putting it on the join path keeps the user from landing in a group where they're displayed as their share code or as nothing. The prompt is one input, one button, designed to take 3-5 seconds.

**Confirmation-card-on-existing-user-redemption** (a "Join '{group}'?" affordance before the name prompt) is a separate post-MVP enhancement.

### Flow B: brand-new user redeeming a group-scope invite link

1. User taps invite link.
2. Browser opens app URL with `?i={token}`.
3. App boots. No identity in localStorage. Token is detected.
4. **Welcome screen appears with explicit framing** to prevent the user from conflating the upcoming secret-phrase setup with the group itself:

   ```
   [KnockKnock glyph]
   You've been invited to join 'Family'.
   First, let's set up your account.

   [I'm new]   [I have a secret phrase]
   ```

5. User taps `I'm new`.
6. **Secret-phrase modal appears (unchanged from the v2 identity flow).** Generates a 4-word phrase, lets the user rotate it, copy it, save it. The phrase is the user's *personal* credential — it's not in any way tied to the group. The modal's text doesn't mention the group at all. (This is critical: making the secret phrase feel group-scoped would be a serious UX confusion.)
7. User taps `I've saved it`.
8. **A new step appears: "Your name in 'Family'."** Single text input plus a Continue button. Validation: trim, non-empty, max 40 (same as add-label / rename inputs).
9. User taps Continue.
10. The full account-creation sequence completes (secret phrase derived → userId → share code claimed → user added to the group with the provided display name → `users/{uid}/groups/{groupId}` written → `currentContext` set to `group:{groupId}`).
11. Main UI loads with the user in the Family group context.

**Variation: tapping a personal-scope ("follow me") link as a brand-new user.** Same shape as the group flow, with the welcome screen adapted to read *"You've been invited to follow {creatorLabel}"* (substituting the value from the invite record's `creatorLabel` field). No display-name step (display names are per-group; personal follows use the existing label-by-the-follower model). After account creation, the redeemer is following the link's creator and lands in Direct context.

### Flow C: existing user accepting an in-app push invite (Phase 3)

This flow exists when an owner explicitly invites someone who follows them into a group — not via a link, but as a directed in-app invitation. MVP is **owner-only**; admin-issued invites are post-MVP (the role itself is post-MVP).

The pending invite is stored at the top-level path `pendingInvites/{inviteeUid}/{groupId}` rather than under the invitee's user record. This is the **forward-compatible** location: under tightened Phase B rules, the inviter cannot write to the invitee's `users/{uid}/...` record, but the top-level mailbox can be expressed in security rules with no Cloud Function required (any authenticated user may write an invite with their own uid as `from`; only the invitee may read or delete from their own mailbox). The `{groupId}` key (not a random `inviteId`) makes resending naturally idempotent.

#### Inviter side

**Two entry points, both opening the same invite modal:**

1. **Group settings → "Invite"** — the existing "Invite link" menu item is renamed "Invite" and opens the invite modal. The modal title becomes "Invite to {group name}."
2. **Group roster → "+ Invite to group" row** — a new affordance pinned at the top of every group's roster, styled the same as Direct's "Add a person" button. Tapping it opens the same invite modal.

**The unified invite modal** (described in §9.4) shows:

- The link section (create OR show + copy / regenerate / revoke).
- The **in-app picker section** below:
  - Brief framing text: *"Invite specific people directly into the group."*
  - An **Invite** button that sends to all currently selected rows.
  - A scrollable list:
    - **Mutuals first**, displayed by the inviter's local label for them.
    - **Then non-mutual followers**, displayed by their share code (mirrors what the inviter sees in Direct for non-mutual followers — no display label exists for them).
    - Each row has an avatar dot + label-or-code + selection indicator. Tap to toggle selected/unselected.
  - **Filters applied at render time:**
    - Followers who are already members of this group are excluded.
    - Followers who already have a pending invite for this group show an "Invited" pill instead of a selection indicator. Tap the "Invited" pill to un-invite (deletes the pending record).

**Tapping the Invite button:**

- For each currently-selected row, writes `pendingInvites/{inviteeUid}/{groupId} = { from: ownerUid, ts: Date.now() }`.
- Each selected row flips in-place to the "Invited" state. The modal stays open. No toast.
- An un-invite (tap "Invited") deletes the pending record and the row flips back to selectable.

**Dismiss the modal by tapping outside** (no Cancel / Close button — see §9.4).

#### Invitee side — the Inbox

On the receiving end the invitee's app subscribes to `pendingInvites/{ownUid}/` via `watchPendingInvites`. Invites surface as an **Inbox** element in the nav row:

- **Inbox is a nav-row button**, same shape and border as the "+" create-group affordance, positioned **before** the first group card (or before the "+" when the user is in no groups).
- **Inbox is hidden when there are zero pending invites.** It appears the moment the first invite arrives and disappears when the last one is accepted, declined, or revoked.
- Tapping Inbox opens a modal listing **all** pending invites:

   ```
   ┌─────────────────────────────────────────────────┐
   │ {inviter A label} invited you to join 'Family'. │
   │                              [Join]  [Decline]  │
   │ ─────────────────────────────────────────────── │
   │ {inviter B label} invited you to join 'Work'.   │
   │                              [Join]  [Decline]  │
   │ ─────────────────────────────────────────────── │
   │ ...                                             │
   └─────────────────────────────────────────────────┘
   ```

  - The inviter is identified by the local label the invitee has for them (they are already a follower of the inviter, so they have a label).
  - The modal dismisses on tap-outside.
  - **On `Join`:** the invitee is added to the group (member record + user-side enumeration entry), the pending record is deleted, the row disappears from the modal. The app navigates the user into the new group. If this was the last pending invite, the modal closes and the Inbox button disappears from the nav row.
  - **On `Decline`:** the pending record is deleted, the row disappears. The inviter is **not** notified of the decline. If this was the last pending invite, the modal closes and the Inbox button disappears.
- **No TTL in MVP** — invites wait until accepted, declined, or revoked.

#### Cleanup races

- **Invitee joined the group via link before tapping Join:** the Join handler reads group membership first; if the invitee is already a member, it silently deletes the pending record and dismisses the row.
- **Inviter's picker shows someone who just joined via link:** picker filtering is at render time. If the picker is open and the join echoes through `watchGroupMembers`, the row updates in place to be excluded on the next picker render.
- **Group deleted with pending invites outstanding:** `deleteGroup` sweeps `pendingInvites/*/{groupId}` as part of the delete operation. Each affected invitee's Inbox updates via `watchPendingInvites` and the row disappears.
- **Inviter revoked a pending invite from another device:** the invitee's `watchPendingInvites` callback fires on the deletion; the Inbox row disappears in real time. If the invitee had the Inbox modal open and was about to tap Join, they see the row vanish — acceptable, no error needed.

#### Inviter-side "what have I sent?"

There is **no inviter-side view of pending sent invites in MVP.** Tracked separately in [#124](https://github.com/tenorune/on/issues/124) — adding a mirror at `userPrefs/{ownerUid}/sentInvites/{groupId}/{inviteeUid}` so the owner can see and revoke their sent invites from any device.

In MVP, an owner who wants to revoke must do it from the same modal session in which they sent the invite (the "Invited" pill is right there in the picker). A device switch loses that affordance until the issue is addressed.

**Phase B rules sketch** (for the implementation plan's reference, not part of MVP code):

```json
"pendingInvites": {
  "$inviteeUid": {
    ".read": "auth.uid === $inviteeUid",
    "$groupId": {
      ".write": "auth.uid !== null && (
        (!data.exists() && newData.child('from').val() === auth.uid)
        || (data.exists() && (data.child('from').val() === auth.uid || auth.uid === $inviteeUid))
      )"
    }
  }
}
```

The same model works under MVP honor-system rules (which are wide-open).

### Bulk in-app invites

The Phase 3 picker is **multi-select** (toggle multiple rows, tap Invite once), which covers the common case of inviting several followers at once. A more elaborate "bulk" affordance — group-wide tag/segment selection, search-and-select across many followers, etc. — is post-MVP. **Bulk-via-link** is also available: one invite link with `redemptionCap: null` (unlimited) can be redeemed by many users.

## 11. Bridging: group → 1:1 follow (post-MVP)

When a user is in a group with someone they don't follow, they may want to start following that person 1:1 (so they can use 1:1 communication primitives, see their status outside the group context, etc.). The post-MVP affordance for this is a **request-to-follow** flow:

1. User taps the target member's card in the group's roster → tap "Request to follow."
2. Target receives a notification.
3. Target approves or declines.
4. On approval, a follow relationship is created from the requester to the target.

**Key property:** the follow relationship is *independent of group membership.* If the requester later leaves the group, the follow persists. Group membership and following are orthogonal concepts.

In MVP, this affordance does not exist. A non-mutual co-member receiving a knock (see §13) has no way to bridge to a follow relationship — the knock is a one-shot ping with no follow-back implication.

## 12. Communication primitives in groups

The existing communication primitives (knock, call, canvas, palette adoption) all assume *mutual* relationships in their current implementation. The question is how groups interact with them.

### MVP behavior

Existing primitives stay **mutuals-only** in MVP. Group membership alone does not unlock them. Each is gated by its existing feature flag (`KNOCK_ENABLED`, `CALL_ENABLED`, `PALETTES_ENABLED`).

**Exception in MVP:** the "knock-via-group-context" affordance is introduced, allowing knocks between non-mutual co-members. See §13.

### Post-MVP relaxation

When/if the user base wants it, the eligibility check for 1:1 primitives can be widened from "must be mutual" to "must be mutual OR co-member in any group." This is **not** behind a new feature flag; the existing flags continue to gate the features themselves. The check just changes from a tight to a loose eligibility test.

With this relaxation:

- Co-members can knock each other (already true via §13 in MVP).
- Co-members can call each other.
- Co-members can share a canvas.
- Co-members can long-press to adopt each other's palette.

### Not on the roadmap

Out of scope for this design entirely:

- **Group calls** (multi-party voice or video).
- **Group canvas** (multiple users drawing simultaneously on a shared surface, beyond the existing 2-user canvas).
- **Group knock broadcasts** ("@channel" — knock everyone in a group at once).
- **Direct messaging within groups.**

Groups are about *ambient presence*. 1:1 communication remains the rich path between any two specific people.

## 13. Knock-via-group-context

This is the one exception to "groups don't add new communication primitives in MVP." Knocks are allowed between non-mutual co-members, *specifically* when initiated from within the group's context.

### Why this exception

Knocks are a lightweight notification: *"Hey, I see you."* Within a group, the relationship between members is already trust-bounded by the group's membership. A knock from a co-member is not the same as a knock from a random stranger — the group is the implicit trust anchor. So the gate "must be mutual" is relaxed for the *intra-group* case.

### Initiating a knock

User X is in `Family`. They tap user Y's card in the Family roster, then tap Knock. The knock is recorded.

### Receiving a knock

Y receives the knock signal. The visible behavior depends on what context Y is currently in:

**Case 1: Y is in the same group context as the knocker (Family).**

The knock arrives "live." Y's app:

1. Plays the existing 2-second pulse animation on X's card in the Family roster.
2. **Floats X's card to the top** of the Family roster (above the normal sort).
3. Anchors X's card at the top for **20 seconds** from the moment of arrival.
4. After the 20s window, X's card sorts back into its normal position.

**Case 2: Y is in a different context (Direct, or another group).**

The knock is "deferred." Y's app:

1. The knock record is stored. No immediate animation (Y can't see Family right now).
2. An **unread-knock indicator badge** appears on the Family group's card in Y's group cards row (visible when Y is in Direct context).
3. When Y next navigates into Family context:
   - The existing 5-second deferred-knock CSS keyframe animation plays on X's card.
   - X's card floats to the top of the Family roster.
   - Anchors at top for 20 seconds from the moment Y entered Family.

### Multiple knocks

- **Same knocker, multiple knocks:** the 20s timer resets each time a new knock from the same person arrives. The card stays at the top for at least 20s after the last knock. If a same-person reset arrives mid-anchor-window, the card re-sorts to the top of the stack as the most-recent-knock entry.
- **Multiple different knockers:** each gets its own 20s anchor window. They stack at the top of the list in order of most-recent-knock first.

### Cross-device clearing semantics

Knock state is in the database and cleared after the recipient has seen it (existing behavior). With multiple devices:

- If Y sees the knock live on device A (currently in Family on device A), device A clears the knock record. Device B, which was showing the badge on the Family group card while in Direct, sees the clear via its subscription and removes the badge.
- If Y's device A is in Family and device B is also in Family (both viewing the roster), both apps play the pulse on receipt. The first one to write the "seen / clear" record wins; the second one no-ops. (RTDB last-write-wins is fine here.)

### Applying the same float-to-top behavior to Direct context

Today's knock behavior in Direct context just pulses the knocker's card in its sorted position. With long contact lists (Mutuals + Following + Followers), the knocker can be buried below the fold of the screen.

**The same 20s float-to-top behavior is applied to Direct context too.** When a mutual knocks the user, that mutual's card pulses *and* floats to the top of its section for 20 seconds. This is a small but real ergonomic improvement to today's UX, in addition to its necessity for group context knocks.

### Knock acknowledgment / clearing

Today's behavior: knocks clear once seen. The `initKnocks` initialization fetches pending knocks and the visual pulse + clear operation runs as a unit. Group-context knocks follow the same lifecycle — once the user has seen them (either live, or via deferred trigger on entering the group context), they're cleared from the database.

### No follow-back action tied to the knock

Important: the knock is a **pure notification.** It does not create a follow relationship. It does not have a "follow back" button. If the knock recipient wants to start following the knocker, they use the separate request-to-follow affordance (post-MVP, §11). In MVP, there is no way to follow a non-mutual co-member from a knock — the recipient sees the pulse and that's the entire interaction.

This is intentionally minimal. A knock is a ping; following is a separate decision.

### Animation timing reference

| Animation | Duration | Source |
|---|---|---|
| Live knock pulse | 2 seconds (box-shadow decay) | `applyLiveKnock` in `js/knock.js` |
| Deferred knock pulse | 5 seconds (CSS keyframe) | `.knock-deferred` class + `@keyframes knock-deferred` |
| Float-to-top anchor window | 20 seconds | New behavior, applies to both live and deferred |

## 14. Cross-device sync

Group-related state syncs across the user's devices via a combination of the existing `watchStatus` subscription pattern and per-group `watchGroupMembers` subscriptions.

### What syncs via `watchStatus` (user-side state)

The `users/{uid}/...` subtree continues to flow through the existing `watchStatus` callback. New fields:

- `users/{uid}/groups/{groupId}/lastVisited` — for group cards ordering.
- `users/{uid}/currentContext` — which context the user is in.
- `users/{uid}/invites/{inviteId}` (personal-scope invite records).

When `watchStatus` ticks, the existing pattern of `syncXFromServer(...)` helpers gains:

- `syncUserGroupsFromServer(...)` — reconciles the enumeration index and lastVisited timestamps.
- `syncCurrentContextFromServer(...)` — applies a context change (if the server-side context differs from the local one, the UI re-orients).
- `syncPersonalInviteFromServer(...)` — refreshes the personal-scope invite record.

### What syncs via per-group subscriptions

The canonical membership facts live group-side (§7). The app subscribes per-group, keyed by the groups the user is enumerated into:

- `watchGroupMembers(groupId, callback)` — subscribes to `groups/{groupId}/members/` for roster rendering and per-member status display.
- `watchGroupMeta(groupId, callback)` — subscribes to `groups/{groupId}/name` (and the future color/palette fields) for the group cards row and breadcrumb.
- `watchGroupInvites(groupId, callback)` — subscribes to `groups/{groupId}/invites/` for the invite-management modal (owner/admin only).

The own-user's per-group `displayName`, `role`, and `statusOverride` all come from `watchGroupMembers` — there is no user-side mirror to keep in sync.

### What syncs via the pending-invites mailbox (Phase 3)

`watchPendingInvites(uid, callback)` — subscribes to `pendingInvites/{uid}/` for the invitee's Inbox. Each child key is a `groupId` (deterministic, one entry per (invitee, group) pair). The callback receives a map of `groupId → { from, ts }` records.

### What does NOT sync

Things that are purely UI state, not user state:

- Which group card is currently visually selected vs. not (this is just the rendering of currentContext, which does sync).
- Scroll position within a context.
- Whether the user has dismissed an ephemeral toast.

### Initial sync on app boot

When a user opens the app on a new device for the first time after restoring identity:

- `watchStatus` fires with the full user record on first tick.
- The user's enumeration index `users/{uid}/groups/` is read; for each enumerated group, `watchGroupMembers` and `watchGroupMeta` subscriptions are spun up.
- `currentContext` is restored (or falls back to Direct if invalid).
- Pending invites are loaded if Phase 3 is shipping.

## 15. Feature gating

A new feature flag — `GROUPS_ENABLED` — is added to `js/features.js` alongside the existing flags:

```js
PALETTES_ENABLED              // (existing)
PALETTE_INTERACTIONS_ENABLED  // (existing)
KNOCK_ENABLED                 // (existing)
CALL_ENABLED                  // (existing)
GROUPS_ENABLED                // NEW: gates entire groups feature
```

When `GROUPS_ENABLED` is false:

- No group cards row appears in Direct context.
- No "Create your first group" CTA.
- No group context views are reachable.
- Knock-via-group-context behavior is inactive.
- The data model still tolerates existing group records (a user who's in groups from another device sees them once the flag is on).
- The personal-scope invite affordance (Phase 0) still works — Phase 0 ships without `GROUPS_ENABLED` actually gating group behavior, since there are no groups yet.

The existing flags continue to gate their respective features. There is no separate flag for sub-features within groups (e.g., no separate flag for per-audience status overrides, knock-via-group-context, etc.).

### Post-MVP eligibility relaxation is NOT a new flag

The post-MVP behavior where co-members can use 1:1 primitives (knock, call, canvas, palette adoption) with each other *without* being mutuals is implemented as a widening of the existing eligibility check in those features' code paths — *not* as a new feature flag. The check changes from "is this user a mutual?" to "is this user a mutual OR a co-member?" The features themselves remain gated by their existing flags.

## 16. Phasing

The work is broken into shippable phases, each producing a usable feature on its own.

### Phase 0 — Invite-link infrastructure (1:1 follow-me)

This phase ships **without groups existing.** It introduces the invite-link primitive and uses it for 1:1 follow-me invitations.

What ships:

- Invite-link primitive in Firebase (scope discriminator, token, TTL, redemption cap, revocation field, redemptions counter, creator label for personal-scope).
- Global `inviteIndex/{token}` lookup table for redemption resolution.
- Lifecycle operations: create, copy, revoke, regenerate.
- **One-active-personal-invite-per-user constraint** enforced in the UI and on write.
- **Invite modal component** (§9.4) parameterized by scope. In Phase 0, only the personal-scope parameterization is exposed.
- **Code drawer entry point**: a row beneath the share-code Copy button, with `[ Create invite link ]` (no active invite) or `[ View invite link ]` (active invite exists). Opens the modal.
- URL parsing and redemption flow via `inviteIndex`.
- Personal-scope redemption: follow established.
- Brand-new user onboarding via personal-scope link (welcome screen says *"You've been invited to follow {creatorLabel}"*).
- Friendly failure messages for revoked / expired / capped / not-found links.
- Failure overlay returns existing users to their current context, brand-new users to the welcome screen.
- `GROUPS_ENABLED` flag added; only gates group-scope behavior (none in Phase 0). Personal links work regardless.

What ships as a side effect: a user can now replace "exchange share codes verbally" with "share an invite link" for the 1:1 follow case. This is a useful standalone feature on its own.

**Why this phase first:** validates the invite-link infrastructure (including the modal pattern and the index lookup) before groups are layered on top. If anything's wrong with the link mechanics, it surfaces in Phase 0 where the blast radius is small.

### Phase 1 — Groups minimum

This phase introduces the group entity and the core group-related UI. The status model is **still single-status** in this phase — every group sees the user's primary status. Motivation B is fulfilled; C+A is not yet.

What ships:

- Group entity in Firebase (id, name, owner, member list, invites, createdAt).
- Transactional `groupIdIndex/{groupId}` allocation.
- Owner-only group operations: create, rename, delete.
- **Group-deletion notification mechanism** (§16.1).
- Group-scope invite links (reuses the Phase 0 primitive and the modal component, with the scope parameter set to group).
- **Per-(creator, group) one-active-group-invite constraint.**
- Existing-user link redemption (Flow A): name prompt + auto-add to group + land in group context.
- New-user link redemption (Flow B): welcome screen + secret-phrase modal + "Your name in 'Family'" step.
- Member operations: see roster, edit own display name, leave the group.
- Display name validation (trim, non-empty, max 40 — matches existing label inputs).
- Navigation infrastructure: group cards row at top of Direct context (with `+` and zero-state CTA), `←` breadcrumb in group context.
- `users/{uid}/groups/{groupId}` enumeration index with `lastVisited` writes on context navigation.
- Persistent `currentContext` across sessions and devices (via watchStatus pattern).
- Per-group `watchGroupMembers` and `watchGroupMeta` subscriptions wired up on group-enumeration changes.
- Knock-via-group-context: pulse animation + 20s float-to-top anchor.
- Float-to-top behavior also applied to direct contacts (latent issue addressed).
- Group card indicator badge for pending knocks.
- `GROUPS_ENABLED` flag now gates the group-scope UI.

What's still missing (and added in later phases):

- Per-audience status overrides (Phase 2).
- In-app push invites (Phase 3).
- Admin role (post-MVP).
- Group color/palette customization (post-MVP).

#### 16.1 Group-deletion notification mechanism

When an owner deletes a group, members need to be notified that the group they were in no longer exists. The mechanism:

1. Each member's app subscribes to `groups/{groupId}/members/{ownUid}` via `watchGroupMembers` for each group enumerated in `users/{uid}/groups/`.
2. When the owner deletes the group, all `groups/{groupId}/...` records are removed. The member's subscription returns `null` on the next tick.
3. The app correlates: did the user-side enumeration record still exist before this tick? Yes → this is a deletion (or kick) event, not just an absence.
4. Distinguish deletion from kick by reading `groups/{groupId}/name` (or any group-level field). If the entire group is gone → it was deleted. If only the user's member record is gone but the group still exists → the user was kicked.
5. In either case: the app shows a brief in-app notice (toast or modal):
   - Deletion: *"'Family' has been deleted."*
   - Kick: *"You've been removed from 'Family'."*
6. The app cleans up the local state: removes the `users/{uid}/groups/{groupId}` enumeration entry, removes the group card, and (if `currentContext` was set to this group) falls back to Direct.

The notice is informational — no action required from the user. Closing it dismisses it.

### Phase 2 — Per-audience status overrides

This phase adds the multi-status model on top of the Phase 1 foundation. Motivation C+A is now fulfilled.

What ships:

- "Set a unique status" toggle per audience (each group, plus the followers audience).
- Toggle defaults OFF; ON → audience-specific status, initial value Unavailable.
- `statusOverride` block written to `groups/{groupId}/members/{ownUid}/statusOverride` (canonical location).
- Header status chip in any context now controls *that context's* status (primary in Direct; override in group with toggle ON).
- Group card visual styling reflects the user's override color/theme when override is ON; neutral when OFF.
- Group context view shows the user's override status on their own card (if visible in the roster).
- Member roster in any context shows each member's context-appropriate status (their override if toggle ON, else their primary).

### Phase 3 — In-app push invites

What ships:

- In-app invite flow (Flow C in §10).
- **Inviter-side:**
  - Group settings "Invite link" menu item renamed to "Invite."
  - New "+ Invite to group" row pinned at the top of every group's roster, styled like Direct's "Add a person" button.
  - Both entry points open the unified invite modal (§9.4).
  - The modal's in-app picker section lists mutuals (by local label) then non-mutual followers (by share code), excludes current group members, and lets the inviter multi-select and send with one tap. Already-invited rows show an "Invited" pill that un-invites on tap.
  - Owner-only in MVP.
- **Invitee-side:**
  - New "Inbox" element in the nav row, same shape as "+", positioned before the first group card (or before "+" when no groups exist).
  - Inbox is hidden when there are zero pending invites.
  - Tapping Inbox opens a modal that lists all pending invites with per-row Join / Decline.
  - On Join: user is added to the group and navigated into it. On Decline: pending record is deleted, inviter not notified.
- Multi-device sync via `watchPendingInvites`.
- Pending invites stored at `pendingInvites/{inviteeUid}/{groupId}` — deterministic key for natural dedup; top-level mailbox is Phase-B-rules-compatible without a Cloud Function.
- `deleteGroup` sweeps `pendingInvites/*/{groupId}` to clean up orphaned invites.

What does **not** ship in this phase (tracked separately):

- Inviter-side "sent invites" view + cross-device revoke — [#124](https://github.com/tenorune/on/issues/124).
- Admin role activation (admin-issued invites) — Phase 4+.
- Bulk in-app invites to many followers in one action — Phase 4+. (The picker is multi-select, which covers the common case.)
- Push notifications when an invite arrives — Phase 4+.

### Phase 4+ — Post-MVP polish

These items are documented but not in MVP. Rough priority order:

- **Admin role + permissions.** The data model accommodates `role: 'admin'` from Phase 1; this phase activates the role.
- **Owner ownership transfer.** Allow owners to hand off to another member; enables the owner to leave.
- **Group color/palette semantics.** Owner-configurable between:
  - **Mode B (member uniform):** members appear in the group's color when viewed in that group's context.
  - **Mode C (default suggestion):** group's color is suggested as the default status color for new members; they can still override.
- **Confirmation card on existing-user link redemption.** Instead of going straight to the name prompt, show a *"Join 'Family'?"* card before adding the user.
- **In-place edit of personal invite creator label** without requiring regenerate.
- **Request-to-follow.** From a non-mutual co-member's card, send a follow request the target can accept or decline. Establishes 1:1 follow.
- **Pending/approval moderation gating.** Group can be configured to require admin approval before new joiners are admitted.
- **Advanced bulk-invite affordances.** Search across followers, tag/segment selection, etc. (The Phase 3 multi-select picker handles the common case.)
- **Cross-referencing display names.** Optionally let users surface their per-group names to followers.
- **Co-member 1:1 primitives without mutual.** Widening of the eligibility check for knock/call/canvas/palette adoption (still gated by existing flags).
- **Group name disambiguation UI.** When a user is in multiple groups with the same name.
- **Collapse strategy for >5 groups.** Beyond what MVP handles.
- **Orphan group reminder.** Prompt owners to designate a successor before they go inactive.
- **Group description / avatar / metadata.** Beyond just a name.
- **"Hide group from nav without leaving."** Keep membership but remove the card from the nav.
- **Sort/search affordances for large member lists.** For groups >100 members.
- **"Live members here right now" indicator.** Beyond the existing presence model.
- **Notifications on admin actions** (rename, color change, kick).
- **Push notifications via service worker** for in-app invites and knocks.
- **`inviteIndex` cleanup pass** for expired-and-untouched entries.

## 17. MVP scope

**MVP = Phases 0 + 1 + 2 + 3.**

This delivers:

- Invite-link primitive, `inviteIndex` resolution, and 1:1 follow-me invites with creator labels (Phase 0).
- Group entity, owner-only ops, group invites, member operations, navigation, knock-via-group-context, group-deletion notifications (Phase 1).
- Per-audience status overrides (Phase 2).
- In-app push invites with the unified invite modal, Inbox nav element, and pending-invite mailbox (Phase 3).

Both motivations B and C+A are fulfilled. Motivation D (onboarding via link) is also served — new users join via either a personal link or a group link. Section 11 (request-to-follow from a group) remains post-MVP.

Phase 4+ (post-MVP polish) ships after.

### Why include Phase 2 in MVP

Phase 1 alone satisfies Motivation B but not C+A. Without per-audience overrides, groups are essentially "shared followers" — useful for scaling but uninteresting beyond that. Including Phase 2 in MVP delivers both motivations together, making the feature feel meaningfully different from a richer Following model.

The alternative (MVP = Phases 0 + 1 only, with overrides as a post-MVP enhancement) was considered but rejected: shipping a "groups but you can't customize per group" version risks the feature feeling underdone.

## 18. Out of scope

For clarity, these are explicitly NOT in scope for this design:

- **Group calls** — multi-party voice or video. Beyond the existing 2-user call.
- **Multi-party canvas** — more than 2 users on a shared drawing surface.
- **Group knock broadcast** — knocking everyone in a group at once. ("@channel" semantics.)
- **Direct messaging in groups** — text or media messaging beyond presence.
- **Read receipts on knocks** — knowing whether the recipient saw your knock.
- **Group avatars / banner images** — visual identity beyond color/palette.
- **Discoverable / public groups** — a directory you can browse. Groups remain invite-only.
- **Group join requests without a link** — there's no "find a group and ask to join" path.
- **Member-managed identity** — letting other members change your display name in a group.
- **Multiple active invite links per scope-target** — the one-active-invite constraint is intentional.

## 19. Implementation considerations (notes for the implementation plan)

These aren't design decisions; they're notes for whoever writes the implementation plan.

- **Group ID generation.** Transactional claim against `groupIdIndex/{groupId}`, retry on collision. Same pattern as `codeIndex` for share codes.
- **Invite token format.** URL-safe random string with high entropy. Suggested: 22 chars from `base64url` (128 bits of entropy). Validated by exact match.
- **`inviteIndex` allocation.** Same transactional-claim pattern as `groupIdIndex` and `codeIndex`. Collision is vanishingly rare at 128 bits but the retry loop is cheap insurance.
- **`inviteIndex` cleanup.** Revoke and regenerate paths must remove the index entry as part of the atomic operation, not as a follow-up best-effort. Expired-by-TTL entries are left in place in MVP; redemption-time validation catches them. A post-MVP cleanup pass can sweep them.
- **Modal component reuse.** Build one component parameterized by `{ scope, ownerPath, creatorLabel? }` rather than two near-duplicates. The Phase 0 implementation should anticipate the Phase 1 group scope so the parameterization doesn't require refactoring.
- **One-active-invite enforcement.** Should be enforced both client-side (UI prevents creating a second) and on the write transaction (read-modify-write the user/group invites collection in a transaction that fails if an active invite already exists). The transaction catches multi-device races.
- **Firebase RTDB rules.** The existing rules allow any-user read/write to `users/$userId`, `codeIndex/$code`, `canvases/$canvasId`. Groups will need analogous rules for `groups/$groupId/...` and the new `inviteIndex`, `pendingInvites`, `groupIdIndex` paths. MVP uses permissive rules; Phase B identity work (documented in the v2 recovery-code spec) will tighten to `auth.uid`-based rules. The data layout in this revision (§7) is designed to be portable to Phase B without requiring a Cloud Function — note in particular:
  - `groups/{groupId}/members/{memberUid}/...` member-self-write rule: `auth.uid === $memberUid`.
  - Group-owner writes (kick, rename, delete) gated by reading the requester's role from the same path.
  - `pendingInvites/{inviteeUid}/{groupId}` rules sketched in §10 Flow C — inviter writes own, invitee reads own, both can delete.
- **Group-deletion / kick detection.** See §16.1 for the algorithm. The correlation step (was-enumerated → null = transition event) is the key piece; without it, the app can't distinguish "I'm not in this group" (steady state) from "I was just removed" (event to surface).
- **Performance of large groups.** With `members/{uid}` as a sub-record under `groups/{groupId}`, listing all members is O(n). At 100 members this is fine; at 10,000 it isn't. Defer optimization until needed.
- **Existing canvas / call / knock code.** Unchanged in MVP. Groups don't refactor them.
- **Test infrastructure.** New Firebase reads/writes need to be mocked in the appropriate test files. New exports from `js/db.js` particularly need their mocks updated (per the handoff: `tests/favorites.test.js`, `tests/following.test.js`, `tests/me.test.js`, `tests/mycode.test.js`).
- **Cross-device sync.** Reuses the `watchStatus` callback for user-side state and per-group `watchGroupMembers` / `watchGroupMeta` subscriptions for canonical membership data. Each new piece of user-state adds a `syncXFromServer(...)` helper called from the watchStatus callback, following the pattern established by paletteState, favorites, following, and the others.
- **Migration.** Existing users have no `groups` enumeration record. The Phase 1 code must handle the empty case gracefully — `users/{uid}/groups` may not exist on read.

## 20. References

This design draws on patterns established in adjacent specs:

- **`docs/superpowers/specs/2026-05-23-recovery-code-design.md`** — defines the v2 secret-phrase identity model that this feature builds on. Cross-device sync infrastructure assumed by this spec; Phase B identity work referenced by §19.
- **`docs/superpowers/specs/2026-03-23-call-canvas-design.md`** — defines the 1:1 canvas behavior referenced in §12 ("communication primitives in groups").
- **`js/features.js`** — current feature flags. The new `GROUPS_ENABLED` flag is added here.
- **`js/following.js`** — `add-label-input` / rename input pattern referenced by §5 for display-name validation.

End of specification.
