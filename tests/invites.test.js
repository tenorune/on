// tests/invites.test.js
jest.mock('../js/db.js', () => ({
  claimInviteToken: jest.fn(),
  releaseInviteToken: jest.fn(),
  readInviteIndex: jest.fn(),
  readUserInvite: jest.fn(),
  readUserInvites: jest.fn(),
  writeUserInvite: jest.fn(),
  deleteUserInvite: jest.fn(),
  setInviteRevoked: jest.fn(),
  incrementInviteRedemptions: jest.fn(),
  getCreatorCode: jest.fn(),
  watchUserInvites: jest.fn(() => () => {}),
  // Existing exports we may exercise transitively:
  registerAsFollower: jest.fn().mockResolvedValue(undefined),
  setFollowingEntry: jest.fn().mockResolvedValue(undefined),
  lookupCode: jest.fn(),
}));

const db = require('../js/db.js');
const { generateInviteToken, createPersonalInvite, revokePersonalInvite, regeneratePersonalInvite } = require('../js/invites');

describe('generateInviteToken', () => {
  test('returns a 22-char URL-safe base64 string', () => {
    const token = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  test('produces distinct values across calls', () => {
    const tokens = new Set(Array.from({ length: 100 }, generateInviteToken));
    expect(tokens.size).toBe(100);
  });
});

describe('createPersonalInvite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.watchUserInvites.mockReturnValue(() => {});
  });

  test('creates a new invite when none exists', async () => {
    db.readUserInvites.mockResolvedValue({});                 // empty collection
    db.claimInviteToken.mockResolvedValue(true);
    db.writeUserInvite.mockResolvedValue();

    const result = await createPersonalInvite('uid1', 'Mike P.');

    expect(result).toMatchObject({ token: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), url: expect.stringContaining('?i=') });
    expect(db.claimInviteToken).toHaveBeenCalledWith(result.token, `users/uid1/invites/${result.token}`);
    expect(db.writeUserInvite).toHaveBeenCalledWith('uid1', result.token, expect.objectContaining({
      scope: 'personal',
      token: result.token,
      creatorLabel: 'Mike P.',
      creatorUid: 'uid1',
      createdAt: expect.any(Number),
      expiresAt: null,
      redemptionCap: null,
      redemptionsUsed: 0,
      revoked: false,
    }));
  });

  test('returns the existing active invite when one already exists', async () => {
    db.readUserInvites.mockResolvedValue({
      EXISTING22CHARSTRINGAA: { scope: 'personal', token: 'EXISTING22CHARSTRINGAA', creatorLabel: 'Old Name', revoked: false },
    });
    const result = await createPersonalInvite('uid1', 'New Name');
    expect(result.token).toBe('EXISTING22CHARSTRINGAA');
    expect(db.claimInviteToken).not.toHaveBeenCalled();
    expect(db.writeUserInvite).not.toHaveBeenCalled();
  });

  test('creates a new invite when only revoked invites exist', async () => {
    db.readUserInvites.mockResolvedValue({
      OLD22CHARSTRINGAAAAAAA: { scope: 'personal', token: 'OLD22CHARSTRINGAAAAAAA', revoked: true },
    });
    db.claimInviteToken.mockResolvedValue(true);
    db.writeUserInvite.mockResolvedValue();
    const result = await createPersonalInvite('uid1', 'Mike');
    expect(result.token).not.toBe('OLD22CHARSTRINGAAAAAAA');
    expect(db.claimInviteToken).toHaveBeenCalled();
  });

  test('retries on token collision', async () => {
    db.readUserInvites.mockResolvedValue({});
    db.claimInviteToken.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    db.writeUserInvite.mockResolvedValue();
    const result = await createPersonalInvite('uid1', 'Mike');
    expect(db.claimInviteToken).toHaveBeenCalledTimes(2);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  test('validates creatorLabel: trim, non-empty, max 40', async () => {
    db.readUserInvites.mockResolvedValue({});
    db.claimInviteToken.mockResolvedValue(true);
    db.writeUserInvite.mockResolvedValue();

    await expect(createPersonalInvite('uid1', '   ')).rejects.toThrow(/empty/i);
    await expect(createPersonalInvite('uid1', 'x'.repeat(41))).rejects.toThrow(/40/);

    await createPersonalInvite('uid1', '  Mike  ');
    expect(db.writeUserInvite).toHaveBeenLastCalledWith('uid1', expect.any(String), expect.objectContaining({ creatorLabel: 'Mike' }));
  });
});

describe('revokePersonalInvite', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('marks the invite revoked and releases the inviteIndex entry', async () => {
    db.readUserInvites.mockResolvedValue({
      ABC: { scope: 'personal', token: 'ABC', revoked: false },
    });
    db.setInviteRevoked.mockResolvedValue();
    db.releaseInviteToken.mockResolvedValue();

    await revokePersonalInvite('uid1');

    expect(db.setInviteRevoked).toHaveBeenCalledWith('uid1', 'ABC');
    expect(db.releaseInviteToken).toHaveBeenCalledWith('ABC');
  });

  test('no-ops when there is no active invite', async () => {
    db.readUserInvites.mockResolvedValue({
      ABC: { scope: 'personal', token: 'ABC', revoked: true },
    });
    await revokePersonalInvite('uid1');
    expect(db.setInviteRevoked).not.toHaveBeenCalled();
    expect(db.releaseInviteToken).not.toHaveBeenCalled();
  });
});

describe('regeneratePersonalInvite', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('revokes the existing active invite and creates a new one', async () => {
    db.readUserInvites
      .mockResolvedValueOnce({ OLD: { scope: 'personal', token: 'OLD', revoked: false, creatorLabel: 'Mike' } }) // revoke read
      .mockResolvedValueOnce({});                                                                                  // post-revoke read for create
    db.setInviteRevoked.mockResolvedValue();
    db.releaseInviteToken.mockResolvedValue();
    db.claimInviteToken.mockResolvedValue(true);
    db.writeUserInvite.mockResolvedValue();

    const result = await regeneratePersonalInvite('uid1', 'Mike P.');

    expect(db.setInviteRevoked).toHaveBeenCalledWith('uid1', 'OLD');
    expect(db.releaseInviteToken).toHaveBeenCalledWith('OLD');
    expect(db.writeUserInvite).toHaveBeenCalledWith('uid1', result.token, expect.objectContaining({
      scope: 'personal',
      creatorLabel: 'Mike P.',
    }));
    expect(result.token).not.toBe('OLD');
  });

  test('creates a new invite when no active one exists', async () => {
    db.readUserInvites.mockResolvedValue({});
    db.claimInviteToken.mockResolvedValue(true);
    db.writeUserInvite.mockResolvedValue();

    const result = await regeneratePersonalInvite('uid1', 'Mike');

    expect(db.setInviteRevoked).not.toHaveBeenCalled();
    expect(db.releaseInviteToken).not.toHaveBeenCalled();
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});
