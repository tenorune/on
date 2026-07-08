# Telegram W4 — bot delight batch (design)

Date: 2026-07-08
Branch: cut from the `t1r1jp` tip.
Source: `docs/superpowers/2026-07-07-telegram-feature-analysis.md` §1.5 (B#8, B#10, B#11, B#12, B#13, B#14, J#15) + C#7.

Companion to `…-w4-client-copy-css-design.md`. This spec covers the **bot /
functions** surface, accepted by an **on-device bot conversation** (except J#15,
which is client and rides the Mini-App walkthrough). All items are LOW severity,
high smile-per-line — a menu the operator curated, not a mandate.

**B#7 was cut** (deep-link "Open in KnockKnock" row) by operator decision.

## Landmine

The three-reader notify predicate (`channel !== 'push'`) must stay byte-identical
across `functions/notifier.js`, `js/notifySuppression.js`, `js/notifyChannel.js`.
B#10 touches `notifier.js` `resolveName` only — **not** the channel predicate. Do
not disturb it.

## Deploy flag

B#11 (`setMyCommands`) registers via a webhook-time API call and only takes effect
after an **A5 redeploy** (`docs/telegram-setup.md`); a push to `dev` wipes
branch-only Telegram functions until redeploy. It is not verifiable purely
in-conversation. All other items are.

---

## C#7 — bot group-invite keyboard: "Accept" → "Join"

The same pending-group-invite action is "Join" in the web inbox (`js/inbox.js:215`)
but "Accept" on the bot keyboard. Adopt the web verb — "Join" states the outcome;
Decline already agrees.

- `functions/telegram.js:47-50` — inline keyboard `Accept` → **`Join`**; `Decline` unchanged.
- Updates test expectations that assert `Accept`.

## B#8 — easter-egg reply to non-text private messages

Today a private-chat sticker/photo/voice/contact returns total silence
(`functions/telegram.js:97`), which reads as "bot is broken."

- For a **private** message that is not text (and passes the existing `msg.from` guard), reply: **`Someone else might enjoy that {emoji} — try /help.`**
- `{emoji}` is chosen at random from an **extensible module-level set**: `🐥 🍑 🍆 💦 🫦 🌚` (U+1F425, U+1F351, U+1F346, U+1F4A6, U+1FAE6, U+1F31A). Adding more later = one array entry.
- Implement the picker as a **tiny pure function** (e.g. `pickPlayfulEmoji(rand = Math.random)`) so tests inject `rand` and assert membership + the exact template. Keep the group-chat / no-`from` early returns intact.

### Tests
- `pickPlayfulEmoji` returns a member of the set for boundary `rand` values (0, ~1).
- Non-text private message → one reply matching `^Someone else might enjoy that .+ — try \/help\.$`; the emoji is in the set.
- Group / no-`from` messages → still no reply.

## B#10 — prefix bare share codes in actor names

`resolveName` (`functions/notifier.js:53-59`) falls back to the raw share code, so a
bot message reads literally `K7Q2ZP knocked` — a glitch in a conversational chat.

- When the resolved actor name **is** a raw share code (matches the share-code shape), prefix it: **`Your contact K7Q2ZP knocked`**. When a real display name / group displayName exists, unchanged.
- Scope to the bot rendering path; web-push lock-screen text is unchanged (pre-existing cross-channel behavior). Touch `resolveName` only — not the channel predicate.

### Tests
- Actor with a label → unchanged.
- Actor resolving to a bare code → `Your contact {code}` prefix in the bot message.

## B#11 — `setMyCommands` from one source of truth

The "/" command menu depends on a manual BotFather paste
(`docs/telegram-setup.md:65-73`) that has already drifted from `HELP_TEXT`
(`functions/telegram.js:64-72`). No `setMyCommands` call exists.

### Design
- Introduce a single **`COMMANDS`** list — `[{ command, description }, …]` — as the source of truth (e.g. `status`, `off`, `who`, `knock`, `groups`, `notifications`, `help`).
- `HELP_TEXT` is **rendered from `COMMANDS`** (so the help list and the menu can't drift).
- Call `setMyCommands` at webhook-registration time with `COMMANDS` (descriptions ≤ Telegram's per-command limit; commands are the bare word without `/`).
- Update `docs/telegram-setup.md` to note the menu is now registered automatically (drop / annotate the manual `/setcommands` paste).

### Tests
- `HELP_TEXT` derives from `COMMANDS` (rendering a known `COMMANDS` yields the expected lines).
- Webhook registration invokes `setMyCommands` with the `COMMANDS`-derived payload.

### Verification note
Menu change is only observable after the A5 redeploy — flagged above.

## B#12 — "button has expired" instead of "Unknown action."

`await answer('Unknown action.')` (`functions/telegram.js` callback guard, the two
sites at ~T:383/396, currently `:422` after drift) is a dead-end where users can
legitimately land (an old notification's button after a release renames an action).

- Replace with **`This button has expired — try /help.`** at both sites.
- Leave the adjacent `Open KnockKnock first.` unlinked-user guard unchanged (it is correct).

### Tests
- Malformed / unknown callback action → answers `This button has expired — try /help.`

## B#13 — truncation hints on the 8-item keyboards

`found.slice(0, 8)` / `matches.slice(0, 8)` (`functions/telegram.js:320,349-350`)
silently cap the "Which one?" keyboards with no overflow cue.

- When the pre-slice list length > 8, append a hint line to the message: **`…and N more — type more letters.`** (N = overflow count). No hint when ≤ 8.

### Tests
- 8 or fewer matches → no hint.
- More than 8 → hint with the correct overflow count; keyboard still capped at 8.

## B#14 — status color + unified time (the big one)

Chosen shape: **the leading dot always means "this subject is available, in their
status color."** Others on `/who`, you on `/status` and `/groups`. Unavailable =
no dot. Times read the way the app reads them.

### The color quantizer
- New pure **`statusCircle(hex)`** in `functions/presence-core.js`: quantize an arbitrary status-color hex to the nearest Telegram circle emoji. Exact rule (the one the operator reviewed against all 92 selectable swatches):
  - Parse hex → RGB; derive chroma `d = max−min` and lightness `l = (max+min)/2/255`.
  - **Low-chroma** (`d < 30`): `l > 0.82` → ⚪, `l < 0.18` → ⚫, else ⚪ (gray). (Only the pale coral complement `#fce7f3` hits ⚪ in the current set; no swatch hits ⚫.)
  - Else by hue (degrees): `<15 or ≥340` → 🔴; `<45` → 🟠 (special-case `l<0.28 & 18≤h≤45` → 🟤, unused by the current set); `<68` → 🟡; `<170` → 🟢; `<250` → 🔵; `<292` → 🟣; else (magenta) → 🔴.
  - The mapping collapses the 92 swatches to ~7 circles (🟢 and 🔵 hold 22 each) — lossiness accepted by the operator.
  - The plan pins the **16 palette-key** expected circles as test vectors so the shipped mapping is locked to what was approved.
- **Fallback 🟢** when the color is missing/invalid (matches today's look; every listed person is available anyway).
- Color source per surface:
  - `/who` (Direct): each person's `presence.statusColor` (already in the fetched presence node — no extra read).
  - `/who <group>`: each co-member's **effective** color — `member.statusOverride.statusColor` when the override is enabled, else `presence.statusColor` — mirroring `effectiveAvailable` and the client roster (`js/groupContext.js:345`).
  - `/status`, `/start` echo: the user's own global `presence.statusColor` (one small `statusColor` read on the `/status` confirm path).
  - `/groups`: the user's own **effective** color per group.

### The time formatters (ported, not shared)
Client and functions share no modules (no imports either direction; the notify
predicate is the precedent — duplicated with byte-identical discipline). So the
two app formatters in `js/utils.js` are **duplicated into
`functions/presence-core.js`** as byte-identical copies:
- `formatTimeRemaining(ms)` — precise: `< 1m`, `45m`, `2h`, `1h 35m`. Bare phrase, caller owns `" left"`.
- `formatTimeRemainingFuzzy(ms)` — fuzzy: `just a few minutes`, `about 15 minutes`, `about half an hour`, `about an hour`, `one to two hours`, `just over N hours`, `nearly N hours`, `about N hours` (with the `HOUR_WORDS` table).

Drift protection: a **shared test-vector fixture** (input ms → expected string)
run against both the `js/utils.js` originals and the `presence-core.js` copies, so
any divergence fails a test. Cross-reference comment on both copies (as the
notify-predicate landmine does).

### Command outputs

| Command | Time formatter | Example |
|---|---|---|
| `/who` (others, remaining) | fuzzy + `" left"` | `🔵 Ana — about half an hour left` |
| `/who <group>` (others, remaining) | fuzzy + `" left"` | `🔵 Ana — about an hour left` |
| `/groups` available rows (you, remaining) | precise + `" left"` | `🔵 Divers — 1h 35m left` |
| `/start` echo (you, remaining) | precise | `You're 🔵 available for another 1h 35m. /off to stop.` |
| `/status` (you, just set) | precise | `You're 🔵 available for 2h. /off to stop.` |
| `/status <group>` (you, just set) | precise | `You're 🔵 available in Divers for 2h. /off Divers to stop.` |

Notes:
- Every listed person/group is available with a future `availableUntil` (the app's timed-availability model, `presence-core.js:13`), so a time phrase is always present. Defensive: if a formatter returns `''`, omit the `" — … left"` tail rather than render a dangling dash.
- `/status <group>` **gains** the symmetric `/off <group> to stop.` hint (using the matched canonical group name), which today's confirm lacks (`telegram.js:292`).
- `/status` set-duration uses the **precise** formatter on the chosen duration (decided: reuse, not a new spelled formatter) — internally consistent with `/groups` and `/start`.

### `/groups` restructure
Current: one line per group, `name — available/unavailable (you)` (`telegram.js:394`).
New:
- **Available** groups first, one line each: `{statusCircle(effectiveColor)} {name} — {formatTimeRemaining(effectiveRemaining)} left`.
- **Unavailable** groups collapsed into a single trailing line: `Unavailable in {name}, {name}, …`.
- Edge cases: all available → no summary line; all unavailable → only the summary line; no groups → existing `No groups yet — create one in the app.` unchanged.
- Effective remaining = the override's `availableUntil` when the override is enabled, else the primary's — same source as the effective color/availability (data already fetched at `telegram.js:389-393`).
- The `(you)` suffix is dropped (the whole command is self-scoped; the new format is cleaner).

### Tests (red-first)
- `statusCircle`: representative hexes → expected circles per the approved mapping; missing/invalid → 🟢.
- Shared time-vector fixture passes against both `js/utils.js` and `presence-core.js`.
- `/who`: available followers render `{circle} {label} — {fuzzy} left`; fallback circle when no color; empty → `No one is available right now.`
- `/who <group>`: uses effective (override) color + time.
- `/status`, `/status <group>`: dot + precise duration + `/off … to stop.` hint.
- `/start` echo: dot + precise remaining.
- `/groups`: mixed (dotted available rows + one Unavailable line), all-available, all-unavailable.

## J#15 — first-accept "tap to knock" beat (client)

After a newcomer's **first** invite accept, the contact silently appears
(`js/app.js:462-467`); no beat points at the core loop.

### Design
- One-time toast/hint after the first successful accept on the newcomer path: **`You're following {name} — tap their card to knock.`**
- Gate with a **sessionStorage marker** (following the `kk-landing` pattern, `js/firstRun.js:98`) so it fires once and never on re-entry.
- Client-only; **acceptance is the Mini-App newcomer flow**, so it rides the web/Mini-App walkthrough, not the on-device bot pass.

### Tests
- First accept with no marker → beat shown, marker set.
- Subsequent accept with marker present → no beat.

## Shared units introduced (in `functions/presence-core.js`)
- `statusCircle(hex)` — pure hex → circle emoji.
- `formatTimeRemaining(ms)`, `formatTimeRemainingFuzzy(ms)` — byte-identical ports of `js/utils.js`, guarded by a shared test-vector fixture.
- `COMMANDS` source of truth (in `functions/telegram.js` or a small shared module) feeding both `HELP_TEXT` and `setMyCommands`.
- `pickPlayfulEmoji(rand)` — pure, extensible easter-egg picker.

## Out of scope (named)
- B#7 (deep-link "Open in KnockKnock" row) — cut.
- B#1/B#2/B#9 (HIGH: stale inline keyboards, knock-cap honesty, persistent callback record) — prior/other waves.
- Sharing formatters via a real shared module — architecture forbids it here; duplication with test-vector discipline is the accepted approach.

## Acceptance
Green suites necessary, not sufficient. On-device gate (operator):
- Bot conversation: `/who`, `/who <group>`, `/status`, `/status <group>`, `/groups`, `/start` echo all read with the right dot + time; non-text message gets the easter-egg reply; expired button copy; truncation hint past 8; `Join` on the group keyboard; code-prefixed actor names.
- `setMyCommands` menu verified after the A5 redeploy.
- Mini-App: first-accept beat fires once.

## Testing commands
- Cloud Functions: `cd functions && npm test` (baseline 281).
- Web (J#15 + the `js/utils.js` side of the shared time fixture): `npx jest` (root, 1461).
