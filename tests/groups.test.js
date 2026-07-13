// tests/groups.test.js
jest.mock('../js/db.js', () => ({
  claimGroupId: jest.fn(),
  writeGroup: jest.fn(),
  writeMember: jest.fn(),
  writeUserGroupsEntry: jest.fn(),
  removeUserGroupsEntry: jest.fn(),
  removeMember: jest.fn(),
  deleteGroup: jest.fn(),
  renameGroup: jest.fn(),
  setMemberDisplayName: jest.fn(),
  readGroup: jest.fn().mockResolvedValue(null),
  readGroupName: jest.fn().mockResolvedValue(null),
  readMember: jest.fn().mockResolvedValue(null),
  readMembers: jest.fn().mockResolvedValue({}),
  setLastVisited: jest.fn(),
  setCurrentContext: jest.fn(),
  watchUserGroups: jest.fn(() => () => {}),
  setStatusOverride: jest.fn(),
  clearStatusOverride: jest.fn(),
  mergeStatusOverride: jest.fn().mockResolvedValue(undefined),
  watchPendingInvites: jest.fn(() => () => {}),
  writePendingInvite: jest.fn().mockResolvedValue(undefined),
  deletePendingInvite: jest.fn().mockResolvedValue(undefined),
  readPendingInviteesForGroup: jest.fn().mockResolvedValue([]),
}));

jest.mock('../js/groupNav.js', () => ({
  navigateToDirect: jest.fn().mockResolvedValue(undefined),
  getCurrentContext: jest.fn(() => ({ context: 'direct', groupId: null })),
  getLastKnownGroupName: jest.fn(() => null),
}));

jest.mock('../js/prefs.js', () => ({
  clearGroupPaletteState: jest.fn(),
}));

const db = require('../js/db.js');
const groupNav = require('../js/groupNav.js');
const prefs = require('../js/prefs.js');
const { createGroup, renameGroup, deleteGroup, leaveGroup, joinGroup, editOwnDisplayName, initGroupRemovalDetector, _resetGroupRemovalDetectorForTests, _feedSnapshotForTests, toggleStatusOverride, setOverrideStatusAvailable, setOverrideStatusUnavailable, generateGroupId } = require('../js/groups');
const { GROUP_ID_RE } = require('../shared/idFormats.js');

describe('generateGroupId (group id generator)', () => {
  // The generator, the shared GROUP_ID_RE, and database.rules.json must agree on
  // the group-id format (js/ ↔ functions/ ↔ rules trust boundary). idFormats.test.js
  // pins the regex to the rules literal; this binds the generator to the regex, so
  // widening ID_ALPHABET or changing the length can't silently diverge the id the
  // client mints from the format everything else validates.
  test('produces ids that match the shared GROUP_ID_RE', () => {
    expect(typeof generateGroupId).toBe('function');
    for (let i = 0; i < 1000; i += 1) {
      expect(GROUP_ID_RE.test(generateGroupId())).toBe(true);
    }
  });
});

describe('createGroup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.claimGroupId.mockResolvedValue(true);
    db.writeGroup.mockResolvedValue();
    db.writeMember.mockResolvedValue();
    db.writeUserGroupsEntry.mockResolvedValue();
  });

  test('validates name: trim, non-empty, max 40 chars', async () => {
    await expect(createGroup('uid1', '  ', 'Alex')).rejects.toThrow(/empty/i);
    await expect(createGroup('uid1', 'x'.repeat(41), 'Alex')).rejects.toThrow(/40/);
  });

  test('validates owner displayName: trim, non-empty, max 40 chars', async () => {
    await expect(createGroup('uid1', 'Family', '   ')).rejects.toThrow(/empty/i);
    await expect(createGroup('uid1', 'Family', 'x'.repeat(41))).rejects.toThrow(/40/);
  });

  test('happy path: claims id, writes group, writes owner member, writes user enumeration', async () => {
    const result = await createGroup('uid1', '  Family  ', '  Alex  ');
    expect(result).toMatchObject({ groupId: expect.stringMatching(/^[A-Z0-9]{8}$/) });
    expect(db.claimGroupId).toHaveBeenCalledWith(result.groupId);
    expect(db.writeGroup).toHaveBeenCalledWith(result.groupId, expect.objectContaining({
      name: 'Family',
      ownerId: 'uid1',
      createdAt: expect.any(Number),
    }));
    expect(db.writeMember).toHaveBeenCalledWith(result.groupId, 'uid1', expect.objectContaining({
      role: 'owner',
      displayName: 'Alex',
      joinedAt: expect.any(Number),
      // Override defaults ON so a newly-created group doesn't auto-broadcast
      // the owner's primary status.
      statusOverride: { enabled: true, status: 'available', availableUntil: expect.any(Number) },
    }));
    expect(db.writeUserGroupsEntry).toHaveBeenCalledWith('uid1', result.groupId, expect.objectContaining({
      lastVisited: expect.any(Number),
    }));
  });

  test('retries on group-id collision', async () => {
    db.claimGroupId.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const result = await createGroup('uid1', 'Family', 'Alex');
    expect(db.claimGroupId).toHaveBeenCalledTimes(2);
    expect(result.groupId).toMatch(/^[A-Z0-9]{8}$/);
  });

  test('throws after exhausting retry budget', async () => {
    db.claimGroupId.mockResolvedValue(false);
    await expect(createGroup('uid1', 'Family', 'Alex')).rejects.toThrow(/allocate/i);
  });
});

describe('renameGroup', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('validates new name', async () => {
    await expect(renameGroup('G1', 'uid1', '   ')).rejects.toThrow(/empty/i);
    await expect(renameGroup('G1', 'uid1', 'x'.repeat(41))).rejects.toThrow(/40/);
  });

  test('refuses when caller is not the owner', async () => {
    db.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'someoneElse', createdAt: 1 });
    await expect(renameGroup('G1', 'uid1', 'New')).rejects.toThrow(/owner/i);
  });

  test('writes new name when caller is the owner', async () => {
    db.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'uid1', createdAt: 1 });
    db.renameGroup.mockResolvedValue();
    await renameGroup('G1', 'uid1', '  Familia  ');
    expect(db.renameGroup).toHaveBeenCalledWith('G1', 'Familia');
  });
});

describe('deleteGroup', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('refuses when caller is not the owner', async () => {
    db.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'someoneElse', createdAt: 1 });
    await expect(deleteGroup('G1', 'uid1')).rejects.toThrow(/owner/i);
  });

  test('removes the group and the owner\'s enumeration entry when owner deletes', async () => {
    db.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'uid1', createdAt: 1 });
    db.deleteGroup.mockResolvedValue();
    db.removeUserGroupsEntry.mockResolvedValue();
    await deleteGroup('G1', 'uid1');
    expect(db.deleteGroup).toHaveBeenCalledWith('G1');
    expect(db.removeUserGroupsEntry).toHaveBeenCalledWith('uid1', 'G1');
  });

  test('no-ops gracefully when the group is already gone', async () => {
    db.readGroup.mockResolvedValue(null);
    await deleteGroup('G1', 'uid1');
    expect(db.deleteGroup).not.toHaveBeenCalled();
  });

  test('deleteGroup sweeps pending invites for the group', async () => {
    const { readGroup, deleteGroup: dbDeleteGroup, removeUserGroupsEntry,
            readPendingInviteesForGroup, deletePendingInvite } = require('../js/db.js');
    readGroup.mockResolvedValueOnce({ ownerId: 'me', name: 'Family', createdAt: 1 });
    readPendingInviteesForGroup.mockResolvedValueOnce(['inviteeA', 'inviteeB']);

    await deleteGroup('G1', 'me');

    expect(readPendingInviteesForGroup).toHaveBeenCalledWith('G1');
    expect(deletePendingInvite).toHaveBeenCalledWith('inviteeA', 'G1');
    expect(deletePendingInvite).toHaveBeenCalledWith('inviteeB', 'G1');
    expect(dbDeleteGroup).toHaveBeenCalledWith('G1');
    expect(removeUserGroupsEntry).toHaveBeenCalledWith('me', 'G1');
  });

  test('deleteGroup sweeps pending invites BEFORE deleting the group entity', async () => {
    const { readGroup, deleteGroup: dbDeleteGroup,
            readPendingInviteesForGroup, deletePendingInvite } = require('../js/db.js');

    const callOrder = [];
    readGroup.mockResolvedValueOnce({ ownerId: 'me', name: 'Family', createdAt: 1 });
    readPendingInviteesForGroup.mockResolvedValueOnce(['inviteeA', 'inviteeB']);
    deletePendingInvite.mockImplementation((uid) => {
      callOrder.push(`deletePendingInvite:${uid}`);
      return Promise.resolve();
    });
    dbDeleteGroup.mockImplementation((gid) => {
      callOrder.push(`dbDeleteGroup:${gid}`);
      return Promise.resolve();
    });

    await deleteGroup('G1', 'me');

    expect(callOrder.indexOf('deletePendingInvite:inviteeA')).toBeLessThan(callOrder.indexOf('dbDeleteGroup:G1'));
    expect(callOrder.indexOf('deletePendingInvite:inviteeB')).toBeLessThan(callOrder.indexOf('dbDeleteGroup:G1'));
  });
});

describe('leaveGroup', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('refuses when caller is the owner (must delete instead)', async () => {
    db.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'uid1', createdAt: 1 });
    await expect(leaveGroup('G1', 'uid1')).rejects.toThrow(/owner/i);
  });

  test('removes the member record and the user-side enumeration when member leaves', async () => {
    db.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'someoneElse', createdAt: 1 });
    db.removeMember.mockResolvedValue();
    db.removeUserGroupsEntry.mockResolvedValue();
    await leaveGroup('G1', 'uid1');
    expect(db.removeMember).toHaveBeenCalledWith('G1', 'uid1');
    expect(db.removeUserGroupsEntry).toHaveBeenCalledWith('uid1', 'G1');
  });
});

describe('joinGroup', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('validates the display name', async () => {
    await expect(joinGroup('G1', 'uid2', '  ')).rejects.toThrow(/empty/i);
    await expect(joinGroup('G1', 'uid2', 'x'.repeat(41))).rejects.toThrow(/40/);
  });

  test('refuses when the group does not exist', async () => {
    db.readGroup.mockResolvedValue(null);
    await expect(joinGroup('NOPE', 'uid2', 'Alex')).rejects.toThrow(/not found/i);
  });

  test('writes member record + user enumeration when joining', async () => {
    db.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'uid1', createdAt: 1 });
    db.readMember.mockResolvedValue(null);
    db.writeMember.mockResolvedValue();
    db.writeUserGroupsEntry.mockResolvedValue();
    await joinGroup('G1', 'uid2', '  Alex  ');
    expect(db.writeMember).toHaveBeenCalledWith('G1', 'uid2', expect.objectContaining({
      role: 'member',
      displayName: 'Alex',
      joinedAt: expect.any(Number),
      // Override defaults ON so the joiner doesn't auto-broadcast their
      // primary status to the group.
      statusOverride: { enabled: true, status: 'available', availableUntil: expect.any(Number) },
    }));
    expect(db.writeUserGroupsEntry).toHaveBeenCalledWith('uid2', 'G1', expect.objectContaining({
      lastVisited: expect.any(Number),
    }));
  });

  test('idempotent for existing members (no-op writes)', async () => {
    db.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'uid1', createdAt: 1 });
    db.readMember.mockResolvedValue({ role: 'member', displayName: 'Old', joinedAt: 10 });
    await joinGroup('G1', 'uid2', 'Alex');
    expect(db.writeMember).not.toHaveBeenCalled();
    expect(db.writeUserGroupsEntry).toHaveBeenCalled(); // still bumps lastVisited
  });

  test('a fresh join clears stale per-group palette state so a rejoin starts from defaults', async () => {
    // Without this, a member who set e.g. WHITE-in-ROSE, left, and rejoined would
    // land with the stale color seeded into the fresh (color-less) override —
    // an impossible WHITE + default-theme combo.
    db.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'uid1', createdAt: 1 });
    db.readMember.mockResolvedValue(null);
    await joinGroup('G1', 'uid2', 'Alex');
    expect(prefs.clearGroupPaletteState).toHaveBeenCalledWith('G1');
  });

  test('an idempotent (already-member) join does NOT clear palette state', async () => {
    db.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'uid1', createdAt: 1 });
    db.readMember.mockResolvedValue({ role: 'member', displayName: 'Old', joinedAt: 10 });
    await joinGroup('G1', 'uid2', 'Alex');
    expect(prefs.clearGroupPaletteState).not.toHaveBeenCalled();
  });
});

describe('editOwnDisplayName', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('validates the name', async () => {
    await expect(editOwnDisplayName('G1', 'uid1', '   ')).rejects.toThrow(/empty/i);
    await expect(editOwnDisplayName('G1', 'uid1', 'x'.repeat(41))).rejects.toThrow(/40/);
  });

  test('writes new displayName to the caller\'s member record', async () => {
    db.setMemberDisplayName.mockResolvedValue();
    await editOwnDisplayName('G1', 'uid1', '  M. P.  ');
    expect(db.setMemberDisplayName).toHaveBeenCalledWith('G1', 'uid1', 'M. P.');
  });
});

function setupRemovalDom() {
  document.body.innerHTML = `
    <div id="group-removal-toast" class="hidden">
      <span id="group-removal-toast-text"></span>
      <button id="group-removal-toast-dismiss"></button>
    </div>
  `;
}

function flushPromises() { return new Promise(setImmediate); }

describe('group removal detector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupRemovalDom();
    _resetGroupRemovalDetectorForTests();
  });

  test('removal of an enumerated group whose record is gone → deletion toast', async () => {
    db.readGroupName.mockResolvedValue(null);
    // Seed: previously G1+G2 enumerated; new tick: only G2 (G1 was deleted)
    await _feedSnapshotForTests({ G1: true, G2: true });
    await _feedSnapshotForTests({ G2: true });
    await flushPromises();
    expect(document.getElementById('group-removal-toast').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('group-removal-toast-text').textContent.length).toBeGreaterThan(0);
  });

  test('dismiss button hides the toast', async () => {
    db.readGroupName.mockResolvedValue(null);
    initGroupRemovalDetector('me');
    await _feedSnapshotForTests({ G1: true });
    await _feedSnapshotForTests({});
    await flushPromises();
    document.getElementById('group-removal-toast-dismiss').click();
    expect(document.getElementById('group-removal-toast').classList.contains('hidden')).toBe(true);
  });

  test('kick: group exists but member record gone shows the removed-from message', async () => {
    db.readGroupName.mockResolvedValue({ name: 'Family' });
    await _feedSnapshotForTests({ G1: true });
    await _feedSnapshotForTests({});
    await flushPromises();
    expect(document.getElementById('group-removal-toast-text').textContent).toMatch(/removed|Family/i);
  });

  test('leave/kick: whole-group read is denied for a non-member, so the toast uses the name leaf', async () => {
    // After leaving / being kicked the user is no longer a member, so the
    // membership-gated groups/{gid} whole-node read is denied. The detector
    // must read the name leaf (readGroupName) instead.
    db.readGroup.mockRejectedValue(new Error('Permission denied'));
    db.readGroupName.mockResolvedValue({ name: 'Family' });
    await _feedSnapshotForTests({ G1: true });
    await _feedSnapshotForTests({});
    await flushPromises();
    expect(document.getElementById('group-removal-toast-text').textContent).toBe("You've been removed from 'Family'.");
    expect(db.readGroup).not.toHaveBeenCalled();
  });

  test('deletion toast uses the cached group name when available', async () => {
    db.readGroupName.mockResolvedValue(null); // group entity gone
    groupNav.getLastKnownGroupName.mockReturnValue('Family');
    await _feedSnapshotForTests({ G1: true });
    await _feedSnapshotForTests({});
    await flushPromises();
    expect(document.getElementById('group-removal-toast-text').textContent).toBe("'Family' has been deleted.");
  });

  test('deletion toast falls back to groupId when no cached name exists', async () => {
    db.readGroupName.mockResolvedValue(null);
    groupNav.getLastKnownGroupName.mockReturnValue(null);
    await _feedSnapshotForTests({ G1ABCD23: true });
    await _feedSnapshotForTests({});
    await flushPromises();
    expect(document.getElementById('group-removal-toast-text').textContent).toBe("'G1ABCD23' has been deleted.");
  });
});

describe('toggleStatusOverride', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('enables the override with status=unavailable and availableUntil=null, merging so appearance survives', async () => {
    await toggleStatusOverride('G1', 'uidA', true);
    expect(db.mergeStatusOverride).toHaveBeenCalledWith('G1', 'uidA', {
      enabled: true,
      status: 'unavailable',
      availableUntil: null,
    });
    expect(db.setStatusOverride).not.toHaveBeenCalled();
    expect(db.clearStatusOverride).not.toHaveBeenCalled();
  });

  test('disables by merging enabled=false + clearing status/availableUntil; preserves appearance', async () => {
    await toggleStatusOverride('G1', 'uidA', false);
    expect(db.mergeStatusOverride).toHaveBeenCalledWith('G1', 'uidA', {
      enabled: false,
      status: null,
      availableUntil: null,
    });
    expect(db.setStatusOverride).not.toHaveBeenCalled();
    expect(db.clearStatusOverride).not.toHaveBeenCalled();
  });
});

describe('setOverrideStatusAvailable', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('merges enabled=true, status=available, and the given availableUntil', async () => {
    await setOverrideStatusAvailable('G1', 'uidA', 12345);
    expect(db.mergeStatusOverride).toHaveBeenCalledWith('G1', 'uidA', {
      enabled: true,
      status: 'available',
      availableUntil: 12345,
    });
  });
});

describe('setOverrideStatusUnavailable', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('merges enabled=true, status=unavailable, availableUntil=null', async () => {
    await setOverrideStatusUnavailable('G1', 'uidA');
    expect(db.mergeStatusOverride).toHaveBeenCalledWith('G1', 'uidA', {
      enabled: true,
      status: 'unavailable',
      availableUntil: null,
    });
  });
});

describe('end-to-end: create group → group invite → redeem → joined', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('owner can create a group; second user can redeem its invite', async () => {
    const { createGroup } = require('../js/groups');
    const { createGroupInvite, redeemGroupInvite } = require('../js/invites');

    db.claimGroupId.mockResolvedValue(true);
    db.writeGroup.mockResolvedValue();
    db.writeMember.mockResolvedValue();
    db.writeUserGroupsEntry.mockResolvedValue();

    const created = await createGroup('owner-uid', 'Family', 'Alice');
    expect(db.writeGroup).toHaveBeenCalledWith(created.groupId, expect.objectContaining({ name: 'Family', ownerId: 'owner-uid' }));
    expect(db.writeMember).toHaveBeenCalledWith(created.groupId, 'owner-uid', expect.objectContaining({ role: 'owner', displayName: 'Alice' }));

    // Setup mocks for createGroupInvite
    db.readGroupInvites = jest.fn().mockResolvedValueOnce({});
    db.claimInviteToken = jest.fn().mockResolvedValue(true);
    db.writeGroupInvite = jest.fn().mockResolvedValue();
    const invite = await createGroupInvite('owner-uid', created.groupId);
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]{22}$/);

    // Setup mocks for redeemGroupInvite
    db.readInviteIndex = jest.fn().mockResolvedValue({ scope: 'group', ownerPath: `groups/${created.groupId}/invites/${invite.token}` });
    db.readGroup = jest.fn().mockResolvedValue({ name: 'Family', ownerId: 'owner-uid', createdAt: 1 });
    db.readGroupName = jest.fn().mockResolvedValue({ name: 'Family' });
    db.readGroupInvite = jest.fn().mockResolvedValue(
      { scope: 'group', token: invite.token, creatorUid: 'owner-uid', revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0 },
    );
    db.readMember = jest.fn().mockResolvedValue(null);
    db.incrementGroupInviteRedemptions = jest.fn().mockResolvedValue();
    db.writeMember.mockResolvedValue();
    db.writeUserGroupsEntry.mockResolvedValue();

    const redemption = await redeemGroupInvite(invite.token, 'redeemer-uid', 'Alex');
    expect(redemption).toEqual({ ok: true, groupId: created.groupId, groupName: 'Family' });
  });
});
