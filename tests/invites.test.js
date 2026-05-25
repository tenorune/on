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
jest.mock('../js/store.js', () => ({ getFollowing: jest.fn(() => []) }));

const db = require('../js/db.js');
const store = require('../js/store.js');
const { generateInviteToken, createPersonalInvite, revokePersonalInvite, regeneratePersonalInvite, redeemPersonalInvite, attemptRedeemFromUrl, extractInviteTokenFromUrl, resolveInviteCreatorLabel } = require('../js/invites');

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

describe('redeemPersonalInvite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.incrementInviteRedemptions.mockResolvedValue();
    db.registerAsFollower.mockResolvedValue();
    db.setFollowingEntry.mockResolvedValue();
    db.getCreatorCode.mockResolvedValue('ABC123');
  });

  test('happy path: follows the creator and bumps redemption count', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator-uid/invites/TOKEN' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'TOKEN', creatorUid: 'creator-uid', creatorLabel: 'Mike',
      revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 3,
    });
    const result = await redeemPersonalInvite('TOKEN', 'redeemer-uid', 'redeemer-code', new Set());
    expect(result).toEqual({ ok: true, creatorUid: 'creator-uid', creatorCode: 'ABC123', creatorLabel: 'Mike' });
    expect(db.registerAsFollower).toHaveBeenCalledWith('creator-uid', 'redeemer-uid', 'redeemer-code');
    expect(db.setFollowingEntry).toHaveBeenCalledWith('redeemer-uid', 'creator-uid', 'ABC123', '');
    expect(db.incrementInviteRedemptions).toHaveBeenCalledWith('creator-uid', 'TOKEN');
  });

  test('returns not-found when the inviteIndex has no entry', async () => {
    db.readInviteIndex.mockResolvedValue(null);
    const result = await redeemPersonalInvite('BADTOKEN', 'redeemer-uid', 'redeemer-code', new Set());
    expect(result).toEqual({ ok: false, reason: 'not-found' });
    expect(db.registerAsFollower).not.toHaveBeenCalled();
  });

  test('returns not-found when the invite record is missing despite an index entry', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue(null);
    const result = await redeemPersonalInvite('T', 'redeemer', 'code', new Set());
    expect(result).toEqual({ ok: false, reason: 'not-found' });
  });

  test('returns revoked when the invite is revoked', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue({ scope: 'personal', token: 'T', creatorUid: 'creator', revoked: true });
    const result = await redeemPersonalInvite('T', 'redeemer', 'code', new Set());
    expect(result).toEqual({ ok: false, reason: 'revoked' });
  });

  test('returns expired when expiresAt is in the past', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'T', creatorUid: 'creator', revoked: false,
      expiresAt: Date.now() - 1000, redemptionCap: null, redemptionsUsed: 0,
    });
    const result = await redeemPersonalInvite('T', 'redeemer', 'code', new Set());
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  test('returns cap when redemptionsUsed >= redemptionCap', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'T', creatorUid: 'creator', revoked: false,
      expiresAt: null, redemptionCap: 5, redemptionsUsed: 5,
    });
    const result = await redeemPersonalInvite('T', 'redeemer', 'code', new Set());
    expect(result).toEqual({ ok: false, reason: 'cap' });
  });

  test('returns self when the redeemer is the creator', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/redeemer/invites/T' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'T', creatorUid: 'redeemer', revoked: false,
      expiresAt: null, redemptionCap: null, redemptionsUsed: 0,
    });
    const result = await redeemPersonalInvite('T', 'redeemer', 'code', new Set());
    expect(result).toEqual({ ok: false, reason: 'self' });
    expect(db.registerAsFollower).not.toHaveBeenCalled();
    expect(db.incrementInviteRedemptions).not.toHaveBeenCalled();
  });

  test('returns already-following when the redeemer already follows the creator', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'T', creatorUid: 'creator', revoked: false,
      expiresAt: null, redemptionCap: null, redemptionsUsed: 0,
    });
    const result = await redeemPersonalInvite('T', 'redeemer', 'code', new Set(['creator']));
    expect(result).toEqual({ ok: false, reason: 'already-following' });
    expect(db.registerAsFollower).not.toHaveBeenCalled();
    expect(db.incrementInviteRedemptions).not.toHaveBeenCalled();
  });

  test('returns creator-missing when getCreatorCode returns null', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'T', creatorUid: 'creator', revoked: false,
      expiresAt: null, redemptionCap: null, redemptionsUsed: 0,
    });
    db.getCreatorCode.mockResolvedValue(null);
    const result = await redeemPersonalInvite('T', 'redeemer', 'code', new Set());
    expect(result).toEqual({ ok: false, reason: 'creator-missing' });
  });

  test('accepts a null alreadyFollowingSet without throwing', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'T', creatorUid: 'creator', creatorLabel: 'Mike',
      revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0,
    });
    const result = await redeemPersonalInvite('T', 'redeemer', 'code', null);
    expect(result.ok).toBe(true);
    expect(result.creatorUid).toBe('creator');
  });
});

describe('extractInviteTokenFromUrl', () => {
  test('returns the token when ?i= is present', () => {
    expect(extractInviteTokenFromUrl('https://app.example/?i=ABC123')).toBe('ABC123');
  });

  test('returns null when ?i= is missing', () => {
    expect(extractInviteTokenFromUrl('https://app.example/')).toBeNull();
  });

  test('returns null on a malformed token', () => {
    expect(extractInviteTokenFromUrl('https://app.example/?i=' + 'x'.repeat(80))).toBeNull();
    expect(extractInviteTokenFromUrl('https://app.example/?i=has spaces')).toBeNull();
  });

  test('returns null on a non-URL input', () => {
    expect(extractInviteTokenFromUrl('not a url')).toBeNull();
  });
});

describe('attemptRedeemFromUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store.getFollowing.mockReturnValue([]);
  });

  test('returns null when token is null', async () => {
    const result = await attemptRedeemFromUrl(null, 'uid', 'code');
    expect(result).toBeNull();
  });

  test('passes the current following set as the already-following check', async () => {
    store.getFollowing.mockReturnValue([{ userId: 'creator', code: 'X', label: '' }]);
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'T', creatorUid: 'creator', revoked: false,
      expiresAt: null, redemptionCap: null, redemptionsUsed: 0,
    });
    const result = await attemptRedeemFromUrl('T', 'me', 'mycode');
    expect(result).toEqual({ ok: false, reason: 'already-following' });
  });
});

describe('boot-time redemption (existing user, integration)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store.getFollowing.mockReturnValue([]);
  });

  test('valid token + existing identity → success result', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/TOKEN' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'TOKEN', creatorUid: 'creator', creatorLabel: 'Mike',
      revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0,
    });
    db.getCreatorCode.mockResolvedValue('ABC123');
    const result = await attemptRedeemFromUrl('TOKEN', 'redeemer-uid', 'redeemer-code');
    expect(result.ok).toBe(true);
    expect(result.creatorUid).toBe('creator');
  });
});

describe('resolveInviteCreatorLabel', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns null when token is empty', async () => {
    expect(await resolveInviteCreatorLabel(null)).toBeNull();
    expect(await resolveInviteCreatorLabel('')).toBeNull();
    expect(db.readInviteIndex).not.toHaveBeenCalled();
  });

  test('returns the creator label for a valid personal invite', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue({ scope: 'personal', creatorLabel: 'Mike P.', revoked: false });
    expect(await resolveInviteCreatorLabel('T')).toBe('Mike P.');
  });

  test('returns null when the invite is revoked', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue({ scope: 'personal', creatorLabel: 'Mike', revoked: true });
    expect(await resolveInviteCreatorLabel('T')).toBeNull();
  });

  test('returns null when the scope is not personal', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'group', ownerPath: 'groups/G/invites/T' });
    expect(await resolveInviteCreatorLabel('T')).toBeNull();
    expect(db.readUserInvite).not.toHaveBeenCalled();
  });

  test('returns null when the index lookup throws', async () => {
    db.readInviteIndex.mockRejectedValue(new Error('network down'));
    expect(await resolveInviteCreatorLabel('T')).toBeNull();
  });
});

describe('welcome screen invite framing', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = `
      <div id="welcome-screen" class="welcome-screen hidden">
        <p id="welcome-invite-framing" class="hidden"></p>
        <button id="welcome-new-btn">I'm new</button>
        <button id="welcome-restore-btn">I have a secret phrase</button>
      </div>
    `;
  });

  test('showWelcomeScreen without an invite hides the framing line', async () => {
    const { showWelcomeScreen } = require('../js/app');
    // Fire-and-forget the promise; we only care about initial DOM state.
    showWelcomeScreen();
    expect(document.getElementById('welcome-invite-framing').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('welcome-invite-framing').textContent).toBe('');
  });

  test('showWelcomeScreen with a creator label renders the framing text', async () => {
    const { showWelcomeScreen } = require('../js/app');
    showWelcomeScreen({ inviteCreatorLabel: 'Mike P.' });
    const framing = document.getElementById('welcome-invite-framing');
    expect(framing.classList.contains('hidden')).toBe(false);
    expect(framing.textContent).toContain('Mike P.');
    expect(framing.textContent).toContain('First, let');
  });
});
