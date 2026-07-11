# Social-model inventory & analysis — initiative design

**Date:** 2026-07-11
**Status:** Approved
**Type:** Analysis initiative (no product code changes; deliverable is a document)

## Motivation

The app's social model began minimal: ANN gives her 5-character share code to a
friend, who can then follow her. ANN has no visibility into who follows her and
can only name the people *she* follows. Successive features — invite links with
attached names, groups, group invitations, request-to-follow inside groups,
the Telegram surface — each extended the model, and the accumulated ruleset has
grown inconsistent and hard to state. Examples (from the operator):

- Only mutuals can call, yet group co-members can knock.
- A group owner can invite only their own followers via the in-app picker.
- A user can invite anyone to follow them via link or Telegram share sheet,
  but there is no in-app surface for that same act.
- Request-to-follow exists only inside groups; no general mechanism.
- Moments where a user cannot predict what the other party sees.
- The circled-plus icon is reused for two different acts: "follow this
  follower" (automatic) and the group roster's "request to follow" (a request
  the other side may decline) — same glyph, different social semantics.

Not all of these are wrong. The primary goal is to surface the **grand ruleset
/ ethos / principle** the app should embody, and judge the mechanisms against
it — a social and UX analysis, explicitly not a technical one.

## Endgame (ruled: option B)

Diagnosis **plus** a proposed coherent target model. Decomposition into a
prioritized migration backlog is deliberately deferred until the operator has
ruled on the findings and target model.

## Scope (ruled)

In scope — everything that creates, shapes, or exploits a relationship edge:

1. **Edge formation:** share code, personal invite link, group invite link,
   in-app group invite (picker), request-to-follow within a group, and the
   Telegram variant of each.
2. **Edge types & tiers and what they grant:** follower (one-way), mutual,
   group co-member, owner–member — including the **interactions**: knock,
   call, long-press, availability/presence visibility, naming.
3. **Identity & naming:** who can name whom, what each side sees (share code
   vs chosen name vs invite label), anonymity asymmetries.
4. **Lifecycle:** revoke/regenerate invites, unfollow, code rotation, kick
   (unbuilt, #180), leave, group delete — effects on edges and what the other
   side notices.
5. **Surface parity:** each mechanism, web vs Telegram Mini App (including
   #286: no invite management in Telegram).
6. **Notification rules:** who gets notified of what (follows, knocks, calls,
   invites, group events), per surface.

Out of scope: technical efficiency, security rules (2026-07-09/10 audits cover
them), non-social features (canvas, timers). Onboarding/arrival flows are
**referenced** to `docs/superpowers/specs/2026-07-10-invite-arrival-flows-design.md`,
not re-derived.

## Governing yardstick (ruled: option C)

Deriving the values is part of the job. The analysis first reconstructs what
values the app **actually embodies today** — from behavior, not intention —
proposes that value set explicitly, and obtains the operator's ruling on it
before any finding is judged or any target ruleset is built.

## Structure — two phases, one ruling checkpoint

### Phase 1 — Inventory + derived ethos

**Part I — Inventory.** Descriptive only; every claim cited to code or spec.

1. Relationship states and every formation path (mechanism × surface).
2. Capability matrix: interaction (knock, call, long-press, availability /
   presence visibility, naming) × relationship tier (stranger, follower,
   followee, mutual, co-member, owner↔member) × surface.
3. Legibility matrix ("what does the other side see") as a first-class lens:
   for each state and act, what each party sees, knows, and can predict.
4. Notification matrix: event × who is notified × surface.
5. Lifecycle: each teardown/rotation mechanism, its edge effects, and the
   other side's experience of it.
6. Surface parity: per-mechanism web vs Telegram deltas.

**Part II — Derived value set (the centerpiece).** Candidate principles the
app embodies today, each stated as a testable rule (e.g. "naming flows outward
only", "audience is never enumerated"), each with conforming AND violating
evidence from Part I. Framed for ruling: keep / amend / reject per principle.

**Checkpoint:** the operator rules on the value set. Phase 2 does not start
until then.

### Phase 2 — Findings + target model

**Part III — Findings.** Inconsistencies, gaps, and asymmetries judged against
the *ruled* values. Each carries a citable ID (`SM#n`), evidence, and a
social/UX weight. Operator seeds enter here: the mutuals-call vs member-knock
anomaly, the picker's own-followers-only rule, the missing in-app
invite-to-follow surface, group-only request-to-follow,
unpredictable-other-side moments, and the circled-plus icon naming both an
automatic follow and a declinable request.

**Part IV — Target model.** The grand ruleset: what each tier grants and why,
one consistent invitation rule, one consistent answer on request-to-follow,
an explicit legibility guarantee. Every divergence from current behavior is
flagged for the operator's accept/reject. No backlog decomposition here.

## Method

- Evidence base: `js/` modules (following, invites, inviteModal, invitePicker,
  followRequests, mycode, groups, groupContext, knock/call paths, notification
  routing), `functions/` (notifier fan-out, telegram.js), `database.rules.json`
  (as behavior, not security), existing specs and analyses
  (`2026-07-07-telegram-feature-analysis.md`, groups spec, invite-arrival
  spec), open issues (#286, #288, #289, #180, #181, #124).
- Parallel read-only exploration for coverage; every matrix cell verified
  against source by direct read before publication. UNKNOWN cells marked as
  such rather than guessed.
- Persona walkthroughs (ANN-style narratives) used where they expose
  legibility gaps better than matrices.

## Deliverable (ruled: option A)

- Canonical: `docs/superpowers/2026-07-11-social-model-analysis.md` —
  greppable, quotable finding IDs (`SM#n`), the artifact future issues cite.
- Companion: same-name `.html` for reading (matrix-heavy content).
- Delivered per phase: Phase 1 lands and stops at the checkpoint; Phase 2 is
  appended after the values ruling. The HTML companion tracks the markdown.

## Acceptance

- Phase 1: operator can rule on every proposed principle from the document
  alone (evidence inline, no code-reading required).
- Phase 2: every finding traces to a ruled principle; every target-model
  divergence from current behavior is explicit and individually decidable.
