// tests/db.test.js
const {
  userExists, touchLastSeen, rotateCode, setStatusColor, setPaletteKey,
  setStatus, watchPresence,
  startCall, answerCall, endCall, watchOwnCall, getUser,
  claimInviteToken, releaseInviteToken, readInviteIndex,
  readUserInvite, writeUserInvite, deleteUserInvite,
  setInviteRevoked, incrementInviteRedemptions, getCreatorCode,
  watchUserInvites, readUserInvites,
  claimGroupId,
  writeUserGroupsEntry, removeUserGroupsEntry, readUserGroups, watchUserGroups,
  setLastVisited,
  writeGroup, readGroup, readGroupName, renameGroup, deleteGroup, watchGroupMeta,
  writeMember, readMember, readMembers, removeMember, setMemberDisplayName, watchGroupMembers,
  writeGroupInvite, readGroupInvites, setGroupInviteRevoked, incrementGroupInviteRedemptions, watchGroupInvites,
  setStatusOverride, clearStatusOverride, watchOwnMemberOverride,
  writeFollowRequest, watchFollowRequests, deleteFollowRequest,
  writeFollowGrant, watchFollowGrants, deleteFollowGrant,
  writeKnock, getKnocks, watchKnocksAdded, clearKnock,
  removeFollower, registerAsFollower, watchRevocations,
} = require('../js/db');

jest.mock('firebase/database', () => ({
  ref: jest.fn(() => 'mock-ref'),
  get: jest.fn(),
  update: jest.fn(),
  set: jest.fn(),
  remove: jest.fn(),
  runTransaction: jest.fn(),
  onValue: jest.fn(),
  onChildAdded: jest.fn(),
}));
jest.mock('../js/firebase-config', () => ({ db: {} }));
jest.mock('../js/identity.js', () => ({ generateCode: jest.fn() }));
jest.mock('../js/store.js', () => ({ getFollowing: jest.fn() }));

const { ref, get, update, set, remove, runTransaction, onValue, onChildAdded } = require('firebase/database');
const { generateCode } = require('../js/identity.js');
const { getFollowing } = require('../js/store.js');

test('userExists returns true when Firebase record exists', async () => {
  get.mockResolvedValueOnce({ exists: () => true });
  const result = await userExists('user-123');
  expect(result).toBe(true);
  // Post-M1: existence is probed via the cross-user-readable presence node,
  // not the (now owner-only) whole users/{uid} node.
  expect(ref).toHaveBeenCalledWith(expect.anything(), 'users/user-123/presence');
});

test('userExists returns false when Firebase record does not exist', async () => {
  get.mockResolvedValueOnce({ exists: () => false });
  const result = await userExists('user-456');
  expect(result).toBe(false);
  expect(ref).toHaveBeenCalledWith(expect.anything(), 'users/user-456/presence');
});

test('touchLastSeen writes lastSeen timestamp to users/{userId}/presence', async () => {
  update.mockResolvedValueOnce();
  await touchLastSeen('user-789');
  expect(update).toHaveBeenCalledWith('mock-ref', expect.objectContaining({ lastSeen: expect.any(Number) }));
});

describe('rotateCode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getFollowing.mockReturnValue([]);
  });

  test('happy path: reserves new code, updates user record, releases old code, returns new code', async () => {
    generateCode.mockReturnValue('NEW456');
    runTransaction.mockResolvedValue({ committed: true });
    update.mockResolvedValue();
    remove.mockResolvedValue();

    const result = await rotateCode('user-1', 'OLD123');

    expect(runTransaction).toHaveBeenCalledWith('mock-ref', expect.any(Function));
    expect(update).toHaveBeenCalledWith('mock-ref', { code: 'NEW456' });
    expect(remove).toHaveBeenCalledWith('mock-ref');
    expect(result).toBe('NEW456');
  });

  test('retries on collision: generateCode called twice, returns code from second attempt', async () => {
    generateCode
      .mockReturnValueOnce('TAKEN1')
      .mockReturnValueOnce('NEW456');
    runTransaction
      .mockResolvedValueOnce({ committed: false })
      .mockResolvedValueOnce({ committed: true });
    update.mockResolvedValue();
    remove.mockResolvedValue();

    const result = await rotateCode('user-1', 'OLD123');

    expect(generateCode).toHaveBeenCalledTimes(2);
    expect(result).toBe('NEW456');
  });

  test('calls set once per following entry with correct path value', async () => {
    getFollowing.mockReturnValue([
      { userId: 'followee-A', code: 'CODEA1', label: 'Alice' },
      { userId: 'followee-B', code: 'CODEB2', label: 'Bob' },
    ]);
    generateCode.mockReturnValue('NEW456');
    runTransaction.mockResolvedValue({ committed: true });
    update.mockResolvedValue();
    set.mockResolvedValue();
    remove.mockResolvedValue();

    await rotateCode('user-1', 'OLD123');

    expect(set).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenCalledWith('mock-ref', 'NEW456');
  });

  test('failure in step 2 (update) rejects the promise; remove is not called', async () => {
    generateCode.mockReturnValue('NEW456');
    runTransaction.mockResolvedValue({ committed: true });
    update.mockRejectedValue(new Error('network error'));

    await expect(rotateCode('user-1', 'OLD123')).rejects.toThrow('network error');
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('setStatusColor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('writes statusColor to users/{userId}/presence path', async () => {
    update.mockResolvedValueOnce();
    await setStatusColor('user-1', '#a855f7');
    expect(ref).toHaveBeenCalledWith(expect.anything(), 'users/user-1/presence');
    expect(update).toHaveBeenCalledWith('mock-ref', { statusColor: '#a855f7' });
  });
});

describe('setPaletteKey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('setPaletteKey calls update with paletteKey field', async () => {
    update.mockResolvedValueOnce();
    await setPaletteKey('uid1', 'ember');
    expect(update).toHaveBeenCalledWith(
      expect.anything(),
      { paletteKey: 'ember' }
    );
  });

  test('setPaletteKey coerces undefined to null', async () => {
    update.mockResolvedValueOnce();
    await setPaletteKey('uid1', undefined);
    expect(update).toHaveBeenCalledWith(
      expect.anything(),
      { paletteKey: null }
    );
  });
});

describe('call mailboxes', () => {
  beforeEach(() => jest.clearAllMocks());
  test('startCall writes both calls/{caller}.to and calls/{callee}.from atomically', async () => {
    update.mockResolvedValue();
    await startCall('caller', 'callee');
    const arg = update.mock.calls[0][1];
    expect(arg['calls/caller']).toEqual(expect.objectContaining({ to: 'callee', ts: expect.any(Number) }));
    expect(arg['calls/callee']).toEqual(expect.objectContaining({ from: 'caller', ts: expect.any(Number) }));
  });
  test('answerCall sets answered on both records', async () => {
    update.mockResolvedValue();
    await answerCall('callee', 'caller');
    const arg = update.mock.calls[0][1];
    expect(arg['calls/callee/answered']).toBe(true);
    expect(arg['calls/caller/answered']).toBe(true);
  });
  test('endCall nulls both records', async () => {
    update.mockResolvedValue();
    await endCall('a', 'b');
    const arg = update.mock.calls[0][1];
    expect(arg['calls/a']).toBeNull();
    expect(arg['calls/b']).toBeNull();
  });
  test('watchOwnCall subscribes to calls/{uid}', () => {
    onValue.mockImplementationOnce(() => () => {});
    watchOwnCall('me', jest.fn());
    expect(ref).toHaveBeenCalledWith({}, 'calls/me');
  });

  test('startCall with a clearUid nulls the prior ringer mailbox in the same update', async () => {
    update.mockResolvedValue();
    await startCall('me', 'C', 'B');
    const arg = update.mock.calls[0][1];
    expect(arg['calls/me']).toEqual(expect.objectContaining({ to: 'C' }));
    expect(arg['calls/C']).toEqual(expect.objectContaining({ from: 'me' }));
    expect(arg['calls/B']).toBeNull();
  });

  test('startCall ignores a clearUid equal to caller or callee', async () => {
    update.mockResolvedValue();
    await startCall('me', 'C', 'me');
    expect('calls/me' in update.mock.calls[0][1]).toBe(true);
    expect(update.mock.calls[0][1]['calls/me']).toEqual(expect.objectContaining({ to: 'C' })); // not nulled
  });
});

describe('getUser', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns user data when record exists', async () => {
    get.mockResolvedValueOnce({ exists: () => true, val: () => ({ status: 'available' }) });
    const result = await getUser('user-1');
    expect(result).toEqual({ status: 'available' });
  });

  test('returns null when record does not exist', async () => {
    get.mockResolvedValueOnce({ exists: () => false });
    const result = await getUser('user-1');
    expect(result).toBeNull();
  });
});

describe('claimInviteToken', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('claims a free token transactionally and stores ownerPath', async () => {
    runTransaction.mockResolvedValue({ committed: true });
    const ok = await claimInviteToken('TOKEN22CHARSTRINGAAAA1', 'users/uid1/invites/TOKEN22CHARSTRINGAAAA1');
    expect(ok).toBe(true);
    expect(runTransaction).toHaveBeenCalledWith('mock-ref', expect.any(Function));
    const handler = runTransaction.mock.calls[0][1];
    expect(handler(null)).toEqual({ scope: 'personal', ownerPath: 'users/uid1/invites/TOKEN22CHARSTRINGAAAA1' });
    expect(handler({ scope: 'personal', ownerPath: 'users/someone/invites/TOKEN22CHARSTRINGAAAA1' })).toBeUndefined();
  });

  test('returns false when the transaction does not commit', async () => {
    runTransaction.mockResolvedValue({ committed: false });
    const ok = await claimInviteToken('TOKEN22CHARSTRINGAAAA2', 'users/uid1/invites/TOKEN22CHARSTRINGAAAA2');
    expect(ok).toBe(false);
  });

  test('routes scope to "group" when ownerPath starts with groups/', async () => {
    runTransaction.mockResolvedValue({ committed: true });
    await claimInviteToken('TOK', 'groups/G1/invites/TOK');
    const handler = runTransaction.mock.calls[0][1];
    expect(handler(null)).toEqual({ scope: 'group', ownerPath: 'groups/G1/invites/TOK' });
  });
});

describe('releaseInviteToken', () => {
  test('removes the inviteIndex entry', async () => {
    remove.mockResolvedValue();
    await releaseInviteToken('TOKEN');
    expect(remove).toHaveBeenCalledWith('mock-ref');
    expect(ref).toHaveBeenLastCalledWith({}, 'inviteIndex/TOKEN');
  });
});

describe('readInviteIndex', () => {
  test('returns the index entry when present', async () => {
    get.mockResolvedValueOnce({ exists: () => true, val: () => ({ scope: 'personal', ownerPath: 'users/u/invites/T' }) });
    const result = await readInviteIndex('T');
    expect(result).toEqual({ scope: 'personal', ownerPath: 'users/u/invites/T' });
  });

  test('returns null when the entry is missing', async () => {
    get.mockResolvedValueOnce({ exists: () => false });
    const result = await readInviteIndex('NONEXISTENT');
    expect(result).toBeNull();
  });
});

describe('readUserInvite', () => {
  test('returns the invite record by uid + token', async () => {
    get.mockResolvedValueOnce({ exists: () => true, val: () => ({ scope: 'personal', token: 'T', creatorLabel: 'Alex' }) });
    const result = await readUserInvite('uid1', 'T');
    expect(result).toEqual({ scope: 'personal', token: 'T', creatorLabel: 'Alex' });
  });

  test('returns null when absent', async () => {
    get.mockResolvedValueOnce({ exists: () => false });
    const result = await readUserInvite('uid1', 'NOPE');
    expect(result).toBeNull();
  });
});

describe('writeUserInvite', () => {
  test('writes the full invite record at users/{uid}/invites/{token}', async () => {
    set.mockResolvedValue();
    const payload = { scope: 'personal', token: 'T', creatorLabel: 'Alex', createdAt: 12345, expiresAt: null, redemptionCap: null, redemptionsUsed: 0, revoked: false };
    await writeUserInvite('uid1', 'T', payload);
    expect(set).toHaveBeenCalledWith('mock-ref', payload);
    expect(ref).toHaveBeenLastCalledWith({}, 'users/uid1/invites/T');
  });
});

describe('deleteUserInvite', () => {
  test('removes the invite record', async () => {
    remove.mockResolvedValue();
    await deleteUserInvite('uid1', 'T');
    expect(ref).toHaveBeenLastCalledWith({}, 'users/uid1/invites/T');
    expect(remove).toHaveBeenCalled();
  });
});

describe('setInviteRevoked', () => {
  test('sets revoked: true on the invite', async () => {
    update.mockResolvedValue();
    await setInviteRevoked('uid1', 'T');
    expect(update).toHaveBeenCalledWith('mock-ref', { revoked: true });
    expect(ref).toHaveBeenLastCalledWith({}, 'users/uid1/invites/T');
  });
});

describe('incrementInviteRedemptions', () => {
  beforeEach(() => jest.clearAllMocks());

  test('runs a transaction that increments redemptionsUsed by 1', async () => {
    runTransaction.mockResolvedValue({ committed: true });
    await incrementInviteRedemptions('uid1', 'T');
    const handler = runTransaction.mock.calls[0][1];
    expect(handler(3)).toBe(4);
    expect(handler(null)).toBe(1);
  });
});

describe('getCreatorCode', () => {
  test('reads users/{creatorUid}/presence/code', async () => {
    get.mockResolvedValueOnce({ exists: () => true, val: () => 'ABC123' });
    const code = await getCreatorCode('uid1');
    expect(code).toBe('ABC123');
    expect(ref).toHaveBeenLastCalledWith({}, 'users/uid1/presence/code');
  });

  test('returns null when the user has no code', async () => {
    get.mockResolvedValueOnce({ exists: () => false });
    const code = await getCreatorCode('unknownUid');
    expect(code).toBeNull();
  });
});

describe('watchUserInvites', () => {
  test('subscribes to users/{uid}/invites and emits the collection', () => {
    let callback;
    onValue.mockImplementation((_ref, cb) => { callback = cb; return () => {}; });
    const seen = [];
    watchUserInvites('uid1', (invites) => seen.push(invites));
    callback({ exists: () => true, val: () => ({ T1: { scope: 'personal', revoked: false }, T2: { scope: 'personal', revoked: true } }) });
    expect(seen[0]).toEqual({ T1: { scope: 'personal', revoked: false }, T2: { scope: 'personal', revoked: true } });
    callback({ exists: () => false, val: () => null });
    expect(seen[1]).toEqual({});
  });
});

describe('readUserInvites', () => {
  test('returns the full invites collection', async () => {
    get.mockResolvedValueOnce({ exists: () => true, val: () => ({ T1: { scope: 'personal', revoked: false }, T2: { scope: 'personal', revoked: true } }) });
    const result = await readUserInvites('uid1');
    expect(result).toEqual({ T1: { scope: 'personal', revoked: false }, T2: { scope: 'personal', revoked: true } });
  });

  test('returns an empty object when no invites exist', async () => {
    get.mockResolvedValueOnce({ exists: () => false });
    const result = await readUserInvites('uid1');
    expect(result).toEqual({});
  });
});

describe('claimGroupId', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('claims a fresh group id transactionally', async () => {
    runTransaction.mockResolvedValue({ committed: true });
    const ok = await claimGroupId('G1ABCD23');
    expect(ok).toBe(true);
    const handler = runTransaction.mock.calls[0][1];
    expect(handler(null)).toBe(true);
    expect(handler(true)).toBeUndefined();
  });

  test('returns false when the transaction aborts', async () => {
    runTransaction.mockResolvedValue({ committed: false });
    const ok = await claimGroupId('TAKENID1');
    expect(ok).toBe(false);
  });
});

describe('user-side groups enumeration', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('writeUserGroupsEntry writes lastVisited (or empty object) at users/{uid}/groups/{groupId}', async () => {
    set.mockResolvedValue();
    await writeUserGroupsEntry('uid1', 'G1', { lastVisited: 1234 });
    expect(set).toHaveBeenCalledWith('mock-ref', { lastVisited: 1234 });
    expect(ref).toHaveBeenLastCalledWith({}, 'users/uid1/groups/G1');
  });

  test('writeUserGroupsEntry with no payload writes true', async () => {
    set.mockResolvedValue();
    await writeUserGroupsEntry('uid1', 'G1');
    expect(set).toHaveBeenCalledWith('mock-ref', true);
  });

  test('removeUserGroupsEntry removes the enumeration record', async () => {
    remove.mockResolvedValue();
    await removeUserGroupsEntry('uid1', 'G1');
    expect(ref).toHaveBeenLastCalledWith({}, 'users/uid1/groups/G1');
    expect(remove).toHaveBeenCalled();
  });

  test('readUserGroups returns the collection', async () => {
    get.mockResolvedValueOnce({ exists: () => true, val: () => ({ G1: { lastVisited: 10 }, G2: true }) });
    const result = await readUserGroups('uid1');
    expect(result).toEqual({ G1: { lastVisited: 10 }, G2: true });
  });

  test('readUserGroups returns empty object on miss', async () => {
    get.mockResolvedValueOnce({ exists: () => false });
    expect(await readUserGroups('uid1')).toEqual({});
  });

  test('watchUserGroups subscribes to users/{uid}/groups', () => {
    let cb;
    onValue.mockImplementation((_ref, fn) => { cb = fn; return () => {}; });
    const seen = [];
    watchUserGroups('uid1', (data) => seen.push(data));
    cb({ exists: () => true, val: () => ({ G1: true }) });
    expect(seen[0]).toEqual({ G1: true });
    cb({ exists: () => false });
    expect(seen[1]).toEqual({});
  });

  test('setLastVisited updates lastVisited on the users/{uid}/groups/{gid} record', async () => {
    update.mockResolvedValue();
    await setLastVisited('uid1', 'G1', 99999);
    expect(update).toHaveBeenCalledWith('mock-ref', { lastVisited: 99999 });
    expect(ref).toHaveBeenLastCalledWith({}, 'users/uid1/groups/G1');
  });
});

describe('group entity ops', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('writeGroup creates the group record', async () => {
    set.mockResolvedValue();
    const payload = { name: 'Family', ownerId: 'uid1', createdAt: 12345 };
    await writeGroup('G1ABCD23', payload);
    expect(set).toHaveBeenCalledWith('mock-ref', payload);
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1ABCD23');
  });

  test('readGroup returns the record when present', async () => {
    get.mockResolvedValueOnce({ exists: () => true, val: () => ({ name: 'Family', ownerId: 'uid1', createdAt: 12345 }) });
    const result = await readGroup('G1ABCD23');
    expect(result).toEqual({ name: 'Family', ownerId: 'uid1', createdAt: 12345 });
  });

  test('readGroup returns null when missing', async () => {
    get.mockResolvedValueOnce({ exists: () => false });
    expect(await readGroup('NOPE0001')).toBeNull();
  });

  test('readGroupName reads only the name leaf and wraps it as { name }', async () => {
    get.mockResolvedValueOnce({ exists: () => true, val: () => 'Family' });
    const result = await readGroupName('G1ABCD23');
    expect(ref).toHaveBeenCalledWith(expect.anything(), 'groups/G1ABCD23/name');
    expect(result).toEqual({ name: 'Family' });
  });

  test('readGroupName returns null when the group (name leaf) is missing', async () => {
    get.mockResolvedValueOnce({ exists: () => false });
    expect(await readGroupName('NOPE0001')).toBeNull();
  });

  test('renameGroup writes only the name field', async () => {
    update.mockResolvedValue();
    await renameGroup('G1ABCD23', 'Familia');
    expect(update).toHaveBeenCalledWith('mock-ref', { name: 'Familia' });
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1ABCD23');
  });

  test('deleteGroup removes the entire groups/{groupId} subtree', async () => {
    remove.mockResolvedValue();
    await deleteGroup('G1ABCD23');
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1ABCD23');
    expect(remove).toHaveBeenCalled();
  });

  test('watchGroupMeta subscribes to groups/{groupId} and strips members/invites for the meta-only callback', () => {
    let cb;
    onValue.mockImplementation((_ref, fn) => { cb = fn; return () => {}; });
    const seen = [];
    watchGroupMeta('G1ABCD23', (meta) => seen.push(meta));
    cb({ exists: () => true, val: () => ({ name: 'Family', ownerId: 'uid1', createdAt: 1, members: { u: {} }, invites: { i: {} } }) });
    expect(seen[0]).toEqual({ name: 'Family', ownerId: 'uid1', createdAt: 1 });
    cb({ exists: () => false });
    expect(seen[1]).toBeNull();
  });
});

describe('group members', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('writeMember writes the full member record', async () => {
    set.mockResolvedValue();
    const member = { role: 'member', displayName: 'Alex K.', joinedAt: 1234 };
    await writeMember('G1', 'uid2', member);
    expect(set).toHaveBeenCalledWith('mock-ref', member);
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1/members/uid2');
  });

  test('readMember returns the record', async () => {
    get.mockResolvedValueOnce({ exists: () => true, val: () => ({ role: 'member', displayName: 'Alex', joinedAt: 1 }) });
    const result = await readMember('G1', 'uid2');
    expect(result).toEqual({ role: 'member', displayName: 'Alex', joinedAt: 1 });
  });

  test('readMember returns null when missing', async () => {
    get.mockResolvedValueOnce({ exists: () => false });
    expect(await readMember('G1', 'unknownUid')).toBeNull();
  });

  test('readMembers returns the full collection', async () => {
    get.mockResolvedValueOnce({ exists: () => true, val: () => ({ uid1: { role: 'owner' }, uid2: { role: 'member' } }) });
    const result = await readMembers('G1');
    expect(result).toEqual({ uid1: { role: 'owner' }, uid2: { role: 'member' } });
  });

  test('readMembers returns empty object on miss', async () => {
    get.mockResolvedValueOnce({ exists: () => false });
    expect(await readMembers('G1')).toEqual({});
  });

  test('removeMember removes the member record', async () => {
    remove.mockResolvedValue();
    await removeMember('G1', 'uid2');
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1/members/uid2');
    expect(remove).toHaveBeenCalled();
  });

  test('setMemberDisplayName updates only the displayName field', async () => {
    update.mockResolvedValue();
    await setMemberDisplayName('G1', 'uid2', 'M. P.');
    expect(update).toHaveBeenCalledWith('mock-ref', { displayName: 'M. P.' });
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1/members/uid2');
  });

  test('watchGroupMembers subscribes to the members collection', () => {
    let cb;
    onValue.mockImplementation((_ref, fn) => { cb = fn; return () => {}; });
    const seen = [];
    watchGroupMembers('G1', (members) => seen.push(members));
    cb({ exists: () => true, val: () => ({ uid1: { role: 'owner', displayName: 'Alice' } }) });
    expect(seen[0]).toEqual({ uid1: { role: 'owner', displayName: 'Alice' } });
    cb({ exists: () => false });
    expect(seen[1]).toEqual({});
  });
});

describe('group invite ops', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('writeGroupInvite writes at groups/{groupId}/invites/{token}', async () => {
    set.mockResolvedValue();
    const payload = { scope: 'group', token: 'T', creatorUid: 'uid1', createdAt: 1, expiresAt: null, redemptionCap: null, redemptionsUsed: 0, revoked: false };
    await writeGroupInvite('G1', 'T', payload);
    expect(set).toHaveBeenCalledWith('mock-ref', payload);
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1/invites/T');
  });

  test('readGroupInvites returns the full collection', async () => {
    get.mockResolvedValueOnce({ exists: () => true, val: () => ({ T1: { scope: 'group', creatorUid: 'uid1', revoked: false } }) });
    expect(await readGroupInvites('G1')).toEqual({ T1: { scope: 'group', creatorUid: 'uid1', revoked: false } });
  });

  test('setGroupInviteRevoked marks revoked', async () => {
    update.mockResolvedValue();
    await setGroupInviteRevoked('G1', 'T');
    expect(update).toHaveBeenCalledWith('mock-ref', { revoked: true });
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1/invites/T');
  });

  test('incrementGroupInviteRedemptions transactionally bumps the counter', async () => {
    runTransaction.mockResolvedValue({ committed: true });
    await incrementGroupInviteRedemptions('G1', 'T');
    const handler = runTransaction.mock.calls[0][1];
    expect(handler(3)).toBe(4);
    expect(handler(null)).toBe(1);
  });

  test('watchGroupInvites subscribes to the collection', () => {
    let cb;
    onValue.mockImplementation((_ref, fn) => { cb = fn; return () => {}; });
    const seen = [];
    watchGroupInvites('G1', (invites) => seen.push(invites));
    cb({ exists: () => true, val: () => ({ T: { scope: 'group', revoked: false } }) });
    expect(seen[0]).toEqual({ T: { scope: 'group', revoked: false } });
    cb({ exists: () => false });
    expect(seen[1]).toEqual({});
  });
});

describe('statusOverride helpers', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('setStatusOverride writes the sub-object at groups/{groupId}/members/{uid}/statusOverride', async () => {
    set.mockResolvedValue();
    await setStatusOverride('G1', 'uidA', { enabled: true, status: 'unavailable', availableUntil: null });
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1/members/uidA/statusOverride');
    expect(set).toHaveBeenCalledWith('mock-ref', { enabled: true, status: 'unavailable', availableUntil: null });
  });

  test('setStatusOverride writes an available override with timestamp', async () => {
    set.mockResolvedValue();
    await setStatusOverride('G1', 'uidA', { enabled: true, status: 'available', availableUntil: 1234 });
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1/members/uidA/statusOverride');
    expect(set).toHaveBeenCalledWith('mock-ref', { enabled: true, status: 'available', availableUntil: 1234 });
  });

  test('clearStatusOverride removes the sub-object', async () => {
    remove.mockResolvedValue();
    await clearStatusOverride('G1', 'uidA');
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1/members/uidA/statusOverride');
    expect(remove).toHaveBeenCalledWith('mock-ref');
  });

  test('mergeStatusOverride uses update so unspecified fields survive', async () => {
    const { mergeStatusOverride } = require('../js/db');
    update.mockResolvedValue();
    await mergeStatusOverride('G1', 'uidA', { enabled: false, status: null, availableUntil: null });
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1/members/uidA/statusOverride');
    expect(update).toHaveBeenCalledWith('mock-ref', { enabled: false, status: null, availableUntil: null });
  });

  test('watchOwnMemberOverride subscribes to the override sub-object', () => {
    let cb;
    onValue.mockImplementation((_ref, fn) => { cb = fn; return () => {}; });
    const seen = [];
    watchOwnMemberOverride('G1', 'uidA', (data) => seen.push(data));
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1/members/uidA/statusOverride');
    cb({ exists: () => true, val: () => ({ enabled: true, status: 'available', availableUntil: 99 }) });
    expect(seen[0]).toEqual({ enabled: true, status: 'available', availableUntil: 99 });
    cb({ exists: () => false });
    expect(seen[1]).toBeNull();
  });
});

describe('registerAsFollower', () => {
  test('writes the followers entry and clears any prior revocations entry, in that order', async () => {
    set.mockResolvedValue();
    remove.mockResolvedValue();
    ref.mockClear();
    await registerAsFollower('targetUid', 'meUid', 'ABC123');
    // Both writes happen — revocations/me/target cleared, followers/me set.
    const refPaths = ref.mock.calls.map((args) => args[1]);
    expect(refPaths).toContain('users/targetUid/followers/meUid');
    expect(refPaths).toContain('revocations/meUid/targetUid');
    expect(set).toHaveBeenCalledWith('mock-ref', 'ABC123');
    expect(remove).toHaveBeenCalledWith('mock-ref');
    // Order: revocation clear must precede the followers write so the
    // receiver's revocation watcher can't fire on the followers update while
    // the revocation entry is still present and silently undo the new follow.
    const revokeIdx = refPaths.indexOf('revocations/meUid/targetUid');
    const followersIdx = refPaths.indexOf('users/targetUid/followers/meUid');
    expect(revokeIdx).toBeLessThan(followersIdx);
  });
});

describe('follow request/grant mailboxes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('writeFollowRequest sets followRequests/{target}/{requester}', async () => {
    set.mockResolvedValueOnce();
    await writeFollowRequest('req', 'tgt', 'g1');
    expect(ref).toHaveBeenCalledWith({}, 'followRequests/tgt/req');
    expect(set).toHaveBeenCalledWith('mock-ref',
      expect.objectContaining({ from: 'req', groupId: 'g1', ts: expect.any(Number) }));
  });

  test('deleteFollowRequest removes followRequests/{target}/{requester}', async () => {
    remove.mockResolvedValueOnce();
    await deleteFollowRequest('tgt', 'req');
    expect(ref).toHaveBeenCalledWith({}, 'followRequests/tgt/req');
    expect(remove).toHaveBeenCalledWith('mock-ref');
  });

  test('watchFollowRequests subscribes to followRequests/{target} and maps empty', () => {
    let handler;
    onValue.mockImplementationOnce((_ref, cb) => { handler = cb; return () => {}; });
    const got = jest.fn();
    watchFollowRequests('tgt', got);
    expect(ref).toHaveBeenCalledWith({}, 'followRequests/tgt');
    handler({ exists: () => false, val: () => null });
    expect(got).toHaveBeenCalledWith({});
    handler({ exists: () => true, val: () => ({ req: { from: 'req', groupId: 'g1', ts: 1 } }) });
    expect(got).toHaveBeenCalledWith({ req: { from: 'req', groupId: 'g1', ts: 1 } });
  });

  test('writeFollowGrant sets followGrants/{requester}/{target} with target code', async () => {
    set.mockResolvedValueOnce();
    await writeFollowGrant('req', 'tgt', 'TGTCODE', 'Bea');
    expect(ref).toHaveBeenCalledWith({}, 'followGrants/req/tgt');
    expect(set).toHaveBeenCalledWith('mock-ref',
      expect.objectContaining({ from: 'tgt', code: 'TGTCODE', name: 'Bea', ts: expect.any(Number) }));
  });

  test('writeFollowGrant stores null name when omitted', async () => {
    set.mockResolvedValueOnce();
    await writeFollowGrant('req', 'tgt', 'TGTCODE');
    expect(set).toHaveBeenCalledWith('mock-ref',
      expect.objectContaining({ name: null }));
  });

  test('deleteFollowGrant removes followGrants/{requester}/{target}', async () => {
    remove.mockResolvedValueOnce();
    await deleteFollowGrant('req', 'tgt');
    expect(ref).toHaveBeenCalledWith({}, 'followGrants/req/tgt');
    expect(remove).toHaveBeenCalledWith('mock-ref');
  });

  test('watchFollowGrants subscribes to followGrants/{requester}', () => {
    let handler;
    onValue.mockImplementationOnce((_ref, cb) => { handler = cb; return () => {}; });
    const got = jest.fn();
    watchFollowGrants('req', got);
    expect(ref).toHaveBeenCalledWith({}, 'followGrants/req');
    handler({ exists: () => true, val: () => ({ tgt: { from: 'tgt', code: 'C', ts: 1 } }) });
    expect(got).toHaveBeenCalledWith({ tgt: { from: 'tgt', code: 'C', ts: 1 } });
  });
});

describe('knocks moved to top-level mailbox', () => {
  beforeEach(() => jest.clearAllMocks());

  test('writeKnock targets knocks/{recipient}/{sender}', async () => {
    runTransaction.mockResolvedValueOnce({ committed: true });
    await writeKnock('rcpt', 'sndr', {});
    expect(ref).toHaveBeenCalledWith({}, 'knocks/rcpt/sndr');
  });

  test('getKnocks reads knocks/{recipient}', () => {
    get.mockReturnValueOnce(Promise.resolve({ exists: () => false }));
    getKnocks('me');
    expect(ref).toHaveBeenCalledWith({}, 'knocks/me');
  });

  test('watchKnocksAdded subscribes to knocks/{recipient}', () => {
    onChildAdded.mockImplementationOnce(() => () => {});
    watchKnocksAdded('me', jest.fn());
    expect(ref).toHaveBeenCalledWith({}, 'knocks/me');
  });

  test('clearKnock removes knocks/{recipient}/{sender}', () => {
    remove.mockReturnValueOnce(Promise.resolve());
    clearKnock('me', 'sndr');
    expect(ref).toHaveBeenCalledWith({}, 'knocks/me/sndr');
  });
});

describe('revocations mailbox', () => {
  beforeEach(() => jest.clearAllMocks());

  test('removeFollower removes the follower and writes revocations/{follower}/{me}', async () => {
    remove.mockResolvedValue(); set.mockResolvedValue();
    await removeFollower('me', 'fol');
    expect(ref).toHaveBeenCalledWith({}, 'users/me/followers/fol');
    expect(ref).toHaveBeenCalledWith({}, 'revocations/fol/me');
    expect(set).toHaveBeenCalledWith('mock-ref', true);
  });

  test('registerAsFollower clears revocations/{me}/{target} before setting followers', async () => {
    remove.mockResolvedValue(); set.mockResolvedValue();
    await registerAsFollower('target', 'me', 'CODE');
    expect(ref).toHaveBeenCalledWith({}, 'revocations/me/target');
    expect(ref).toHaveBeenCalledWith({}, 'users/target/followers/me');
  });

  test('watchRevocations subscribes to revocations/{me}', () => {
    onValue.mockImplementationOnce(() => () => {});
    watchRevocations('me', jest.fn());
    expect(ref).toHaveBeenCalledWith({}, 'revocations/me');
  });
});

describe('presence subtree', () => {
  beforeEach(() => jest.clearAllMocks());

  test('setStatus writes under users/{uid}/presence', async () => {
    update.mockResolvedValue();
    await setStatus('me', 'available', 123);
    expect(ref).toHaveBeenCalledWith({}, 'users/me/presence');
    expect(update).toHaveBeenCalledWith('mock-ref', expect.objectContaining({ status: 'available', availableUntil: 123 }));
  });

  test('setStatusColor / setPaletteKey / touchLastSeen write under presence', async () => {
    update.mockResolvedValue();
    await setStatusColor('me', '#fff');
    expect(ref).toHaveBeenCalledWith({}, 'users/me/presence');
    jest.clearAllMocks(); update.mockResolvedValue();
    await setPaletteKey('me', 'iris');
    expect(ref).toHaveBeenCalledWith({}, 'users/me/presence');
    jest.clearAllMocks(); update.mockResolvedValue();
    await touchLastSeen('me');
    expect(ref).toHaveBeenCalledWith({}, 'users/me/presence');
  });

  test('watchPresence subscribes to users/{uid}/presence and returns the subtree', () => {
    let handler;
    onValue.mockImplementationOnce((_r, cb) => { handler = cb; return () => {}; });
    const got = jest.fn();
    watchPresence('me', got);
    expect(ref).toHaveBeenCalledWith({}, 'users/me/presence');
    handler({ exists: () => true, val: () => ({ status: 'available' }) });
    expect(got).toHaveBeenCalledWith({ status: 'available' });
    handler({ exists: () => false, val: () => null });
    expect(got).toHaveBeenCalledWith(null);
  });
  // (setLastVisited is covered in the 'user-side groups enumeration' describe —
  // not a presence field, so no duplicate here.)
});
