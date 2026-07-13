/** @jest-environment node */
// Pins BOTH availability predicates — client js/utils.js isAvailable and
// server functions/presence-core.js primaryAvailable — over one vector table,
// INCLUDING their known divergence on open-ended availability (null
// availableUntil): the client reads it available, the server reads it not.
// This is deliberately a parity *pin*, not a unification: whether the
// divergence is a latent bug or intentional is the operator's call (spec
// 2026-07-11 Doc 2 unit #5). If either side moves, this fails and the
// question must be re-asked — do not silently "fix" one to match the other.
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
