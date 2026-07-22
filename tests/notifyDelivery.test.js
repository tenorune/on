/** @jest-environment node */
// Pins shared/notifyDelivery.js telegramPreferred to the SAME vector file the
// three readers are pinned to (W2 C10) — the fixture stays the spec; this test
// makes the shared unit answer to it directly.
import { telegramPreferred } from '../shared/notifyDelivery.js';
import fixture from '../test-fixtures/notify-channel-vectors.json';

test.each(fixture.vectors)(
  'telegramPreferred(%p)',
  ({ notifyChannel, telegramDelivered }) => {
    expect(telegramPreferred(notifyChannel)).toBe(telegramDelivered);
  }
);
