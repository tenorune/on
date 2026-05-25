# Groups — Design Specification

*Date: 2026-05-25*

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

- **C (contextual identity):** the user may want to appear as "Sam" to family and "Ms. Carter" to a work group, with possibly different colors per context. Their *identity presentation* should vary by context.
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
- **Audience** — a logical recipient of a user's status. Each user has one **followers** audience (which are their direct followers) plus one audience per group they're a member of. With 4 groups, a user has 5 audiences total.
- **Direct contacts context** (often shortened to "Direct") — the existing app's main view: your direct followers/following/mutuals. The "home" context.
- **Group context** — a separate view focused on one specific group. Shows that group's members and a status header for that group's audience.
- **Current context** — at any moment, the user is in exactly one context (Direct or a specific group). The app's UI reflects whichever context is current.
- **Primary status** — the status a user has chosen for their Direct context. Also serves as the broadcast default to any group whose override toggle is off.
- **Override** — when a user has explicitly opted to give a specific audience (group or followers) a status different from their primary. Controlled per-audience by a "Set a unique status" toggle.
- **Invite link** — a URL with a redemption token that, when tapped, performs an action (follow the link's creator, or join the link's group). Has lifecycle: TTL, redemption cap, revocation, regeneration.
- **Personal-scope invite** — an invite link whose redemption action is "follow the creator."
- **Group-scope invite** — an invite link whose redemption action is "join the link's group."
- **Knock-via-group-context** — when a non-mutual group co-member sends a knock to another member.

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
- **Group members' statuses (what other members look like):** each member's card in the group's roster shows their status *for this group's audience* — i.e., their group override if ON, otherwise their primary.

### Status durations and the time chip

The time chip in the header controls how long the user is "available for." When the user is in Direct context, the time chip controls the primary status's duration. When in a group context with the override ON, the time chip controls the override's duration. The time chip's selected value also syncs across devices (using the existing time-chip sync infrastructure).

## 5. Identity model (display names)

### Per-group display name

Each user has a **display name** for each group they're in. Set at join time. Editable later from within the group's context.

This is distinct from the user's share code (which doesn't change between contexts) and from the per-follower labels (which the *follower* sets for themselves to label *the user*).

For instance: a user might be `XK7P2M` (share code, immutable for them), labeled by their friend Alice as "Bob" (Alice's label, visible only to Alice), and have a display name "B.J." in the Skydivers group (the user's own choice, visible to all Skydivers members).

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
- Any pending indicators (e.g., an unread-knock count badge — see §11).
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

The user's group cards are ordered by **most-recently-visited first**. This is derived from the `currentContext` history (not stored separately; the natural order falls out of which group the user last navigated to). On first launch with multiple groups, before any navigation has happened, falls back to creation order.

### Collapse strategy for many groups

If the user is in more than 5 groups, the horizontal row of cards may stretch beyond the viewport. **Not handled in MVP** — the row just stretches; horizontal scrolling may be implicit if the cards overflow. Post-MVP candidate strategies:

- Horizontal scroll on touch
- Collapse to a single "Groups (N)" pill that opens an expanded list on tap
- A pinned-vs-overflow split with the user choosing which groups appear pinned

## 7. Group entity (data model)

A group is a named entity with metadata, a member list, and an invite list.

### Storage layout

```
groups/{groupId}:
  name: string                       // free text, max 40 chars, NOT unique
  ownerId: userId
  createdAt: timestamp               // stored, not shown in MVP UI
  color?: string                     // post-MVP, owner-configurable
  paletteKey?: string                // post-MVP, owner-configurable
  members/{memberUid}:
    role: 'owner' | 'admin' | 'member'  // MVP only uses 'owner' and 'member'
    displayName: string                  // user's name in this group
    joinedAt: timestamp
    pendingApproval?: boolean            // reserved for post-MVP gating
  invites/{inviteId}:
    scope: 'group'
    token: string                      // unguessable URL-safe random
    creatorUid: userId                 // owner or admin who made it
    createdAt: timestamp
    expiresAt: timestamp | null        // null = no expiry
    redemptionCap: number | null       // null = unlimited; 1 = single-use
    redemptionsUsed: number
    revoked: boolean
```

User-side state additions (under `users/{uid}` in Firebase + localStorage cache):

```
users/{uid}:
  // existing fields ...
  groups/{groupId}:
    role: 'owner' | 'admin' | 'member'    // mirrors the group-side record
    displayName: string
    statusOverride?: {
      enabled: boolean                     // the "Set a unique status" toggle
      status?: 'available' | 'unavailable'
      availableUntil?: timestamp
      statusColor?: string                 // optional, override of primary color
      paletteKey?: string                  // optional
    }
  currentContext: 'direct' | 'group:{groupId}'
  pendingInvites/{groupId}:                // Phase 3
    from: userId                            // who invited me
    ts: timestamp
```

### Group ID format

8-character alphanumeric random (uppercase letters + digits). Generated transactionally: a new ID is reserved in a `groupIdIndex/{groupId}` lookup table, and on collision the generator retries. This is the same pattern used today for share codes.

### Group names

Free text up to 40 characters. Names are **not unique** — two different owners can each create a group called "Family." This is deliberate: users typically name their groups after social roles ("Family", "Work", "Book Club") that are common in their respective contexts.

A user could potentially be a member of multiple groups with the same name. The MVP does not address this disambiguation in the UI; both groups appear in the group cards row with identical labels. Future work could add per-user aliases or owner-name suffixes.

### Open / closed state

The user's stories mention "Open or close a group to new members." In the MVP, this state is **derived**, not stored separately: a group is effectively "open" when at least one valid invite link exists *and* at least one member has permission to use it. When all invite links are revoked/expired/exhausted *and* no member has invite permission, the group is effectively closed.

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

The invite system is **one primitive with a scope discriminator.** A single "invite link" entity supports both 1:1 follow-me invitations and group-join invitations; the difference is the action performed at redemption.

### Why one primitive

A 1:1 "follow me" link and a "join my group" link share most of their behavior: a token, a TTL, a redemption cap, a revoke action, a creator. Implementing them as one primitive means one Firebase table, one lifecycle code path, one settings UI. The difference is small (what happens at redemption) and lives in a discriminator field.

### Invite-link record

Stored under `groups/{groupId}/invites/{inviteId}` for group-scope, and under `users/{uid}/invites/{inviteId}` for personal-scope. (Different paths, same shape.)

```
{
  scope: 'personal' | 'group'
  token: string                 // unguessable URL-safe random, ~22 chars
  creatorUid: userId            // who made this link
  createdAt: timestamp
  expiresAt: timestamp | null   // null = no expiry
  redemptionCap: number | null  // null = unlimited; 1 = single-use; N = multi-use
  redemptionsUsed: number
  revoked: boolean
}
```

### Lifecycle operations

- **Create.** A link is generated with optional cap, optional TTL. Token is random. Resulting URL: `https://[hosting-domain]/?i={token}`.
- **Revoke.** Sets `revoked: true`. The link's URL still resolves, but redemption returns a friendly error.
- **Regenerate.** Functionally: create a new link, optionally revoke the old. The old link's token is no longer valid.
- **Cap.** Each successful redemption increments `redemptionsUsed`. When `redemptionsUsed >= redemptionCap`, redemption returns a friendly error.
- **TTL.** If `expiresAt < now`, redemption returns a friendly error.

### Redemption flow

When a user taps an invite URL, the app extracts the token from the URL query string and validates it:

1. Token exists in the database? If not → friendly error ("This invite link isn't valid").
2. Revoked? If so → friendly error ("This invite link has been revoked").
3. Past `expiresAt`? If so → friendly error ("This invite link has expired").
4. Cap reached? If so → friendly error ("This invite link is no longer accepting new joiners").
5. All checks pass → perform the scope-specific action.

For **personal scope**, the action is: create a follow relationship from the redeemer to the link's creator. The link's `redemptionsUsed` is incremented. The follow is independent of any group; the link's role ends there.

For **group scope**, the action is: add the redeemer to the group's member list, with default role `member`. The `redemptionsUsed` is incremented.

### Failure UX

On any failure, the redeemer sees a friendly message and an offer to keep using the app normally. Specifically: a small overlay that doesn't disrupt their session, with text appropriate to the failure mode and a "Continue" button. Tapping Continue dismisses the overlay; the user's session proceeds (if they're a new user, the welcome screen appears; if existing, their Direct context appears).

### Preview content

When a user is *about* to redeem a link (or in the case of group-invites, when they're shown the welcome screen for a brand-new user), the only metadata surfaced about the group is its name. No owner name, no member count, no description. This intentionally minimal preview prevents leaking metadata to potentially-malicious link recipients.

### Pending/approval gating (post-MVP)

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
5. Token is validated against the database.
6. On success: the redeemer is silently added to the group as a member. They land directly in the group's context (since `currentContext` is updated to `group:{groupId}`).
7. No confirmation card, no toast, no banner. The user is in the group; the UI reflects it.

**Why silent:** the user took an explicit action (tapping the link) and intends to join. A confirmation card would be redundant. (A confirmation card *is* available as a post-MVP enhancement for users who want a friction-step before commitment.)

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
8. **A new step appears: "Your name in 'Family'."** Single text input plus a Continue button. The user types their per-group display name (defaulting to empty, the user must enter something).
9. User taps Continue.
10. The full account-creation sequence completes (secret phrase derived → userId → share code claimed → user added to the group).
11. Main UI loads with the user in the Family group context.

**Variation: tapping a personal-scope ("follow me") link as a brand-new user.** Same shape as the group flow, with the welcome screen adapted to say *"You've been invited to follow Alex"* instead of *"You've been invited to join 'Family'"*. No display-name step (display names are per-group; personal follows use the existing labeling system). After account creation, the redeemer is following the link's creator and lands in Direct context.

### Flow C: existing user accepting an in-app push invite (Phase 3)

This flow exists when an owner (or admin) explicitly invites a follower they already have into a group — not via a link, but as a directed in-app invitation.

1. **Inviter side:** Owner taps a follower's card in the group context's settings, taps "Invite to a group," picks the destination group. The invite is sent.
2. **Database write:** A `pendingInvites/{groupId}` record is added under the invitee's user record, with the inviter's uid and a timestamp.
3. **Invitee side:** On their next session (or in real-time via watchStatus if their app is open), they see a small inline card at the top of their main list:

   ```
   Bob invited you to join 'Family'.
   [Join]  [Decline]
   ```

4. The card persists until the user accepts, declines, or the inviter revokes it. **No TTL in MVP** — the invite waits.
5. On `Join` → user is added to the group as a member; the card disappears; their context switches to the new group.
6. On `Decline` → the card disappears; no group membership created; the inviter is *not* notified of the decline.
7. **Inviter can revoke a pending invite.** If the inviter changes their mind, they can remove the pending record before the invitee acts.

### Bulk in-app invites: explicitly NOT in MVP

The MVP supports inviting one follower at a time via in-app push (Flow C). Inviting many at once via the in-app affordance is post-MVP. However, **bulk-via-link** is implicitly supported in MVP: one invite link with `redemptionCap: null` (unlimited) can be redeemed by many users, achieving the same outcome.

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

- **Same knocker, multiple knocks:** the 20s timer resets each time a new knock from the same person arrives. The card stays at the top for at least 20s after the last knock.
- **Multiple different knockers:** each gets its own 20s anchor window. They stack at the top of the list in order of most-recent-knock first.

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

All group-related user state syncs across the user's devices using the existing `watchStatus` subscription pattern (the same mechanism that syncs status color, palette, time-chip selection, etc. in the v2 identity work).

### State that syncs

- **Group memberships:** the user's `groups/{groupId}` sub-records (including role and display name per group).
- **Per-group status overrides:** the toggle state plus override status, color, palette per group.
- **Current context:** which group (or `direct`) the user is in. Set via the watchStatus callback when the user navigates.
- **Pending in-app invites (Phase 3):** if Alice has two devices and Bob invites her to Family, both devices show the inline card; accepting on one device clears it on the other.
- **Group cards order** (derived): naturally derived from currentContext history; not a separately-stored field but observable from history.

### What does NOT sync

Things that are purely UI state, not user state:

- Which group card is currently visually selected vs not (this is just the rendering of currentContext, which does sync).
- Scroll position within a context.
- Whether the user has dismissed an ephemeral toast.

### Initial sync on app boot

When a user opens the app on a new device for the first time after restoring identity:

- watchStatus fires with the full user record on first tick.
- All synced state is applied: group memberships are loaded, currentContext is restored (or falls back to Direct if invalid), per-group overrides are applied, pending invites are shown.

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

The existing flags continue to gate their respective features. There is no separate flag for sub-features within groups (e.g., no separate flag for per-audience status overrides, knock-via-group-context, etc.).

### Post-MVP eligibility relaxation is NOT a new flag

The post-MVP behavior where co-members can use 1:1 primitives (knock, call, canvas, palette adoption) with each other *without* being mutuals is implemented as a widening of the existing eligibility check in those features' code paths — *not* as a new feature flag. The check changes from "is this user a mutual?" to "is this user a mutual OR a co-member?" The features themselves remain gated by their existing flags.

## 16. Phasing

The work is broken into shippable phases, each producing a usable feature on its own.

### Phase 0 — Invite-link infrastructure (1:1 follow-me)

This phase ships **without groups existing.** It introduces the invite-link primitive and uses it for 1:1 follow-me invitations.

What ships:
- Invite-link primitive in Firebase (scope discriminator, token, TTL, redemption cap, revocation field, redemptions counter).
- Lifecycle operations: create, revoke, regenerate.
- URL parsing and redemption flow.
- Personal-scope redemption (`scope: 'personal'`): redemption establishes a follow from redeemer → creator.
- Brand-new user onboarding via personal-scope link (welcome screen says *"You've been invited to follow Alex"*).
- Friendly failure messages for revoked / expired / capped links.
- `GROUPS_ENABLED` flag is added but only gates group-scope behavior; personal links work regardless of the flag.

What ships as a side effect: a user can now replace "exchange share codes verbally" with "share an invite link" for the 1:1 follow case. This is a useful standalone feature on its own.

**Why this phase first:** validates the invite-link infrastructure before groups are layered on top. If anything's wrong with the link mechanics, it surfaces in Phase 0 where the blast radius is small.

### Phase 1 — Groups minimum

This phase introduces the group entity and the core group-related UI. The status model is **still single-status** in this phase — every group sees the user's primary status. Motivation B is fulfilled; C+A is not yet.

What ships:
- Group entity in Firebase (id, name, owner, member list, createdAt).
- Owner-only group operations: create, rename, delete.
- Member notification on group deletion (a brief "'Family' has been deleted" notice in their app).
- Group-scope invite links (uses the Phase 0 primitive with `scope: 'group:{id}'`).
- Existing-user link redemption: silent auto-join, lands in group context.
- New-user link redemption: α' welcome screen + secret-phrase modal + "Your name in 'Family'" display-name step.
- Member operations: see roster, edit own display name, leave the group.
- Navigation infrastructure: group cards row at top of Direct context (with `+` and zero-state CTA), `←` breadcrumb in group context.
- Persistent current-context across sessions and devices (via watchStatus pattern).
- Cross-device sync of group memberships and display names.
- Knock-via-group-context: pulse animation + float-to-top anchor.
- Float-to-top behavior also applied to direct contacts (latent issue addressed).
- Group card indicator badge for pending knocks.
- `GROUPS_ENABLED` flag now gates group-scope UI.

What's still missing (and added in later phases):
- Per-audience status overrides (Phase 2).
- In-app push invites (Phase 3).
- Admin role (post-MVP).
- Group color/palette customization (post-MVP).

### Phase 2 — Per-audience status overrides

This phase adds the multi-status model on top of the Phase 1 foundation. Motivation C+A is now fulfilled.

What ships:
- "Set a unique status" toggle per audience (each group, plus the followers audience).
- Toggle defaults OFF; ON → audience-specific status, initial value Unavailable.
- Header status chip in any context now controls *that context's* status (primary in Direct; override in group with toggle ON).
- Group card visual styling reflects the user's override color/theme when override is ON; neutral when OFF.
- Group context view shows the user's override status on their own card (if visible in the roster).
- Member roster in any context shows each member's context-appropriate status (their override if toggle ON, else their primary).

### Phase 3 — In-app push invites

What ships:
- In-app invite flow (Flow C in §10).
- Inviter selects a follower → picks group → invite sent.
- Recipient sees inline card at top of main list with Join / Decline.
- Inviter can revoke pending invites.
- Multi-device sync of pending invites.

### Phase 4+ — Post-MVP polish

These items are documented but not in MVP. Rough priority order:

- **Admin role + permissions.** The data model accommodates `role: 'admin'` from Phase 1; this phase activates the role.
- **Owner ownership transfer.** Allow owners to hand off to another member; enables the owner to leave.
- **Group color/palette semantics.** Owner-configurable between:
  - **Mode B (member uniform):** members appear in the group's color when viewed in that group's context.
  - **Mode C (default suggestion):** group's color is suggested as the default status color for new members; they can still override.
- **Confirmation card on existing-user link redemption.** Instead of silent auto-join, show a *"Join 'Family'?"* card before adding the user.
- **Request-to-follow.** From a non-mutual co-member's card, send a follow request the target can accept or decline. Establishes 1:1 follow.
- **Pending/approval moderation gating.** Group can be configured to require admin approval before new joiners are admitted.
- **Bulk in-app invites.** Invite multiple followers at once.
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

## 17. MVP scope

**MVP = Phases 0 + 1 + 2.**

This delivers:
- Invite-link primitive and 1:1 follow-me invites (Phase 0).
- Group entity, owner-only ops, group invites, member operations, navigation, knock-via-group-context (Phase 1).
- Per-audience status overrides (Phase 2).

Both motivations B and C+A are fulfilled. Motivation D (onboarding via link) is also served — new users join via either a personal link or a group link.

Phase 3 (in-app invites) and Phase 4+ (post-MVP polish) ship after.

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

## 19. Implementation considerations (notes for the implementation plan)

These aren't design decisions; they're notes for whoever writes the implementation plan.

- **Group ID generation:** transactional claim against `groupIdIndex/{groupId}`, retry on collision. Same pattern as `codeIndex` for share codes.
- **Invite token format:** URL-safe random string with high entropy. Suggested: 22 chars from `base64url` (128 bits of entropy). Validated by exact match; no decoding needed.
- **Firebase RTDB rules:** the existing rules allow any-user read/write to `users/$userId`, `codeIndex/$code`, `canvases/$canvasId`. Groups will need analogous rules for `groups/$groupId/...`. The MVP can use similarly permissive rules; a future "Phase B identity work" (documented in the v2 recovery-code spec) would tighten these to `auth.uid`-based rules.
- **Performance of large groups:** with `members/{uid}` as a sub-record under `groups/{groupId}`, listing all members is O(n). At 100 members this is fine; at 10,000 it isn't. Defer optimization until needed.
- **Existing canvas / call / knock code:** unchanged in MVP. Groups don't refactor them.
- **Test infrastructure:** new Firebase reads/writes need to be mocked in the appropriate test files (`tests/following.test.js`, `tests/me.test.js`, etc.). New exports from `js/db.js` particularly need their mocks updated.
- **Cross-device sync:** reuses the `watchStatus` callback in `js/app.js`. Each new piece of synced state adds a `syncXFromServer(...)` function called from that callback, following the pattern established by paletteState, favorites, following, and the others.
- **Migration:** existing users have no `groups` records. The Phase 1 code must handle the empty case gracefully — `users/{uid}/groups` may not exist on read.

## 20. References

This design draws on patterns established in adjacent specs:

- **`docs/superpowers/specs/2026-05-25-recovery-code-design.md`** — defines the v2 secret-phrase identity model that this feature builds on. Cross-device sync infrastructure assumed by this spec.
- **`docs/superpowers/specs/2026-03-23-call-canvas-design.md`** — defines the 1:1 canvas behavior referenced in §12 ("communication primitives in groups").
- **`js/features.js`** — current feature flags. The new `GROUPS_ENABLED` flag is added here.

End of specification.
