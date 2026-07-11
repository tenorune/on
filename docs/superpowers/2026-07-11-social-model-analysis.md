# KnockKnock — Social Model Inventory & Analysis

**Date:** 2026-07-11 · **Phase 1 of 2** (stops at the values-ruling checkpoint)
**Spec:** `docs/superpowers/specs/2026-07-11-social-model-analysis-design.md`
**Lens:** social and UX, not technical. Code citations are evidence, not subject matter.
**Method:** five parallel source sweeps (edge formation, capabilities, legibility, notifications, lifecycle/parity), load-bearing claims re-verified against source. Arrival flows are referenced to the invite-arrival spec (`docs/superpowers/specs/2026-07-10-invite-arrival-flows-design.md`), not re-derived.

**How to read this:** Part I is descriptive — what the app does today, no judgments. Part II is the centerpiece: the value set the app *actually embodies*, derived from Part I's evidence, framed for ruling (keep / amend / reject per principle). Findings (`SM#n`) and the target model are Phase 2, built only on the ruled values.

---

# Part I — Inventory

## I.0 Vocabulary: relationship states and where they live

| State | Meaning | Storage | Notes |
|---|---|---|---|
| **Follower** (X→Y) | X watches Y | `users/{Y}/followers/{X}=Xcode` + `userPrefs/{X}/following/{Y}={code,label}` (`js/db/social.js:204,255`) | One-way. Two co-written records, one per side. |
| **Mutual** (X↔Y) | both directions exist | *no record* — computed as the intersection of my followers and my following (`js/following.js:342`) | Mutuality is emergent, never declared. |
| **Co-member** | X and Y share a group | `groups/{gid}/members/{uid}` (`js/groups.js:126`) + private nav entry `users/{uid}/groups/{gid}` | Membership is per-group; no cross-group linkage. |
| **Owner–member** | Y owns a group X is in | member `role:'owner'` + `groups/{gid}/ownerId` (`js/groups.js:48-49`) | Exactly one owner; no transfer path, no admin tier. |

A correction to the origin story: the share code is **6** characters, not 5 (`js/identity.js:9`; validation `js/following.js:287`).

## I.1 Edge formation — twelve mechanisms, three consent models

| # | Mechanism | Edge | Who initiates | Consent model | Identity attached | Surfaces |
|---|---|---|---|---|---|---|
| 1 | Manual code entry (add-form) | follow | adder | **Unilateral-instant** — edge written the moment the adder submits (`js/following.js:1277-1286`); target never asked | adder's private label for target; target sees only the adder's code | web / PWA / Mini App |
| 2 | Paste invite link in add-form | follow or membership | redeemer | routes into 3/4 (`js/following.js:1174-1238`) | per 3/4 | web / PWA / Mini App |
| 3 | Personal invite link `?i=` | follow (redeemer→creator) | creator shares, redeemer taps | **Link-as-consent** — auto-redeems at boot (`js/invites.js:132-171`); the shared link *is* the creator's standing consent | creator's `creatorLabel` seeds redeemer's label (`js/invites.js:162-167`); redeemer's Telegram first name published back to creator (`js/db/social.js:221-223`) | web / PWA / Mini App (via 11) |
| 4 | Group invite link | membership | owner shares, redeemer taps | **Link-as-consent** — joiner writes their own member record, no owner approval (`js/groups.js:108-139`) | redeemer picks their per-group `displayName`; invite carries **no inviter identity** (`js/inviteModal.js:26-28`) | web / PWA / Mini App (via 11) |
| 5 | In-app picker invite (pendingInvites) | membership | group owner (UI); rules would allow any member (`database.rules.json:142` vs `js/groupContext.js:138`) | **Two-sided** — inviter writes only a *pending* record; invitee consents at Inbox Join (`js/inbox.js:295-344`) | invitee names themself at Join; inviter shown by invitee's own label → group name → "Someone" | picker: all app surfaces; Join/Decline also in bot (9) |
| 6 | Request-to-follow (group roster) | follow (requester→target) | requester | **Two-sided** — target Approves via grant; requester's device completes the follow (`js/followRequests.js:122-142`) | grant carries approver's code + group displayName, seeding requester's label | all app surfaces; Approve/Decline also in bot (10) |
| 7 | Follow-back (Followers row `+`) | follow (→ mutual) | followee | **Unilateral-instant** — prefills add-form, routes into 1; no approval (`js/following.js:851-857`) | label prefilled from remembered roster name | web / PWA / Mini App |
| 8 | Group creation | ownership + membership | creator | unilateral (self) | group name + own displayName; immediately opens invite modal seeded with creator's followers (`js/groupNav.js:505-518`) | web / PWA / Mini App |
| 9 | Bot [Join] button | membership | invitee (consuming 5) | two-sided (the consent side of 5) | displayName auto-filled from Telegram first name, no prompt (`functions/telegram.js:587`) | bot DM |
| 10 | Bot [Approve] button | follow | target (consuming 6) | two-sided (the consent side of 6) | grant carries code + shared-group displayName (`functions/telegram.js:656-657`) | bot DM |
| 11 | Mini App `startapp=` deep link | follow or membership | redeemer | link-as-consent, with an added interstitial for unlinked users (Accept / phrase / Not now, `js/telegramFirstRun.js:63-174`); linked accounts redeem **silently** (`:164`) | Telegram first name rides along both directions | Mini App |
| 12 | N8 pitch (`/about?i=&pitch=1`) | none — reading funnel back into 11 (`js/telegramFirstRun.js:91-95`) | — | — | — | Mini App |

**Three consent models coexist:**
- **Unilateral-instant** (1, 7): possession of a code is authorization; the edge exists before the other party knows.
- **Link-as-consent** (3, 4, 11): the sharer's act of sharing is standing consent to be followed / joined; redemption is automatic.
- **Two-sided** (5, 6): an explicit pending record + an explicit accept. Notably, **both two-sided mechanisms are late additions and group-scoped**; nothing in the Direct world is two-sided.

**Other formation facts worth holding:**
- The picker can target **only the inviter's own followers** — rows are built exclusively from `getCurrentFollowersMap()`/`getCurrentMutuals()` (`js/groupContext.js:162-163`, `js/invitePicker.js:47-58`). There is no way to push-invite by code.
- The invite-to-group row is **owner-only in the UI** while the database rules permit **any member** to write a pending invite (`js/groupContext.js:138` vs `database.rules.json:142`). The UI is stricter than the contract.
- Joining a group (any path) defaults the joiner to **override ON, available for 2 hours** (`js/groups.js:126-134`) — a presence broadcast bundled into the join. Via the bot the disclosure exists but arrives after the fact (`functions/telegram.js:601-606`); via links the interstitial/spec covers arrival, but the 2h broadcast itself is not separately consented anywhere.
- Membership is always **written by the joiner themself** (link, bot, Inbox Join) — except that in mechanism 5 the *pending* record is the inviter's write. There is no path where someone else places you in a group.

## I.2 Capability matrix — what each tier can do

Feature flags are all hard-coded on (`js/features.js:2-8`).

| Tier (A's view of B) | Knock | Call | Long-press | See presence | Name them | Request-to-follow |
|---|---|---|---|---|---|---|
| Stranger | — | — | — | — | — | — |
| **A follows B** (A's side) | no | no | palette adoption | **yes** | **yes** (private label) | n/a |
| **A follows B** (B's side, of A) | no | no | no | **no** | no | Follow-back `+` (automatic) |
| **Mutual** | **yes** (tap card) | **yes** (swipe right) | palette adoption | yes (both ways) | yes | n/a |
| **Co-member** (no follow edge) | **yes** (tap roster row) | **no** | palette adoption (needs own active override) | **yes** (group-effective availability) | no (self-`displayName` only) | **yes** (circled-plus, declinable) |
| Co-member + mutual | yes on both surfaces | Direct only | both | both (independently) | Direct label + their group displayName | hidden (already following) |
| Owner ↔ member | as co-member | no | as co-member | as co-member | rules would allow owner to rename a member; **no UI** (`database.rules.json:80-83`) | owner additionally has the invite row |

**Where the gates live:** every tier restriction above is **client-UI only**. The database rules gate on identity (are-you-a-party, are-you-a-member) but never on relationship for knock or call — any authenticated user could knock or call anyone with a modified client (`database.rules.json:88-99` knocks, `:159-169` calls). Cloud Functions gate *notifications* on the recipient's per-person opt-in, never on tier. The social model is enforced by affordance, not by contract.

**The two operator-named anomalies, confirmed:**
- Knock: Direct requires mutual (`js/following.js:692` `if (KNOCK_ENABLED && isMutual)`); group roster requires only co-membership (`js/groupContext.js:219` `if (KNOCK_ENABLED)`, no tier check).
- Call: mutual-only, Direct-only (`js/following.js:702`); groups have no call at all (`js/groupContext.js:198-199`, deliberate comment).

**Presence asymmetry:** presence data is world-readable at the rules layer (`database.rules.json:14`), but the UI subscribes only to *followees* (`js/following.js:431`). So: A follows B → **A sees B's presence; B sees nothing of A** (A is a code-only row with no dot, `js/following.js:831-868`). Presence flows *toward the person who chose to watch*.

**Long-press** exists in exactly two places, both palette adoption (copying the other person's status color onto yourself): any Direct followee row (`js/following.js:777-805`) and any group roster row *if you have an active override* (`js/groupContext.js:250-290`). It is a self-affecting act, not a social act — nothing is sent to the other party.

## I.3 Legibility — what the other side sees

### Name sources (five, with different owners)

| Source | Who writes it | Who sees it | Cite |
|---|---|---|---|
| Share code | system (rotatable by owner) | everyone, everywhere, as fallback | `js/db/social.js:300` |
| Following label | the **viewer**, privately | only the viewer | `js/db/social.js:255` |
| `creatorLabel` (personal invite) | the **inviter**, about themself | the redeemer, at arrival and as their initial label | `js/invites.js:86-89, 160-167` |
| Group `displayName` | the **member**, about themself, per group | co-members of that group only | `js/db/groups.js:136-138` |
| `followerNames` | the **redeemer**, about themself, at redemption | the inviter (their Followers row shows `CODE (Name)`) | `js/db/social.js:221-223` |

**The structural rule that falls out:** *you control what strangers first call you (creatorLabel, displayName, followerNames — all self-authored), but once someone follows you, what they call you is their private business (label), and you can never see it.* Notification copy uses the viewer's own label first (`functions/notifier.js:80-94`), so even server pushes speak in the recipient's private vocabulary.

### Act visibility — what the other party experiences, per act

| Act | Other party sees | Silent? |
|---|---|---|
| Follow (code or link) | a new Followers row (code, `+ (Name)` if published) — no push, no toast | **silent** (passive UI change only) |
| Unfollow | Followers row vanishes; if mutual, their own follow survives | **silent** (copy promises it: "They won't be notified.", `js/following.js:129`) |
| Evict a follower | their client silently auto-drops their follow of you (revocation watcher, `js/following.js:176-189`) | **silent, forced** |
| Knock | push "{name} knocked" (per-sender opt-in + 30s cooldown) + card pulse | notified |
| Call | push "{name} is calling" (opt-in) + live answer row | notified |
| Request-to-follow | push "{name} wants to follow you" (**no opt-in gate**) + Inbox row | notified |
| Picker invite | push "{name} invited you to {group}" (**no opt-in gate**) + Inbox row | notified |
| Accept invite / join via link | new roster row appears; **inviter is not told** (`groups-design.md:952`) | silent |
| Decline invite | pending row deleted; inviter never told | **silent** |
| Approve follow-request | requester's device completes the follow; new named card just appears; no push | silent-but-visible |
| Decline follow-request | nothing — requester's local "Requested" state persists indefinitely (`js/followRequests.js:8-11`) | **silent, illegible** |
| Revoke invite link | future taps see "this link has been revoked"; nobody notified; redeemed edges untouched | silent |
| Rotate code | followees' mirrors updated; **your followers keep a stale code for you** (`js/db/social.js:316-320`); old code stops resolving | silent |
| Leave group | roster row disappears | silent |
| Delete group | every member gets a toast "'{name}' has been deleted." + auto-cleanup (`js/groups.js:178-181`) | toast (the one loud teardown) |
| Kick (unbuilt) | detection code exists: "You've been removed from '{name}'." (`js/groups.js:176-185`) | (toast, when built) |

**The pattern:** the only acts that interrupt the other party are **knock, call, invite, follow-request** — presence and invitation. All bookkeeping (edges forming, edges dissolving, declines, revocations) is silent. Group deletion is the single exception.

### Audience awareness — do you know who watches you?

The origin design said no ("Bob is unaware unless he also adds Alice", `groups-design.md:12`). Today:

1. The Direct list has a dedicated **Followers section** listing everyone who follows you, by code (+ name when self-published), with Follow-back and Remove buttons (`js/following.js:424, 831-867`).
2. The group **invite picker enumerates your followers** — including non-mutuals — as invite targets (`js/invitePicker.js:55-58`).
3. **Follow-request rows** reveal would-be followers pre-consent (`js/inbox.js:237`).

So the origin's audience-invisibility is fully gone in behavior — replaced by "you can see *that* they follow you and their code/name, but never what they call you, and their presence is not shown to you."

### Self-presentation predictability

- Sharing a **link**: predictable — you know the redeemer will see your `creatorLabel` at arrival, and it seeds their label for you.
- Sharing a **bare code**: unpredictable — no identity channel at all; the adder types their own label and you appear as a bare code in their world (`js/following.js:1240-1290`).
- After redemption: unpredictable by design — the other side may rename you freely and you can never see it.
- No surface anywhere previews "how you'll appear to them."

### Vocabulary — where one symbol covers two meanings

| Symbol | Meaning 1 | Meaning 2 | Cite |
|---|---|---|---|
| **Circled plus** | Follow-back: *automatic*, no consent (text `+` in a CSS circle, `js/following.js:845`, `css/app.css:731-745`) | Request-to-follow: *declinable request* (SVG circle+plus, `js/followRequests.js:62`, `css/app.css:1319-1325`) | operator seed, confirmed |
| **×** | Unfollow (leave, self-directed; reverse edge survives) | Remove follower (evict, other-directed; forcibly tears down their follow) | `js/following.js:673-675` vs `:849, 859-865` |
| **"Invite"** | share a link (standing consent) | send a directed in-app invitation (pending + accept) | plus "Share on/to Telegram" as a third framing; `js/inviteModal.js`, `js/invitePicker.js:126` |
| **Knock labels (bot)** | "Knock back" (reply to a knock) | "Knock" (react to availability) | same act, `functions/telegram.js:29-32` — here the *labels* differentiate what the app elsewhere merges |

## I.4 Notifications — who is interrupted, and how

One channel per person: a Telegram-linked user gets bot DMs (unless they opted for push), everyone else gets web push; never both (`functions/notifier.js:33-77`). All server notifications flow through six triggers (`functions/index.js:109-156`); **no trigger watches followers, grants, membership, deletion, or revocations** — those are structurally incapable of notifying.

| Event | Recipients | Gate | Telegram extra |
|---|---|---|---|
| Knock | the knocked | per-sender opt-in + 30s cooldown | [Knock back] button |
| Call | the callee | per-caller opt-in + 30s | [Answer] deep link |
| Availability (direct) | **all followers** who opted in for that person | per-person opt-in + 5min | [Knock] button |
| Availability (group) | co-members who opted in (override-dependent routing) | per-person opt-in + 5min | [Knock] button |
| Picker invite | the invitee | **none** (cooldown only) | [Join]/[Decline] inline |
| Follow-request | the target | **none** (cooldown only) | [Approve]/[Decline] inline |

Two observations with social weight:
- **Warm signals are opt-in; asks are unconditional.** Knock/call/availability all require the recipient to have opted in per-person; invite and follow-request always land (`functions/notifier.js:121-151`, comment: "directed and consensual, so there's no per-person opt-in gate").
- **Telegram recipients can act socially from the notification** (join, approve, knock back) without opening the app; web recipients can only tap through. The bot is a *social surface*, not just a delivery channel.

## I.5 Lifecycle — how edges end

Covered in the act-visibility table above; the structural asymmetries:

1. **Unfollow vs evict are different operations wearing the same ×.** Self-unfollow removes only your own watch (their follow of you survives; no revocation, `js/db/social.js:263-268`). Evicting a follower *forces* the teardown of their outbound follow via the revocations mailbox (`js/db/social.js:271-274`) — the one place the app reaches into someone else's relationships. Both silent.
2. **Rotation is asymmetric:** your new code propagates to people *you* follow, but people who follow *you* keep the stale code forever (cosmetic only — the relationship is uid-keyed and survives) (`js/db/social.js:316-320`).
3. **Invite teardown never touches redeemed edges** — revoke/regenerate only kills unredeemed links (`js/invites.js:101-114, 345-356`).
4. **Declines don't exist for the other side.** Both decline paths delete the record and tell nobody; the follow-requester's device shows "Requested" indefinitely (localStorage; cleared only by cancel, success, or storage wipe — `js/followRequests.js:8-11`, issue #181 I5).
5. **Kick is half-built:** no UI invokes `removeMember` for another person (#180), but the receiving side would show a distinct "You've been removed" toast (`js/groups.js:176-185`).
6. **Account-level:** graduation *moves* an identity (every edge survives, `functions/telegram-auth.js:372-426`); unlink/link-replace *expunges* (every edge silently destroyed on both sides, owned groups deleted whole, `:261-305`). Web has no account deletion at all.

## I.6 Surface parity — web vs Telegram Mini App vs bot

**Interactions have total parity.** No `isTelegramContext()` branch touches knock, call, long-press, presence, naming, inbox, or request-to-follow. The webview quirks are cosmetic.

**Formation and management diverge:**

| Mechanism | Web | Telegram Mini App |
|---|---|---|
| Personal invite | full modal: create, copy, regenerate, revoke, rename label | straight to native share sheet; auto-mints with Telegram first name as label (`js/mycode.js:126-161`). **No manage surface at all** (#286) |
| Group invite | link UI + picker | one "Share on Telegram" button; create/manage hidden; empty-picker case skips the modal entirely (`js/inviteModal.js:105-139, 253-262`). Same #286 gap |
| Invite arrival | boot-gate redeem; `/about` welcome for new users | interstitial for unlinked (Accept / phrase / Not now); **silent redemption for linked accounts** (`js/telegramFirstRun.js:141-174`) |
| In-app "invite to follow me" surface | modal exists but reachable only via drawer (operator seed: no first-class in-app affordance) | share sheet only |
| Identity | no account deletion; onramp to Telegram | graduation / unlink / replace |

**The bot is a third surface** with its own asymmetries: it can *consent* (Join, Approve) and *react* (Knock back) but cannot *initiate* edges (no create-group, no invite, no follow) — commands are status/knock/who only (`functions/telegram.js:72-80`). A bot-side join auto-names you (Telegram first name) and auto-broadcasts 2h availability, disclosed after the fact (`functions/telegram.js:587, 601-606`).

---

# Part II — The derived value set

What follows is reconstructed **from behavior**, not from any stated intention. Each principle is phrased as a testable rule, with its conforming and violating evidence from Part I. The violations are not (yet) findings — whether they are bugs or evolution is exactly what the ruling decides.

**For each principle, rule: KEEP (canonical — Phase 2 judges deviations as findings) / AMEND (re-word it; say how) / REJECT (not a value — deviations from it are fine).**

---

### P1 — Presence flows toward those who chose you. *"You are visible to the people you decided to let watch."*

Following someone means *they* chose to watch *you*... inverted: adding someone means *you* chose to watch *them*, and visibility follows the watcher's choice, not the watched's grant — the code/link you handed out was the grant.

- **Conforms:** Direct presence is subscribed only for followees; your followers see nothing of you unless you follow back (I.2). Availability pushes go only to followers who additionally opted in (I.4).
- **Strains:** groups — joining a room makes you visible to *everyone already in it* (and them to you) with no per-person choice; the join even broadcasts 2 hours of availability by default (I.1), silently on the bot path (B#6, prior analysis).
- **The question under it:** is group visibility a *deliberate second contract* ("a room is mutual exposure — that's what a room is") or an unexamined leak of the Direct contract?

### P2 — Possession of the key is consent. *"Anyone holding your code may follow you; sharing it is the grant."*

The original ANN model: consent is embodied in the artifact (code/link), not in a per-event approval.

- **Conforms:** manual code entry writes the edge instantly, no approval (I.1 m1); invite links auto-redeem at boot (m3/m4); follow-back is instant (m7).
- **Contradicts:** request-to-follow (m6) introduced the *opposite* model — an explicit, declinable ask — but only for group co-members. The app now runs **two consent philosophies side by side**, and the circled-plus icon collision (I.3 vocabulary) is the visible symptom: the UI itself cannot tell the two models apart.
- **The question under it:** is key-possession still the canonical consent model (and request-to-follow a necessary exception for people who *don't* have your key), or is per-event consent the direction the model is drifting toward?

### P3 — Naming flows outward; self-presentation is claimed at the doorway. *"You choose what strangers first call you; the people who know you decide privately what to call you; nobody can rename you."*

- **Conforms:** every first-contact string is self-authored (creatorLabel, group displayName, followerNames); every ongoing label is viewer-private and invisible to its subject; even notification copy speaks in the recipient's own private vocabulary (I.3).
- **Strains:** bare-code sharing has no self-presentation channel at all (you arrive as a naked code); group invites carry no inviter identity; the bot auto-claims your Telegram first name without asking (m9); rules would let a group owner rename members (no UI — dormant contradiction).
- **The question under it:** is the doorway-claim + private-labels split a value worth defending (it is unusual and quietly excellent), or an accident of accretion?

### P4 — Departures are silent. *"Nothing announces an ending: no unfollow, eviction, decline, revocation, or leave is ever heralded."*

- **Conforms:** remarkably, everything — unfollow, evict, both declines, revoke, rotation, leave (I.5). The one exception (group delete toast) is arguably infrastructure, not social messaging. Even the *copy promises it*: "They won't be notified."
- **Cost:** silence produces **illegible states** — the requester who shows "Requested" forever after a decline (#181 I5); the inviter who never learns their invitation was declined; the evicted follower whose contact simply stops existing without explanation.
- **The question under it:** is silence-on-endings a core kindness (no shame, no confrontation) worth keeping *even at the cost of ambiguity*, or should the model distinguish "silent to the other party" from "legible to yourself" (the decline could clear the requester's badge without saying who/when/why)?

### P5 — Only warmth interrupts. *"A push means presence or an invitation — never bookkeeping."*

- **Conforms:** the six triggers are knock, call, availability, invite, follow-request. New follower: silent. Accept: silent. All teardown: silent (I.4).
- **Strains:** within the warm set there's an inconsistency — knock/call/availability require per-person opt-in, but invite and follow-request are **unconditional** (the code comments call them "directed and consensual"). An ill-wisher co-member could ping you with requests/invites you never opted into (rate-limited only).
- **The question under it:** confirm the boundary (presence + invitations interrupt; graph changes never do), and decide whether "asks" belong to the opt-in regime or genuinely above it.

### P6 — The audience became visible. *"You can see who follows you (code and name), but never what they call you, and following you earns them no visibility of you."*

The origin value ("ANN does not have visibility into who is following") is **gone in behavior** — Followers section, follow-back button, invite picker enumeration (I.3). What actually survives is a narrower privacy: labels stay private, presence stays unearned.

- **The question under it:** ratify the current compromise as the value (P6 as stated), or is the picker's enumeration of non-mutual followers as invite targets (the operator's picker anomaly) already *past* the comfortable line?

### P7 — A group is a room, not a network. *"Joining a room exposes you to the room, gives you room-scoped gestures, and leaves no trace when you leave."*

- **Conforms:** per-group self-chosen displayName; group-effective availability distinct from primary presence; roster knock without any follow edge (a shoulder-tap is a *room* gesture); request-to-follow as the explicit doorway from room-acquaintance to direct relationship; leave/delete cleanly evaporate the exposure; co-membership grants nothing outside the room.
- **Strains:** the room metaphor makes co-member knock *coherent* (it is not an anomaly under P7 — the operator's "why can members knock?" has an answer: because you're in the same room). But then **call's absence from rooms** needs a reason: is call a strictly intimate (mutual) gesture by *value*, or just unbuilt? Similarly the owner's picker being limited to *their own followers* means the room can only grow from the owner's personal graph — a network-shaped restriction on a room-shaped feature (and the rules already permit any member to invite; only the UI forbids it).
- **The question under it:** is the room metaphor canonical? If yes, Phase 2 judges: co-member knock ✓ correct, member-invite ✗ wrongly restricted to owner, call-in-rooms = a deliberate absence to re-affirm or a gap.

### P8 — Reciprocity earns intimacy. *"The closer gesture requires the more mutual bond: watch < knock < call."*

- **Conforms:** in Direct — following grants seeing; mutuality grants knocking and calling (I.2). The ladder is real.
- **Collides with P7:** co-member knock jumps the ladder (no follow at all). P7 and P8 are *both* live in the code and they disagree about knock — this is the operator's original anomaly, restated: **the app has a proximity ladder in Direct and a room model in groups, and knock sits in both with different prerequisites.**
- **The question under it:** when P7 and P8 conflict, which wins? (Or: are they scoped — P8 governs Direct, P7 governs rooms — and the *scoping itself* is the grand rule?)

### P9 — The invitation carries the warmth. *"Relationships arrive pre-named because someone reached out; cold adds arrive bare."*

- **Conforms:** links carry creatorLabel; grants carry name+code; Telegram arrival publishes first names both directions; bare-code adds (the coldest path) attach nothing (I.3).
- **Strains:** group links carry no inviter identity at all — the invitee joins a named room from an anonymous hand; the in-app "invite to follow me" surface is missing entirely (operator seed: link/share-sheet exist, no first-class in-app affordance), making the warmest direct mechanism oddly hard to reach from inside the app.
- **The question under it:** is "warmth attaches at the invitation" worth completing (inviter identity on group invites, an in-app invite surface), or is anonymity-by-default fine?

### P10 — The model is enforced by affordance, not by contract. *"The UI is the ruleset; the database trusts the client."*

Every tier gate is client-side; rules check identity only (I.2). For a small trusted user base this is a *choice with social meaning*: the system assumes good faith and spends its rigor on consent-shaped UI instead of server-side walls.

- **The question under it:** ratify as a value (with eyes open — #288 F2 documents where it bites), or treat capability rules as contract-worthy the moment they carry social meaning (call-requires-mutual etc.)? This ruling shapes whether Phase 2's target model speaks only of UI or also of rules.

---

## The three cross-cutting tensions (preview of Phase 2's agenda)

1. **Two consent models** (P2 vs the request/accept pattern) — visible today as the circled-plus collision.
2. **Ladder vs room** (P8 vs P7) — visible today as mutuals-call / co-members-knock.
3. **Silent endings vs legible state** (P4) — visible today as the immortal "Requested" button and the never-informed inviter.

---

# CHECKPOINT — ruling requested

For each of **P1–P10**: **keep / amend (how) / reject.** Where a principle poses "the question under it," a sentence of guidance is enough. Phase 2 (findings `SM#n` + target model) proceeds only on the ruled set.

---

# Ruling pass 1 — operator rulings (2026-07-11)

P1 **KEEP** — group visibility is a deliberate second contract: less intimate, different consent, and a consciously different identity/presence (per-group name, independently overridable status).
P2 **KEEP** — request-to-follow, arriving in the group context, "is like asking for the key."
P3 *(deferred — jargon unclear)* → clarified ("doorway string" = the name shown at first contact; all are self-authored) → ruled **KEEP (A)**.
P4 **AMEND** — the actor's own consent actions (accept, deny, leave, join) must be legible *to themself* first; legibility to others is secondary.
P5 **KEEP** — asks could belong to the opt-in regime, but no further examples; boundary confirmed.
P6 **AMEND (held loosely)** — follower visibility "seemed like a good idea"; the implication ratified is: no interest or need to know the follower's status.
P7 **KEEP** — a room, yes; ownership is **curatorial** (quasi-intimate, not public, limits on who enters; currently controlled by one). Calling was meant to be intimate, knocks less so — "but I am not so sure."
P8 **KEEP** — see P7's note (scoping supplied there).
P9 **AMEND** — "seems like a recommendation of parity more than a principle" → demoted.
P10 **KEEP** — database rules are for security and privacy, not social meaning.

---

# Part II — revision 2 (the ruled set, for the second pass)

Rendered interactively in `2026-07-11-social-model-analysis-v2.html`. Changes from v1 flagged per principle.

**P1 — Two presence contracts.** *Direct:* presence flows toward those who chose you — you are visible to the people you handed your key. *Room:* joining a group is a conscious act of mutual exposure under a separately chosen identity — per-room name, per-room status, overridable independently of Direct. Deliberate, less intimate, room-scoped. *(Kept; "second contract / conscious identity" guidance folded in.)*

**P2 — Possession of the key is consent; asking is requesting the key.** One consent model, two acquisition paths: holding someone's code/link *is* the grant; request-to-follow is the sanctioned way to ask for a key you don't hold (today offered only inside rooms). Derivation made explicit: **following someone necessarily hands them your key** (the act writes your code into their world) — which is why follow-back is automatic and legitimate. *(Kept; the reframe dissolves the "two consent philosophies" tension.)*

**P3 — You pick the name you're introduced by.** Every first-contact name (invite label, room display name, redeemer's published name) is chosen by the person it describes. After first contact the rule flips: what people call you is their private business, invisible to you, and nobody can ever rename you. *(Kept, ruled A; jargon removed.)*

**P4 — Your consent actions are legible to you first.** *(Amended.)* Accepting, declining, joining, leaving — the actor must always be able to see what they did and where it stands. Legibility to the other party is secondary; silence toward them remains the default. Silence to others, clarity to self.

**P5 — Only warmth interrupts.** A push means presence (knock, call, availability) or an invitation (invite, follow-request) — never graph bookkeeping. Directed asks sit above the per-person opt-in regime as inherently consensual acts. *(Kept as-is.)*

**P6 — Followers are visible as facts, not as presence.** *(Amended, held loosely.)* You may see *that* someone follows you — code and name — but their following you earns them no visibility of you, and gives you no window into their status. Provisional by the operator's own note; Phase 2 treats the line as re-drawable. Open thread attached: does the picker's enumeration of non-mutual followers sit on the right side of this line?

**P7 — A room is curated and quasi-intimate.** Not public: someone gates who enters — today the curator is exactly the owner, and curated-*by-one* is an implementation fact, not the value. Curation licenses room gestures: a knock inside a vetted room is acceptable; a call remains an intimate, Direct-only gesture. *(Kept; curatorial framing added. Open thread: whether knock/call sit at the right intimacy ranks — "not so sure.")*

**P8 — In Direct, reciprocity earns intimacy.** Watch < knock < call; each closer gesture requires the more mutual bond. **Scoped:** this ladder governs Direct, P7 governs rooms — the scoping is itself the rule. A room may license a knock because curation already filtered who's inside. *(Kept; v1's open question dissolved by the scoping.)*

**R1 (was P9) — Invitations should carry the inviter's warmth.** *(Demoted from principle to recommendation, per ruling.)* Carried into Phase 2's target model as a parity recommendation: inviter name on group invites, an in-app invite surface — wherever feasible.

**P10 — Affordance governs the social; contract governs security and privacy.** The UI is where social rules live; database rules protect security and privacy, not social meaning. Consequence: capability gates stay client-side by design; rule changes (e.g. #288) are argued on privacy/security grounds only. *(Kept; sharpened per ruling.)*

**Tension status:** consent tension — dissolved (P2). Ladder-vs-room — resolved by P8's scoping. Silent endings — resolved by P4's amendment. **Open threads:** knock/call intimacy ranks (P7); the P6 line, held loosely; picker enumeration vs the P6 line.

**CHECKPOINT 2:** same pass on the v2 set — keep / amend / reject per item (R1 included). Phase 2 runs against the v2 rulings.

---

# Ruling pass 2 — operator rulings (2026-07-11)

P1 KEEP · P2 KEEP · P3 KEEP · P4 KEEP · P5 KEEP · P7 KEEP · P8 KEEP · P10 KEEP.
P6 **AMEND** — "It may also simply be a step towards mutuality. So it is first a fact, and then could become a mutuality — since there is no one-step action to create mutuality."
R1 — accepted ("Okay").

**P6 final:** *Followers are visible as facts — and as the seedbed of mutuality.* Seeing who follows you is first a fact; because mutuality has no one-step creation, the follower row is also the door through which mutuality forms (follow-back). It still earns the follower no visibility of you.

The value set is **RULED**: P1–P8 + P10 as revised above (P6 as amended here), R1 as a standing recommendation. Everything below judges the app against this set.

---

# Part III — Findings (`SM#n`)

Weights are social/UX weights, not engineering effort. Every finding names the principle(s) it violates.

## Vindications first — anomalies the ruled model *explains*

These were operator seeds or v1 tensions; under the ruled values they are correct behavior, not defects:

- **V1 — Co-members can knock without any follow edge.** P7+P8: the ladder governs Direct; a curated room licenses the knock — curation already filtered who's inside.
- **V2 — Only mutuals can call.** P8's ladder, plus P7 keeping call an intimate, Direct-only gesture (knock/call ranks remain an open thread, held loosely).
- **V3 — Request-to-follow exists only inside rooms.** P2 makes this *complete*, not arbitrary: asking is for keys you don't hold, and a room is the **only surface in the app where you can see someone whose key you don't hold**. Everywhere else, anyone visible to you has already exchanged keys with you (following someone hands them your key; their following you hands you theirs).
- **V4 — Group links join without owner approval.** P2+P7: the curator minted the key; possession of the room key *is* the curator's standing consent.
- **V5 — Declines, unfollows, revocations stay silent toward the other party.** P4 as amended: silence to others is the ratified default.

## Findings

### SM#1 — One glyph, two consent semantics (circled-plus) — **High** · P2, P4
Follow-back (automatic — using a key you already hold, `js/following.js:845`) and request-to-follow (asking for a key, `js/followRequests.js:62`) render as the same circled-plus. Under the ruled one-key model these are *different speech acts* — an act vs an ask — and the UI asserts they are the same. Fix direction: visually and verbally distinguish the ask (e.g. "Ask to follow" affordance) from the act ("Follow back").

### SM#2 — The immortal "Requested" state — **High** · P4
After a decline, the requester's button reads "Requested" forever (`js/followRequests.js:8-11`, #181 I5) — the actor's own consent action has a permanently untruthful state. P4 demands self-legibility without requiring disclosure: the state must eventually resolve *for the requester* (e.g. request TTL after which the button quietly resets to askable) while staying silent about who/when/why.

### SM#3 — Picker eligibility is follower-based where the ruled model is key-based — **High** · P2, P7
The in-app picker can invite only followers/mutuals (`js/invitePicker.js:47-58`). But under P2, the natural eligibility is *everyone whose key you hold* — which includes people you follow who don't follow you back (their code sits in your following list). Today a room curator cannot invite someone they follow unless that person follows them back — the half of the operator's original seed that survives the rulings. Fix direction: eligibility = (followers ∪ following) − members − self. Rules already permit it (`database.rules.json:142` requires only membership).

### SM#4 — Key-sharing has no first-class in-app surface — **Medium** · P2, R1
Sharing your key is the model's single founding act, yet on web it hides in a drawer and on Telegram it exists only as a share-sheet reflex; there is no in-app "invite someone to follow me" affordance in the main UI (operator seed). Fix direction: a first-class invite surface, per R1 carrying the inviter's name.

### SM#5 — Joining a room silently broadcasts 2h of availability — **Medium** · P1
Every join defaults to override ON + available 2h (`js/groups.js:126-134`); the bot path discloses only after the fact (`functions/telegram.js:601-606`, B#6). P1 defines the room contract as *conscious* exposure — membership visibility is consented by joining, but a 2-hour availability assertion is a separate presence claim the joiner never chose. Fix direction: make the default visible/adjustable at the join moment (a pre-checked toggle preserves the warm-arrival behavior while making it chosen).

### SM#6 — Curation is admit-only — **Medium** · P7
The curator can admit (links, picker) but cannot expel (kick unbuilt, #180) and cannot hand off or leave (no transfer; delete is the only exit, `js/groups.js:71-76`). Under P7 the room is *curated*; half the curation verbs are missing. Receiving-side kick detection already exists (`js/groups.js:176-185`). Supports #180's two items directly.

### SM#7 — One glyph for leaving and evicting (×) — **Medium** · P4
Unfollow (self-directed; their follow of you survives) and remove-follower (evicts; force-tears their follow via revocation) share the × (`js/following.js:673-675` vs `:849`). These are the model's two most different teardown acts; the actor's own act deserves unambiguous vocabulary. Confirm sheets differ, but the affordance doesn't.

### SM#8 — Group invitations arrive nameless; bot joins claim a name unasked — **Medium** · R1, P3
A group invite link carries no inviter identity (`js/inviteModal.js:26-28`): the invitee joins a named room from an anonymous hand — against R1. And a bot-button join auto-assigns the Telegram first name without a choosing moment (`functions/telegram.js:587`) — P3 wants first-contact names *chosen*, not just accurate. Fix directions: inviter label on group invites; a name-confirm step (or default-with-edit affordance) on bot joins.

### SM#9 — Rules let any member push-invite while the value says curator — **Low–Medium** · P7, P10
UI restricts inviting to the owner (`js/groupContext.js:138`); rules permit any member (`database.rules.json:142`). Either tighten the rule to the curator (P10: this is an abuse/spam vector, so rules-worthy) or consciously delegate curation — but the current silent mismatch is neither.

### SM#10 — The cold path carries no name — **Low** · P3
Bare-code adds have no self-presentation channel; the sharer arrives as a naked code (`js/following.js:1240-1290`). Acceptable as the deliberately-cold path; if touched, an optional name at share time completes P3 rather than changes it.

### SM#11 — Stale identities: rotated codes and uid fallbacks — **Low** · P3
After a code rotation, your followers keep your old code forever (`js/db/social.js:316-320`); a roster row with no displayName falls back to a raw uid (`js/groupContext.js:186`). Both misname people in small ways.

### SM#12 — Dormant rule slack: owners can rename members — **Low** · P3, P10
`database.rules.json:80-83` lets an owner write any member's record, including displayName; no UI does. P3 says nobody can rename you; P10 says privacy-relevant slack is rules-worthy. Note: any tightening must preserve the owner-write needed for a future kick (SM#6).

### SM#13 — Your outstanding asks are invisible across devices — **Low** · P4
Sent pending invites live only under the invitee's uid; the inviter has no read-path (#124), and the "Requested" marker is per-device localStorage. P4's self-legibility extends to *seeing your own outstanding asks anywhere you are*. Already tracked as #124; recorded here for its principle-trace.

---

# Part IV — The target model

The grand ruleset, stated as one page. **Divergences from current behavior are marked D#** — each individually decidable.

## 1. The key rule (P2)
Every relationship begins with a key — a code or a link. Holding someone's key is their standing consent to connect. **Following someone hands them your key back** (the act writes your code into their world), so every follow seeds a possible mutuality (P6). Where you can see a person but hold no key — today, only inside a room — you may **ask** (request-to-follow). The ask and the act must never look alike (**D2**: distinct glyph/label for request-to-follow vs follow-back — SM#1).

## 2. Two contracts (P1)
- **Direct** is key-based and ladder-governed (P8): *watch < knock < call*. Following grants seeing; mutuality grants knocking and calling. (Call-in-rooms stays out pending the P7 open thread.)
- **Room** is curated mutual exposure under a chosen identity (P7): joining exposes you to the room, licenses room-knocks, and shows your room-chosen name and room-scoped status. Joining must not silently assert more presence than membership itself (**D5**: the 2h availability default becomes visible/adjustable at the join moment — SM#5).

## 3. Curation (P7)
A room has a curator. The curator can **admit** (mint keys, directly invite anyone whose key they hold — **D1**: picker eligibility widens from followers-only to followers ∪ following — SM#3), **expel** (**D6a**: kick, with the existing receiving-side toast — SM#6/#180), and **hand off** (**D6b**: ownership transfer, so a room can outlive its founder — #180). Delegation of curation is possible under the value but not assumed; until it's chosen deliberately, the contract should match the affordance (**D8a**: tighten `pendingInvites` rules to the curator — SM#9).

## 4. Naming (P3)
You pick the name you're introduced by — on personal invites (today), on group invites (**D7**: inviter label on group invites — SM#8), at bot joins (**D7b**: a choosing moment instead of a silent claim — SM#8), and optionally even on the cold path (**D9**: optional name at code-share — SM#10). After first contact, what people call you is theirs and private; nobody can rename you (**D8b**: close the owner-rename rule slack without breaking kick — SM#12).

## 5. Legibility of self (P4)
Every consent act you take has a visible, truthful, eventually-resolving state: requests expire rather than lie (**D3**: request TTL/reset — SM#2), leaving and evicting read as different acts (**D4a**: split the × vocabulary — SM#7), and your outstanding asks are visible from any device (**D10**: sent-invites mirror — #124/SM#13). Silence toward the other party remains the default throughout.

## 6. Interrupts (P5)
Unchanged — ratified as-is. A push means presence or an invitation; bookkeeping never notifies. Asks stay above the per-person opt-in as inherently consensual, watched for abuse via cooldowns.

## 7. Sharing the founding act (P2, R1)
Key-sharing gets a first-class in-app surface on both web and Telegram (**D4b**: an "invite someone to follow me" affordance in the main UI — SM#4), always carrying the inviter's name (R1).

## 8. Surfaces (parity)
Capabilities remain surface-identical (already true). Formation/management converge where feasible: invite management on Telegram (#286) is the standing gap; the in-app-browser dead tap (#290) is the arrival-side counterpart.

## Divergence index

| D# | Change | From finding | Weight |
|---|---|---|---|
| D1 | Picker eligibility → everyone whose key you hold | SM#3 | High |
| D2 | Distinct ask vs act affordances (circled-plus split) | SM#1 | High |
| D3 | Follow-requests expire; "Requested" self-resolves | SM#2 | High |
| D4a | Split × vocabulary: leave vs evict | SM#7 | Medium |
| D4b | First-class in-app invite surface | SM#4 | Medium |
| D5 | Join-time visibility of the 2h availability default | SM#5 | Medium |
| D6a | Kick (curation: expel) | SM#6/#180 | Medium |
| D6b | Ownership transfer (curation: hand off) | SM#6/#180 | Medium |
| D7 | Inviter name on group invites (+ bot-join name moment) | SM#8 | Medium |
| D8a | Tighten pendingInvites rule to curator | SM#9 | Low–Med |
| D8b | Close owner-rename rule slack | SM#12 | Low |
| D9 | Optional name on bare-code share | SM#10 | Low |
| D10 | Sent-invites mirror (cross-device ask visibility) | #124/SM#13 | Low |

**Not proposed** (open threads held): call-in-rooms (P7 thread), any change to the P6 line (held loosely), asks joining the opt-in regime (P5, no examples), stale-code cosmetics (SM#11, cost/benefit thin).

**CHECKPOINT 3 (final):** accept / amend / defer per divergence D1–D10. Accepted divergences become the migration backlog conversation (deliberately out of this analysis's scope, per the endgame ruling).
