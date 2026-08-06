// The probe performs a REAL, irreversible Auth deletion, so its gate is the
// part worth pinning: a bug that deletes without the explicit flag destroys a
// record no pre-image can bring back. The live Admin-SDK calls are not tested
// here — they are the thing the probe exists to observe.
import { parseProbeArgs, revokeVerdict, deleteVerdict } from '../ops/verify-auth-delete.js';

const ENV = { GOOGLE_APPLICATION_CREDENTIALS_JSON: '{"x":1}' };

describe('parseProbeArgs', () => {
  test('reads the project and the uid under test', () => {
    const o = parseProbeArgs(['--project', 'demo', '--uid', 'abc'], ENV);
    expect(o.projectId).toBe('demo');
    expect(o.uid).toBe('abc');
  });

  test('refuses without a uid — there is no sensible default target', () => {
    expect(() => parseProbeArgs(['--project', 'demo'], ENV)).toThrow(/--uid/);
  });

  test('refuses without a project', () => {
    expect(() => parseProbeArgs(['--uid', 'abc'], ENV)).toThrow(/--project/);
  });

  test('refuses without the service-account env', () => {
    expect(() => parseProbeArgs(['--project', 'demo', '--uid', 'abc'], {}))
      .toThrow(/GOOGLE_APPLICATION_CREDENTIALS_JSON/);
  });

  // THE gate. Steps 1-2 (read, revoke) are recoverable; step 5 is not.
  test('deletion is off unless explicitly asked for', () => {
    expect(parseProbeArgs(['--project', 'demo', '--uid', 'abc'], ENV).deleteRecord).toBe(false);
    expect(parseProbeArgs(['--project', 'demo', '--uid', 'abc', '--yes-delete'], ENV).deleteRecord)
      .toBe(true);
  });

  // A probe pointed at production is a probe that deletes a real person's
  // account. It fails closed the same way the panel does.
  test('refuses to run against the declared production project', () => {
    expect(() => parseProbeArgs(['--project', 'live', '--uid', 'a', '--prod-project', 'live'], ENV))
      .toThrow(/production/i);
  });
});

describe('revokeVerdict', () => {
  const AT = '2026-08-02T10:00:00Z';
  const LATER = '2026-08-02T11:00:00Z';

  test('advanced tokensValidAfterTime is the proof the revoke landed', () => {
    expect(revokeVerdict(AT, LATER).ok).toBe(true);
  });

  test('an unchanged tokensValidAfterTime is a FAILED revoke, not a pass', () => {
    const v = revokeVerdict(AT, AT);
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/did not advance/i);
  });

  // An absent value before is normal (never revoked); absent after is not.
  test('absent before and set after still counts as advanced', () => {
    expect(revokeVerdict(null, LATER).ok).toBe(true);
  });

  test('absent after is a failure whatever came before', () => {
    expect(revokeVerdict(AT, null).ok).toBe(false);
  });
});

describe('deleteVerdict', () => {
  test('a user-not-found lookup after the delete is the pass', () => {
    expect(deleteVerdict({ code: 'auth/user-not-found' }).ok).toBe(true);
  });

  test('the record still being readable is a failure', () => {
    const v = deleteVerdict(null);
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/still readable/i);
  });

  test('any other error is reported as inconclusive, not as a pass', () => {
    const v = deleteVerdict({ code: 'auth/internal-error' });
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/inconclusive/i);
  });
});
