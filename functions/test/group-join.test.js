import { jest } from '@jest/globals';
import { joinGroupHandler } from '../group-join.js';

const NOW = 1_752_800_000_000;
const mkReq = (data, uid = 'joiner') => ({ auth: uid ? { uid } : undefined, data });

function mkDeps(map) {
  const store = { ...map };
  return {
    now: () => NOW,
    getVal: jest.fn((path) => Promise.resolve(store[path] ?? null)),
    set: jest.fn((path, value) => { store[path] = value; return Promise.resolve(); }),
    transaction: jest.fn((path, fn) => {
      store[path] = fn(store[path] ?? null);
      return Promise.resolve({ committed: true });
    }),
    _store: store,
  };
}

describe('joinGroupHandler', () => {
  test('rejects unauthenticated', async () => {
    const deps = mkDeps({});
    const res = await joinGroupHandler(mkReq({ groupId: 'G1', displayName: 'Jo', token: 'T' }, null), deps);
    expect(res).toEqual({ ok: false, reason: 'unauthenticated' });
    expect(deps.set).not.toHaveBeenCalled();
  });

  test('rejects a missing groupId / displayName', async () => {
    const deps = mkDeps({});
    expect((await joinGroupHandler(mkReq({ displayName: 'Jo', token: 'T' }), deps)).reason).toBe('invalid-argument');
    expect((await joinGroupHandler(mkReq({ groupId: 'G1', token: 'T' }), deps)).reason).toBe('invalid-argument');
  });

  test('token path: valid non-revoked token → writes member + bumps redemptions', async () => {
    const deps = mkDeps({
      'groups/G1/name': 'Family',
      'groups/G1/invites/T': { revoked: false, redemptionsUsed: 2, redemptionCap: 10 },
    });
    const res = await joinGroupHandler(mkReq({ groupId: 'G1', displayName: 'Jo', token: 'T' }), deps);
    expect(res).toEqual({ ok: true, groupId: 'G1' });
    expect(deps._store['groups/G1/members/joiner']).toMatchObject({
      role: 'member', displayName: 'Jo', joinedAt: NOW,
      statusOverride: { enabled: true, status: 'available', availableUntil: NOW + 7200000 },
    });
    expect(deps._store['groups/G1/invites/T'].redemptionsUsed).toBe(3);
  });

  test('token path: revoked / expired / cap-exhausted rejected without writing', async () => {
    const revoked = mkDeps({ 'groups/G1/name': 'F', 'groups/G1/invites/T': { revoked: true } });
    expect((await joinGroupHandler(mkReq({ groupId: 'G1', displayName: 'Jo', token: 'T' }), revoked)).reason).toBe('revoked');
    const expired = mkDeps({ 'groups/G1/name': 'F', 'groups/G1/invites/T': { revoked: false, expiresAt: NOW - 1 } });
    expect((await joinGroupHandler(mkReq({ groupId: 'G1', displayName: 'Jo', token: 'T' }), expired)).reason).toBe('expired');
    const capped = mkDeps({ 'groups/G1/name': 'F', 'groups/G1/invites/T': { revoked: false, redemptionsUsed: 5, redemptionCap: 5 } });
    expect((await joinGroupHandler(mkReq({ groupId: 'G1', displayName: 'Jo', token: 'T' }), capped)).reason).toBe('cap');
    for (const d of [revoked, expired, capped]) expect(d.set).not.toHaveBeenCalled();
  });

  test('token path: unknown token / missing group → not-found', async () => {
    const noGroup = mkDeps({ 'groups/G1/invites/T': { revoked: false } }); // no name → group gone
    expect((await joinGroupHandler(mkReq({ groupId: 'G1', displayName: 'Jo', token: 'T' }), noGroup)).reason).toBe('not-found');
    const noTok = mkDeps({ 'groups/G1/name': 'F' });
    expect((await joinGroupHandler(mkReq({ groupId: 'G1', displayName: 'Jo', token: 'T' }), noTok)).reason).toBe('not-found');
  });

  test('pending-invite path (no token): caller with a pending invite → writes member, no redemption bump', async () => {
    const deps = mkDeps({
      'groups/G1/name': 'Family',
      'pendingInvites/joiner/G1': { from: 'owner', ts: 1 },
    });
    const res = await joinGroupHandler(mkReq({ groupId: 'G1', displayName: 'Jo' }), deps);
    expect(res).toEqual({ ok: true, groupId: 'G1' });
    expect(deps._store['groups/G1/members/joiner']).toMatchObject({ role: 'member', displayName: 'Jo' });
    expect(deps.transaction).not.toHaveBeenCalled();
  });

  test('no token and no pending invite → no-entitlement (the #288 self-join, now blocked)', async () => {
    const deps = mkDeps({ 'groups/G1/name': 'Family' });
    const res = await joinGroupHandler(mkReq({ groupId: 'G1', displayName: 'Jo' }), deps);
    expect(res).toEqual({ ok: false, reason: 'no-entitlement' });
    expect(deps.set).not.toHaveBeenCalled();
  });

  test('idempotent: already a member → ok with alreadyMember, no re-write', async () => {
    const deps = mkDeps({
      'groups/G1/name': 'Family',
      'groups/G1/invites/T': { revoked: false },
      'groups/G1/members/joiner': { role: 'member', displayName: 'Jo', joinedAt: 1 },
    });
    const res = await joinGroupHandler(mkReq({ groupId: 'G1', displayName: 'Jo', token: 'T' }), deps);
    expect(res).toEqual({ ok: true, groupId: 'G1', alreadyMember: true });
    expect(deps.set).not.toHaveBeenCalled();
  });

  test('rejects an over-long display name (server-authoritative validation)', async () => {
    const deps = mkDeps({ 'groups/G1/name': 'F', 'groups/G1/invites/T': { revoked: false } });
    const res = await joinGroupHandler(mkReq({ groupId: 'G1', displayName: 'x'.repeat(200), token: 'T' }), deps);
    expect(res.reason).toBe('invalid-argument');
    expect(deps.set).not.toHaveBeenCalled();
  });
});
