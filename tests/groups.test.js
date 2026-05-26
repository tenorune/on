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
  readMember: jest.fn().mockResolvedValue(null),
  readMembers: jest.fn().mockResolvedValue({}),
  setLastVisited: jest.fn(),
  setCurrentContext: jest.fn(),
}));

const db = require('../js/db.js');
const { createGroup, renameGroup, deleteGroup, leaveGroup } = require('../js/groups');

describe('createGroup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.claimGroupId.mockResolvedValue(true);
    db.writeGroup.mockResolvedValue();
    db.writeMember.mockResolvedValue();
    db.writeUserGroupsEntry.mockResolvedValue();
  });

  test('validates name: trim, non-empty, max 40 chars', async () => {
    await expect(createGroup('uid1', '  ', 'Mike')).rejects.toThrow(/empty/i);
    await expect(createGroup('uid1', 'x'.repeat(41), 'Mike')).rejects.toThrow(/40/);
  });

  test('validates owner displayName: trim, non-empty, max 40 chars', async () => {
    await expect(createGroup('uid1', 'Family', '   ')).rejects.toThrow(/empty/i);
    await expect(createGroup('uid1', 'Family', 'x'.repeat(41))).rejects.toThrow(/40/);
  });

  test('happy path: claims id, writes group, writes owner member, writes user enumeration', async () => {
    const result = await createGroup('uid1', '  Family  ', '  Mike  ');
    expect(result).toMatchObject({ groupId: expect.stringMatching(/^[A-Z0-9]{8}$/) });
    expect(db.claimGroupId).toHaveBeenCalledWith(result.groupId);
    expect(db.writeGroup).toHaveBeenCalledWith(result.groupId, expect.objectContaining({
      name: 'Family',
      ownerId: 'uid1',
      createdAt: expect.any(Number),
    }));
    expect(db.writeMember).toHaveBeenCalledWith(result.groupId, 'uid1', expect.objectContaining({
      role: 'owner',
      displayName: 'Mike',
      joinedAt: expect.any(Number),
    }));
    expect(db.writeUserGroupsEntry).toHaveBeenCalledWith('uid1', result.groupId, expect.objectContaining({
      lastVisited: expect.any(Number),
    }));
  });

  test('retries on group-id collision', async () => {
    db.claimGroupId.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const result = await createGroup('uid1', 'Family', 'Mike');
    expect(db.claimGroupId).toHaveBeenCalledTimes(2);
    expect(result.groupId).toMatch(/^[A-Z0-9]{8}$/);
  });

  test('throws after exhausting retry budget', async () => {
    db.claimGroupId.mockResolvedValue(false);
    await expect(createGroup('uid1', 'Family', 'Mike')).rejects.toThrow(/allocate/i);
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
