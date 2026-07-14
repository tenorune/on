/** @jest-environment node */
// Pins BOTH availability predicates — client js/utils.js isAvailable and
// server functions/presence-core.js primaryAvailable — over one vector table.
//
// The `['available', null, ...]` row is an INVARIANT TRIPWIRE, not a live
// divergence to resolve. The two predicates disagree ONLY on open-ended
// availability (status 'available' with a null/absent availableUntil): the
// client reads it available, the server reads it not.
//
// RESOLVED 2026-07-14 (Doc 2 unit #5/#6 — verification task):
//   • No write path emits `available` without a concrete numeric availableUntil,
//     verified across every client + server writer (setStatus, the group-chip
//     writers, createGroup/joinGroup, the bot /status handler).
//   • Live prod RTDB audited CLEAN via functions/audit-available-null.js — 0
//     offenders across primary presence AND enabled group overrides.
//   ⇒ The divergent input is UNREACHABLE in practice; the predicates agree on
//     every reachable input and are INTENTIONALLY NOT UNIFIED — each side's
//     default for the impossible input is deliberate (client fail-open in the
//     UI, server fail-closed on notifications). See the plan's T6 resolution.
//
// The invariant is convention-only — database.rules.json does NOT enforce it —
// so this row exists to FAIL LOUDLY the day a writer or a data migration makes
// a user `available` with no availableUntil. If it fails, that is the tripwire
// firing: re-audit the writers and the data, do NOT silently "fix" one predicate
// to match the other.
import { isAvailable } from '../js/utils.js';
import { primaryAvailable } from '../functions/presence-core.js';

const NOW = 1_000_000;
const FUTURE = NOW + 60_000;
const PAST = NOW - 60_000;

const VECTORS = [
  // status, availableUntil, client, server
  ['available', FUTURE, true, true],
  ['available', PAST, false, false],
  ['available', null, true, false], // ← THE divergence: open-ended availability
  ['unavailable', FUTURE, false, false],
  ['unavailable', null, false, false],
  [undefined, FUTURE, false, false],
];

test.each(VECTORS)(
  'status=%p availableUntil=%p → client %p / server %p',
  (status, availableUntil, client, server) => {
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(NOW);
    try {
      expect(isAvailable(status, availableUntil)).toBe(client);
      expect(primaryAvailable({ status, availableUntil }, NOW)).toBe(server);
    } finally {
      dateNow.mockRestore();
    }
  }
);
