# Security-audit follow-ups (#287) — design

Date: 2026-07-09
Branch: `claude/telegram-security-audit-287-j0n9ke`
Source of truth: GitHub issue #287 (2026-07-09 Telegram security audit).

## Scope (operator-decided)

| Finding | Decision |
|---|---|
| **F1** — enumerable derived-uid × world-readable presence | **Fix — option A**: server-secret HMAC uid. **No migration** (pre-deployment; only operator + a few testers). |
| **F2** — self-join any group by gid | **Defer** — maintainer's call; pre-existing, affects web equally. No change this session. |
| **F3** — 24h initData replay window | **Fix**: shorten `DEFAULT_MAX_AGE_MS` 24h → **4h**. |
| **F5** — plaintext grad phrase survives account switch | **Fix**: clear the grad-phrase key on explicit unlink and on sign-out. |
| F4, F6 | Won't-fix (recorded in #287). No change. |

Acceptance gate: green suites (web `npx jest`, functions `cd functions && npm test`, rules `npm run test:rules`) are **necessary, not sufficient** — the operator's on-device walkthrough is the gate. TDD red→green per finding.

---

## F1 — server-secret HMAC uid (option A, no migration)

### Root cause (recap)
`deriveTelegramUid(tgId) = sha256("telegram:"+tgId).slice(0,32)` where `tgId` is a **public** numeric Telegram ID. Any authed user computes a target's uid offline and reads `users/$uid/presence` (`.read: auth != null`), harvesting share `code` + `lastSeen` + availability. Phrase accounts are safe because `uid = sha256(phrase)` is unguessable — option A restores that same unguessability for Telegram accounts.

### Change
Key the derivation with a server-held secret so the uid is not computable from the public `tgId`:

```js
// functions/telegram-auth.js
export function deriveTelegramUid(tgId, secret) {
  if (!secret) throw new Error('TELEGRAM_UID_SECRET not configured'); // fail-closed
  return createHmac('sha256', secret).update(`telegram:${tgId}`, 'utf8').digest('hex').slice(0, 32);
}
```

- Format unchanged: 32 hex chars, string/number-agnostic — matches phrase-uid format (rules/`deriveUid` parity).
- **Fail-closed**: an absent secret throws rather than deriving a fixed-key (still-guessable) uid. HMAC with an empty key must never happen.

### Secret provisioning (mirrors `TELEGRAM_BOT_TOKEN`)
- New env var `TELEGRAM_UID_SECRET` (a long random string), read as `process.env.TELEGRAM_UID_SECRET`.
- Threaded as `uidSecret` into **both** deps blocks in `functions/index.js`:
  - `makeTelegramAuthDeps()` (`:203`) — validate/link/unlink/graduate callables.
  - the webhook deps block (`:244`) — the bot's `/start` bootstrap also calls `ensureTelegramUser` (`functions/telegram.js:154`).
- Documented in `functions/.env.example` and `docs/telegram-setup.md` (same "copy into gitignored `functions/.env`, never the tracked `.env.<projectId>`" warning as the bot token).

### Call-site threading (all in `functions/telegram-auth.js`)
Every `deriveTelegramUid(tgId)` gains the secret from `deps.uidSecret`:
- `ensureTelegramUser` `:72`
- `linkTelegramHandler` `:154`
- `graduateTelegramHandler` `:378`
- `unlinkTelegramHandler` `:425`

`requireTelegramUser` (`:106`) gains a `deps.uidSecret` presence check → `HttpsError('failed-precondition', 'Telegram is not configured.')` (same message/shape as the existing `botToken` check) so callables surface a clean error; the `throw` inside `deriveTelegramUid` is the hard backstop for the webhook path.

### What does NOT change
- **`database.rules.json`** — presence stays `.read: auth != null`. Option A restores the capability model (uid unguessable), so no rule change and no follower-gated subnode. This is the elegance of A over the no-migration alternative.
- **`following.js`** — followers still read `presence.code`/`lastSeen` exactly as today.
- Client uid handling — the client never derives the TG uid (server-only; token-delivered). Verified: `deriveTelegramUid` has no client caller.

### No migration — operational note
Not deployed to real users. Existing test `telegramUsers/{tgId}` mappings point at **old-scheme** uids; after the change those would misbehave (`linked` / unlink / graduate detection keys off the derived uid). Resolution is **operational, not code**: clear the handful of test mappings/accounts at deploy so a fresh Mini-App open re-bootstraps at the new HMAC uid. Captured here + to be noted in the deploy step; no backfill script.

### Test impact (`functions/test/telegram-auth.test.js`)
Mechanical churn — the derivation now needs a secret:
- Add a module-level `TEST_UID_SECRET` constant; set `uidSecret: TEST_UID_SECRET` in the `makeStoreDeps` harness (`:64`).
- Every standalone `deriveTelegramUid('42')` (lines 57–60, 284, 506, 605, 643, 674, 699, 715, 764, 787, 796, 805, 833) passes `TEST_UID_SECRET`.
- **New (red-first) tests**: (a) uid depends on the secret — two different secrets → two different uids for the same `tgId`; (b) `deriveTelegramUid(tgId)` with no secret throws; (c) a callable with `uidSecret: null` deps → `failed-precondition`.

---

## F3 — shorten initData replay window to 4h

### Constraint (OBSERVED)
The Mini App holds **one launch `initData`** and replays it to every callable in a session (`telegramSettings.js:58` → unlink). So `DEFAULT_MAX_AGE_MS` also caps how long a session can still link/unlink/graduate. 4h cuts the replay window 6× while still covering any realistic session; a session idle >4h that then mutates would need a Mini-App reload (acceptable, rare).

### Change
`functions/telegram-auth.js:9`: `24 * 60 * 60 * 1000` → `4 * 60 * 60 * 1000`. One constant. No nonce (operator chose the shorten-only option).

### Test impact
- New: initData with `auth_date` ~5h old → `null`; ~3h old (valid signature) → parsed user.
- Verify no existing test asserts acceptance of an `auth_date` between 4h and 24h old (the "stale" test at `:37` uses 25h — still stale, unaffected).

---

## F5 — grad phrase lifetime tracks its identity

### Root cause (recap)
The grad phrase (= account credential) is plaintext in `localStorage`, uid-keyed, and deliberately excluded from `cacheOwner`'s account-switch wipe so it survives the graduation reload. It therefore also survives an unlink/sign-out into a different account until the next graduation overwrites it.

### Change
- `js/graduationPhrase.js`: export the existing `clearAll()` (rename to `clearGraduatedPhrases()`, keep internal `clearAll` as its body or re-export) so callers can wipe every stored grad phrase.
- Call it at the two identity-teardown points:
  - **Unlink** — `js/telegramSettings.js`, in the unlink flow before `window.location.reload()` (`:66`).
  - **Sign-out** — `js/auth.js:38`, alongside the `signOut(auth)` on account mismatch.
- Keep the cacheOwner exclusion as-is: the graduation reload still needs the just-stored phrase to survive (that path is not an unlink/sign-out).

### Test impact
- `tests/graduationPhrase.test.js`: `clearGraduatedPhrases()` removes all `statusapp_grad_phrase_*` keys.
- `tests/telegramSettings.test.js`: successful unlink clears the stored grad phrase.
- `tests/auth.test.js`: sign-out-on-mismatch clears the stored grad phrase.

---

## Verification plan
1. Per finding, red test(s) first, then implement to green.
2. Full suites: `npx jest` (root, ~1499), `cd functions && npm test` (~336), `npm run test:rules`.
3. `npm run build`.
4. Landmine checks unaffected (no touch to the three-reader predicate, the two time formatters).
5. On-device walkthrough by the operator = acceptance.

## Out of scope
F2 (deferred to maintainer), F4/F6 (won't-fix), any `database.rules.json` change, any migration script, nonce/`query_id` binding (F3 option B declined).
