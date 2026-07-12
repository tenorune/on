# Telegram J#11 — re-viewable graduation phrase (2026-07-09)

**Provenance:** issue #285 (J#11), from the 2026-07-07 feature analysis §1.3.

## Problem

After graduating in Telegram ("use the app outside Telegram"), the secret
phrase is a one-shot reveal. It isn't stored server-side (it's hashed into the
uid), and the Telegram identity boots from `initData` with `recoveryCode: null`
(`js/telegram.js`), so nothing can ever re-show it. `telegramSettings.js`
force-hides the drawer recovery pill. A user who taps "I've saved it" without
actually saving is stranded — the account "works in any browser" but they can
never take it there.

## Approach (decided: dedicated local vault)

The client holds the plaintext phrase only during `startGraduation`. Capture it
there, persist it locally in a small dedicated vault keyed by the phrase-derived
uid, and — in the Telegram drawer — surface the **existing** web reveal widget
(`initRecoveryPill`) when a stored phrase exists for the current account. The
web reveal UI is reused verbatim (reveal → 15s auto-hide → copy).

Rejected alternative: writing the phrase into `statusapp_identity` (unify with
web signup). Cleaner conceptually but graduation would need the account's share
`code` (out of scope there) and it entangles with the identity boot path.

## Components

### `js/graduationPhrase.js` (new)
- `storeGraduatedPhrase(uid, recoveryCode)` — clears any sibling
  `statusapp_grad_phrase_*` keys (only the current account's phrase lingers),
  then writes `statusapp_grad_phrase_<uid> = recoveryCode`.
- `loadGraduatedPhrase(uid)` — returns the stored phrase for `uid`, or `null`.
- Pure localStorage; no crypto/identity imports. Wrapped in try/catch for
  private-mode/quota, matching the app's other storage helpers.

### `js/graduation.js` (change)
In `startGraduation`'s `onConfirm`, after a successful `callGraduateTelegram`
and before the reload: `storeGraduatedPhrase(await deriveUserIdFromRecoveryCode(rc), rc)`.
(`deriveUserIdFromRecoveryCode` is already exported from `js/identity.js`.)
`stampGraduationNotice()` + reload unchanged.

### `js/telegramSettings.js` (change)
`initTelegramSettings(userId)` today always hides `#recovery-pill-row`. Instead:
`const phrase = loadGraduatedPhrase(userId)` — if present, un-hide the row and
`initRecoveryPill(phrase)`; else hide it (today's behavior). The pill row already
sits at the drawer bottom (`index.template.html:301`).

## Data flow

graduate success → `storeGraduatedPhrase(phraseUid, rc)` → reload → TG boot
resolves uid = phraseUid → drawer opens → `loadGraduatedPhrase(phraseUid)` → pill
shown, driven by the stored phrase.

## Storage / lifecycle / security

- The phrase key is **outside** `cacheOwner`'s wipe list, so it survives the
  graduation reload (which is itself a uid change, derived→phrase-derived).
- It is **uid-keyed**, so a later account switch reads its own (absent) key —
  no cross-account display leak. `storeGraduatedPhrase` clears sibling keys on
  write so a stale phrase doesn't accumulate.
- A plaintext phrase in localStorage matches the **existing web posture** (web
  already persists it in `statusapp_identity`, which `cacheOwner` keeps).

## Testing

- `tests/graduationPhrase.test.js`: store→load round-trip; sibling keys cleared
  on write; `loadGraduatedPhrase` of an unknown uid → `null`.
- `tests/graduation.test.js`: on `onConfirm` success, `storeGraduatedPhrase` is
  called with the derived uid + phrase (mock `identity`/`graduationPhrase`).
- `tests/telegramSettings.test.js`: a stored phrase for the uid → `#recovery-pill-row`
  un-hidden + `initRecoveryPill` driven with it; no stored phrase → row hidden.

## Out of scope

J#12 (graduation "?" label + account-denying copy) — separate, marked won't-fix
on #285. The "?" hit area was already grown in W4 (C#12).
