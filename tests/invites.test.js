// tests/invites.test.js
jest.mock('../js/notifyPrompt.js', () => ({ requestPermissionAndRegister: jest.fn() }));
jest.mock('../js/firebase-config.js', () => ({ db: {}, getMessagingIfSupported: jest.fn() }));
jest.mock('../js/db.js', () => ({
  claimInviteToken: jest.fn(),
  releaseInviteToken: jest.fn(),
  readInviteIndex: jest.fn(),
  readUserInvite: jest.fn(),
  readUserInvites: jest.fn(),
  writeUserInvite: jest.fn(),
  deleteUserInvite: jest.fn(),
  setInviteRevoked: jest.fn(),
  setInviteLabel: jest.fn(),
  incrementInviteRedemptions: jest.fn(),
  getCreatorCode: jest.fn(),
  watchUserInvites: jest.fn(() => () => {}),
  // Existing exports we may exercise transitively:
  registerAsFollower: jest.fn().mockResolvedValue(undefined),
  setFollowingEntry: jest.fn().mockResolvedValue(undefined),
  lookupCode: jest.fn(),
  writeGroupInvite: jest.fn(),
  readGroupInvites: jest.fn().mockResolvedValue({}),
  readGroupInvite: jest.fn().mockResolvedValue(null),
  setGroupInviteRevoked: jest.fn(),
  incrementGroupInviteRedemptions: jest.fn(),
  watchGroupInvites: jest.fn(() => () => {}),
  readGroup: jest.fn().mockResolvedValue(null),
  readGroupName: jest.fn().mockResolvedValue(null),
  readMember: jest.fn().mockResolvedValue(null),
  watchPendingInvites: jest.fn(() => () => {}),
  writePendingInvite: jest.fn().mockResolvedValue(undefined),
  deletePendingInvite: jest.fn().mockResolvedValue(undefined),
  readPendingInviteesForGroup: jest.fn().mockResolvedValue([]),
  callResolveInvitePreview: jest.fn(),
}));
jest.mock('../js/store.js', () => ({ getFollowing: jest.fn(() => []) }));
jest.mock('../js/groups.js', () => ({
  joinGroup: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../js/auth.js', () => ({ ensureSignedIn: jest.fn().mockResolvedValue(undefined) }));

// telegram.js imports firebase/auth directly (not through js/auth.js's mock
// above), so without this it drags the real firebase/auth module into jsdom.
jest.mock('../js/telegram.js', () => ({
  isTelegramContext: jest.fn(() => false),
  ensureTelegramIdentity: jest.fn(),
}));

// devReset.js also imports firebase/auth directly, same reasoning as above.
jest.mock('../js/devReset.js', () => ({ maybeRunDevReset: jest.fn().mockResolvedValue(false) }));

const db = require('../js/db.js');
const store = require('../js/store.js');
const groups = require('../js/groups.js');
const { generateInviteToken, createPersonalInvite, revokePersonalInvite, regeneratePersonalInvite, updateInviteLabel, redeemPersonalInvite, attemptRedeemFromUrl, extractInviteTokenFromUrl, extractInboxIntentFromUrl, extractDirectIntentFromUrl, resolveInviteCreatorLabel } = require('../js/invites');

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

    const result = await createPersonalInvite('uid1', 'Alex K.');

    expect(result).toMatchObject({ token: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), url: expect.stringContaining('?i=') });
    expect(db.claimInviteToken).toHaveBeenCalledWith(result.token, `users/uid1/invites/${result.token}`, 'uid1');
    expect(db.writeUserInvite).toHaveBeenCalledWith('uid1', result.token, expect.objectContaining({
      scope: 'personal',
      token: result.token,
      creatorLabel: 'Alex K.',
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
    const result = await createPersonalInvite('uid1', 'Alex');
    expect(result.token).not.toBe('OLD22CHARSTRINGAAAAAAA');
    expect(db.claimInviteToken).toHaveBeenCalled();
  });

  test('retries on token collision', async () => {
    db.readUserInvites.mockResolvedValue({});
    db.claimInviteToken.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    db.writeUserInvite.mockResolvedValue();
    const result = await createPersonalInvite('uid1', 'Alex');
    expect(db.claimInviteToken).toHaveBeenCalledTimes(2);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  test('validates creatorLabel: trim, non-empty, max 40', async () => {
    db.readUserInvites.mockResolvedValue({});
    db.claimInviteToken.mockResolvedValue(true);
    db.writeUserInvite.mockResolvedValue();

    await expect(createPersonalInvite('uid1', '   ')).rejects.toThrow(/empty/i);
    await expect(createPersonalInvite('uid1', 'x'.repeat(41))).rejects.toThrow(/40/);

    await createPersonalInvite('uid1', '  Alex  ');
    expect(db.writeUserInvite).toHaveBeenLastCalledWith('uid1', expect.any(String), expect.objectContaining({ creatorLabel: 'Alex' }));
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
      .mockResolvedValueOnce({ OLD: { scope: 'personal', token: 'OLD', revoked: false, creatorLabel: 'Alex' } }) // revoke read
      .mockResolvedValueOnce({});                                                                                  // post-revoke read for create
    db.setInviteRevoked.mockResolvedValue();
    db.releaseInviteToken.mockResolvedValue();
    db.claimInviteToken.mockResolvedValue(true);
    db.writeUserInvite.mockResolvedValue();

    const result = await regeneratePersonalInvite('uid1', 'Alex K.');

    expect(db.setInviteRevoked).toHaveBeenCalledWith('uid1', 'OLD');
    expect(db.releaseInviteToken).toHaveBeenCalledWith('OLD');
    expect(db.writeUserInvite).toHaveBeenCalledWith('uid1', result.token, expect.objectContaining({
      scope: 'personal',
      creatorLabel: 'Alex K.',
    }));
    expect(result.token).not.toBe('OLD');
  });

  test('creates a new invite when no active one exists', async () => {
    db.readUserInvites.mockResolvedValue({});
    db.claimInviteToken.mockResolvedValue(true);
    db.writeUserInvite.mockResolvedValue();

    const result = await regeneratePersonalInvite('uid1', 'Alex');

    expect(db.setInviteRevoked).not.toHaveBeenCalled();
    expect(db.releaseInviteToken).not.toHaveBeenCalled();
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe('updateInviteLabel', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('rewrites just the creatorLabel on the existing invite (token unchanged)', async () => {
    db.setInviteLabel.mockResolvedValue();

    const result = await updateInviteLabel('uid1', 'T1', 'Tenorune');

    expect(db.setInviteLabel).toHaveBeenCalledWith('uid1', 'T1', 'Tenorune');
    expect(result).toBe('Tenorune');
  });

  test('validates the label (trims, rejects empty / over-long)', async () => {
    db.setInviteLabel.mockResolvedValue();

    await expect(updateInviteLabel('uid1', 'T1', '   ')).rejects.toThrow(/empty/i);
    await expect(updateInviteLabel('uid1', 'T1', 'x'.repeat(41))).rejects.toThrow(/40/);
    expect(db.setInviteLabel).not.toHaveBeenCalled();

    await updateInviteLabel('uid1', 'T1', '  Ana  ');
    expect(db.setInviteLabel).toHaveBeenCalledWith('uid1', 'T1', 'Ana');
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
      scope: 'personal', token: 'TOKEN', creatorUid: 'creator-uid', creatorLabel: 'Alex',
      revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 3,
    });
    const result = await redeemPersonalInvite('TOKEN', 'redeemer-uid', 'redeemer-code', new Set());
    expect(result).toEqual({ ok: true, creatorUid: 'creator-uid', creatorCode: 'ABC123', creatorLabel: 'Alex' });
    expect(db.registerAsFollower).toHaveBeenCalledWith('creator-uid', 'redeemer-uid', 'redeemer-code', undefined);
    expect(db.setFollowingEntry).toHaveBeenCalledWith('redeemer-uid', 'creator-uid', 'ABC123', 'Alex');
    expect(db.incrementInviteRedemptions).toHaveBeenCalledWith('creator-uid', 'TOKEN');
  });

  test('forwards the redeemer name to registerAsFollower so the creator can name the follower', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator-uid/invites/TOKEN' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'TOKEN', creatorUid: 'creator-uid', creatorLabel: 'Alex',
      revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0,
    });
    await redeemPersonalInvite('TOKEN', 'redeemer-uid', 'redeemer-code', new Set(), 'Bea');
    expect(db.registerAsFollower).toHaveBeenCalledWith('creator-uid', 'redeemer-uid', 'redeemer-code', 'Bea');
  });

  test('falls back to an empty follow label when the invite has no creatorLabel', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'T', creatorUid: 'creator',
      revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0,
    });
    await redeemPersonalInvite('T', 'redeemer', 'code', new Set());
    expect(db.setFollowingEntry).toHaveBeenCalledWith('redeemer', 'creator', 'ABC123', '');
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
      scope: 'personal', token: 'T', creatorUid: 'creator', creatorLabel: 'Alex',
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

describe('extractInboxIntentFromUrl', () => {
  test('true when ?inbox=1 is present (cold-start invite/follow-request deep-link)', () => {
    expect(extractInboxIntentFromUrl('https://app.example/?inbox=1')).toBe(true);
  });

  test('false when ?inbox is absent', () => {
    expect(extractInboxIntentFromUrl('https://app.example/')).toBe(false);
    expect(extractInboxIntentFromUrl('https://app.example/?i=ABC123')).toBe(false);
  });

  test('false for any value other than 1 (only the deep-link writes inbox=1)', () => {
    expect(extractInboxIntentFromUrl('https://app.example/?inbox=0')).toBe(false);
    expect(extractInboxIntentFromUrl('https://app.example/?inbox=yes')).toBe(false);
  });

  test('false on a non-URL input', () => {
    expect(extractInboxIntentFromUrl('not a url')).toBe(false);
  });
});

describe('extractDirectIntentFromUrl', () => {
  test('true when ?direct=1 is present (cold-start Direct knock/call/availability)', () => {
    expect(extractDirectIntentFromUrl('https://app.example/?direct=1')).toBe(true);
  });

  test('false when ?direct is absent or not 1', () => {
    expect(extractDirectIntentFromUrl('https://app.example/')).toBe(false);
    expect(extractDirectIntentFromUrl('https://app.example/?direct=0')).toBe(false);
    expect(extractDirectIntentFromUrl('https://app.example/?inbox=1')).toBe(false);
  });

  test('false on a non-URL input', () => {
    expect(extractDirectIntentFromUrl('not a url')).toBe(false);
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

  test('threads opts.redeemerName through to the personal redeem', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'T', creatorUid: 'creator', creatorLabel: 'Alex',
      revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0,
    });
    db.getCreatorCode.mockResolvedValue('ABC123');
    await attemptRedeemFromUrl('T', 'me', 'mycode', { redeemerName: 'Bea' });
    expect(db.registerAsFollower).toHaveBeenCalledWith('creator', 'me', 'mycode', 'Bea');
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
      scope: 'personal', token: 'TOKEN', creatorUid: 'creator', creatorLabel: 'Alex',
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
    db.readUserInvite.mockResolvedValue({ scope: 'personal', creatorLabel: 'Alex K.', revoked: false });
    expect(await resolveInviteCreatorLabel('T')).toBe('Alex K.');
  });

  test('returns null when the invite is revoked', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue({ scope: 'personal', creatorLabel: 'Alex', revoked: true });
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

describe('resolveInvitePreview', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns null for empty token without calling the function', async () => {
    const { resolveInvitePreview } = require('../js/invites');
    expect(await resolveInvitePreview(null)).toBeNull();
    expect(db.callResolveInvitePreview).not.toHaveBeenCalled();
  });

  test('passes the token to the callable and returns its preview', async () => {
    const { resolveInvitePreview } = require('../js/invites');
    db.callResolveInvitePreview.mockResolvedValue({ scope: 'personal', label: 'Alex K.' });
    expect(await resolveInvitePreview('T')).toEqual({ scope: 'personal', label: 'Alex K.' });
    expect(db.callResolveInvitePreview).toHaveBeenCalledWith('T');
  });

  test('passes through a group preview', async () => {
    const { resolveInvitePreview } = require('../js/invites');
    db.callResolveInvitePreview.mockResolvedValue({ scope: 'group', groupName: 'Family', groupId: 'G1' });
    expect(await resolveInvitePreview('T')).toEqual({ scope: 'group', groupName: 'Family', groupId: 'G1' });
  });

  test('returns null when the callable yields null (revoked/missing)', async () => {
    const { resolveInvitePreview } = require('../js/invites');
    db.callResolveInvitePreview.mockResolvedValue(null);
    expect(await resolveInvitePreview('NOPE')).toBeNull();
  });

});

describe('resolveInvitePreview error contract (W1 J#1)', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('invalid token (callable returns null) → null', async () => {
    const { resolveInvitePreview } = require('../js/invites');
    db.callResolveInvitePreview.mockResolvedValue(null);
    await expect(resolveInvitePreview('tok')).resolves.toBeNull();
  });

  test('one transport failure then success → preview (internal retry)', async () => {
    const { resolveInvitePreview } = require('../js/invites');
    db.callResolveInvitePreview
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ scope: 'personal', label: 'Ana' });
    await expect(resolveInvitePreview('tok')).resolves.toEqual({ scope: 'personal', label: 'Ana' });
    expect(db.callResolveInvitePreview).toHaveBeenCalledTimes(2);
  });

  test('two transport failures → throws invite-preview-unavailable', async () => {
    const { resolveInvitePreview } = require('../js/invites');
    db.callResolveInvitePreview.mockRejectedValue(new Error('network'));
    await expect(resolveInvitePreview('tok')).rejects.toThrow('invite-preview-unavailable');
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
    showWelcomeScreen({ inviteCreatorLabel: 'Alex K.' });
    const framing = document.getElementById('welcome-invite-framing');
    expect(framing.classList.contains('hidden')).toBe(false);
    expect(framing.textContent).toContain('Alex K.');
    expect(framing.textContent).toContain('First, let');
  });

  test('showWelcomeScreen with inviteGroupName renders the join-group framing', async () => {
    const { showWelcomeScreen } = require('../js/app');
    showWelcomeScreen({ inviteGroupName: 'Family' });
    const framing = document.getElementById('welcome-invite-framing');
    expect(framing.classList.contains('hidden')).toBe(false);
    expect(framing.textContent).toContain('join Family');
    expect(framing.textContent).toContain('First, let');
  });
});

const { createGroupInvite, revokeGroupInvite, regenerateGroupInvite } = require('../js/invites');

describe('createGroupInvite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.claimInviteToken.mockResolvedValue(true);
    db.writeGroupInvite.mockResolvedValue();
  });

  test('creates a new group invite when none exists for this (creator, group)', async () => {
    db.readGroupInvites.mockResolvedValue({});
    const result = await createGroupInvite('uid1', 'G1');
    expect(result).toMatchObject({
      token: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      url: expect.stringContaining('?i='),
    });
    expect(db.claimInviteToken).toHaveBeenCalledWith(result.token, `groups/G1/invites/${result.token}`, 'uid1');
    expect(db.writeGroupInvite).toHaveBeenCalledWith('G1', result.token, expect.objectContaining({
      scope: 'group',
      token: result.token,
      creatorUid: 'uid1',
      createdAt: expect.any(Number),
      expiresAt: null,
      redemptionCap: null,
      redemptionsUsed: 0,
      revoked: false,
    }));
  });

  test('returns the existing active invite for this creator + group', async () => {
    db.readGroupInvites.mockResolvedValue({
      EXISTING22CHARSTRINGAA: { scope: 'group', token: 'EXISTING22CHARSTRINGAA', creatorUid: 'uid1', revoked: false },
    });
    const result = await createGroupInvite('uid1', 'G1');
    expect(result.token).toBe('EXISTING22CHARSTRINGAA');
    expect(db.claimInviteToken).not.toHaveBeenCalled();
  });

  test("ignores other creators' invites when checking the constraint", async () => {
    db.readGroupInvites.mockResolvedValue({
      OTHER22CHARSTRINGAAAAA: { scope: 'group', token: 'OTHER22CHARSTRINGAAAAA', creatorUid: 'someoneElse', revoked: false },
    });
    const result = await createGroupInvite('uid1', 'G1');
    expect(db.claimInviteToken).toHaveBeenCalled();
    expect(result.token).not.toBe('OTHER22CHARSTRINGAAAAA');
  });
});

describe('revokeGroupInvite', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test("marks the caller's active invite revoked + releases inviteIndex", async () => {
    db.readGroupInvites.mockResolvedValue({
      ABC: { scope: 'group', token: 'ABC', creatorUid: 'uid1', revoked: false },
    });
    db.setGroupInviteRevoked.mockResolvedValue();
    db.releaseInviteToken.mockResolvedValue();
    await revokeGroupInvite('uid1', 'G1');
    expect(db.setGroupInviteRevoked).toHaveBeenCalledWith('G1', 'ABC');
    expect(db.releaseInviteToken).toHaveBeenCalledWith('ABC');
  });

  test('no-ops when caller has no active invite for this group', async () => {
    db.readGroupInvites.mockResolvedValue({
      ABC: { scope: 'group', token: 'ABC', creatorUid: 'someoneElse', revoked: false },
    });
    await revokeGroupInvite('uid1', 'G1');
    expect(db.setGroupInviteRevoked).not.toHaveBeenCalled();
  });
});

describe('regenerateGroupInvite', () => {
  test('revoke + create with empty pre-revoke', async () => {
    db.readGroupInvites
      .mockResolvedValueOnce({ OLD: { scope: 'group', token: 'OLD', creatorUid: 'uid1', revoked: false } })
      .mockResolvedValueOnce({});
    db.setGroupInviteRevoked.mockResolvedValue();
    db.releaseInviteToken.mockResolvedValue();
    db.claimInviteToken.mockResolvedValue(true);
    db.writeGroupInvite.mockResolvedValue();
    const result = await regenerateGroupInvite('uid1', 'G1');
    expect(db.setGroupInviteRevoked).toHaveBeenCalledWith('G1', 'OLD');
    expect(db.releaseInviteToken).toHaveBeenCalledWith('OLD');
    expect(result.token).not.toBe('OLD');
  });
});

describe('full flow: create → redeem (integration)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store.getFollowing.mockReturnValue([]);
  });

  test('createPersonalInvite → attemptRedeemFromUrl results in follow plumbing for the redeemer', async () => {
    // 1. User A creates an invite.
    db.readUserInvites.mockResolvedValue({}); // no active invites yet
    db.claimInviteToken.mockResolvedValue(true);
    db.writeUserInvite.mockResolvedValue();

    const created = await createPersonalInvite('user-a', 'Alice');

    expect(db.writeUserInvite).toHaveBeenCalledWith('user-a', created.token, expect.objectContaining({ creatorLabel: 'Alice' }));

    // 2. User B taps the invite URL → token extracted.
    const token = extractInviteTokenFromUrl(created.url);
    expect(token).toBe(created.token);

    // 3. Boot-time redemption fires for User B (existing identity, not following Alice yet).
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: `users/user-a/invites/${token}` });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token, creatorUid: 'user-a', creatorLabel: 'Alice',
      revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0,
    });
    db.getCreatorCode.mockResolvedValue('AAA111');

    const result = await attemptRedeemFromUrl(token, 'user-b', 'BBB222');
    expect(result.ok).toBe(true);
    expect(result.creatorCode).toBe('AAA111');
    expect(result.creatorLabel).toBe('Alice');
    expect(db.registerAsFollower).toHaveBeenCalledWith('user-a', 'user-b', 'BBB222', undefined);
    expect(db.setFollowingEntry).toHaveBeenCalledWith('user-b', 'user-a', 'AAA111', 'Alice');
    expect(db.incrementInviteRedemptions).toHaveBeenCalledWith('user-a', token);
  });
});

const { redeemGroupInvite } = require('../js/invites');

describe('redeemGroupInvite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.incrementGroupInviteRedemptions.mockResolvedValue();
  });

  test('happy path: joins the group, passing the token through (the callable bumps redemption count server-side)', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'group', ownerPath: 'groups/G1/invites/TOKEN' });
    db.readGroupName.mockResolvedValue({ name: 'Family' });
    db.readGroupInvite.mockResolvedValue(
      { scope: 'group', token: 'TOKEN', creatorUid: 'uid1', revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0 },
    );
    db.readMember.mockResolvedValue(null);

    const result = await redeemGroupInvite('TOKEN', 'redeemer-uid', 'Alex');
    expect(result).toEqual({ ok: true, groupId: 'G1', groupName: 'Family' });
    expect(groups.joinGroup).toHaveBeenCalledWith('G1', 'redeemer-uid', 'Alex', expect.objectContaining({
      group: expect.objectContaining({ name: 'Family' }),
      existing: null,
      token: 'TOKEN',
    }));
    // Fix 2b: the redemptionsUsed bump moved server-side into the joinGroup
    // callable (functions/group-join.js); the client no longer calls this.
    expect(db.incrementGroupInviteRedemptions).not.toHaveBeenCalled();
  });

  test('returns not-found when the index lookup is empty', async () => {
    db.readInviteIndex.mockResolvedValue(null);
    expect(await redeemGroupInvite('BAD', 'redeemer', 'Alex')).toEqual({ ok: false, reason: 'not-found' });
  });

  test('returns not-found when scope is personal', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/u/invites/T' });
    expect(await redeemGroupInvite('T', 'redeemer', 'Alex')).toEqual({ ok: false, reason: 'not-found' });
  });

  test('returns revoked / expired / cap as appropriate', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'group', ownerPath: 'groups/G1/invites/T' });
    db.readGroupName.mockResolvedValue({ name: 'Family' });

    db.readGroupInvite.mockResolvedValueOnce({ scope: 'group', token: 'T', creatorUid: 'uid1', revoked: true });
    expect(await redeemGroupInvite('T', 'redeemer', 'Alex')).toEqual({ ok: false, reason: 'revoked' });

    db.readGroupInvite.mockResolvedValueOnce({ scope: 'group', token: 'T', creatorUid: 'uid1', revoked: false, expiresAt: Date.now() - 1000 });
    expect(await redeemGroupInvite('T', 'redeemer', 'Alex')).toEqual({ ok: false, reason: 'expired' });

    db.readGroupInvite.mockResolvedValueOnce({ scope: 'group', token: 'T', creatorUid: 'uid1', revoked: false, expiresAt: null, redemptionCap: 5, redemptionsUsed: 5 });
    expect(await redeemGroupInvite('T', 'redeemer', 'Alex')).toEqual({ ok: false, reason: 'cap' });
  });

  test('returns already-member when the redeemer is already in the group', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'group', ownerPath: 'groups/G1/invites/T' });
    db.readGroupName.mockResolvedValue({ name: 'Family' });
    db.readGroupInvite.mockResolvedValue({ scope: 'group', token: 'T', creatorUid: 'uid1', revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0 });
    db.readMember.mockResolvedValue({ role: 'member', displayName: 'Existing', joinedAt: 1 });
    expect(await redeemGroupInvite('T', 'redeemer', 'Alex')).toEqual({ ok: false, reason: 'already-member', groupId: 'G1', groupName: 'Family' });
    expect(groups.joinGroup).not.toHaveBeenCalled();
  });

  test('returns group-missing when the group record is gone', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'group', ownerPath: 'groups/G1/invites/T' });
    db.readGroupName.mockResolvedValue(null);
    expect(await redeemGroupInvite('T', 'redeemer', 'Alex')).toEqual({ ok: false, reason: 'group-missing' });
  });

  test('returns invalid-display-name when joinGroup rejects a bad name', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'group', ownerPath: 'groups/G1/invites/T' });
    db.readGroupInvite.mockResolvedValue(
      { scope: 'group', token: 'T', creatorUid: 'uid1', revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0 },
    );
    db.readMember.mockResolvedValue(null);
    db.readGroupName.mockResolvedValue({ name: 'Family' });
    groups.joinGroup.mockRejectedValueOnce(new Error('Display name cannot be empty.'));
    const result = await redeemGroupInvite('T', 'redeemer', '   ');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid-display-name');
    expect(result.message).toMatch(/empty/i);
    expect(db.incrementGroupInviteRedemptions).not.toHaveBeenCalled();
  });

  test('returns group-missing when joinGroup throws Group not found (TOCTOU race)', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'group', ownerPath: 'groups/G1/invites/T' });
    db.readGroupInvite.mockResolvedValue(
      { scope: 'group', token: 'T', creatorUid: 'uid1', revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0 },
    );
    db.readMember.mockResolvedValue(null);
    db.readGroupName.mockResolvedValue({ name: 'Family' });
    groups.joinGroup.mockRejectedValueOnce(new Error('Group not found.'));
    expect(await redeemGroupInvite('T', 'redeemer', 'Alex')).toEqual({ ok: false, reason: 'group-missing' });
  });

  test('returns revoked when joinGroup callable rejects with revoked (raced against pre-check)', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'group', ownerPath: 'groups/G1/invites/T' });
    db.readGroupInvite.mockResolvedValue(
      { scope: 'group', token: 'T', creatorUid: 'uid1', revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0 },
    );
    db.readMember.mockResolvedValue(null);
    db.readGroupName.mockResolvedValue({ name: 'Family' });
    groups.joinGroup.mockRejectedValueOnce(new Error('revoked'));
    expect(await redeemGroupInvite('T', 'redeemer', 'Alex')).toEqual({ ok: false, reason: 'revoked' });
  });

  test('returns cap when joinGroup callable rejects with cap (raced against pre-check)', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'group', ownerPath: 'groups/G1/invites/T' });
    db.readGroupInvite.mockResolvedValue(
      { scope: 'group', token: 'T', creatorUid: 'uid1', revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0 },
    );
    db.readMember.mockResolvedValue(null);
    db.readGroupName.mockResolvedValue({ name: 'Family' });
    groups.joinGroup.mockRejectedValueOnce(new Error('cap'));
    expect(await redeemGroupInvite('T', 'redeemer', 'Alex')).toEqual({ ok: false, reason: 'cap' });
  });
});

describe('attemptRedeemFromUrl scope dispatch', () => {
  beforeEach(() => { jest.clearAllMocks(); store.getFollowing.mockReturnValue([]); });

  test('dispatches to personal when scope is personal', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'T', creatorUid: 'creator', creatorLabel: 'Alex',
      revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0,
    });
    db.getCreatorCode.mockResolvedValue('ABC123');
    const result = await attemptRedeemFromUrl('T', 'me', 'mycode');
    expect(result.ok).toBe(true);
    expect(result.creatorCode).toBe('ABC123');
  });

  test('returns needs-display-name for group scope when displayName is missing', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'group', ownerPath: 'groups/G1/invites/T' });
    db.readGroupName.mockResolvedValue({ name: 'Family' });
    const result = await attemptRedeemFromUrl('T', 'me', 'mycode');
    expect(result).toEqual({
      ok: false,
      reason: 'needs-display-name',
      groupId: 'G1',
      groupName: 'Family',
      cache: {
        indexEntry: { scope: 'group', ownerPath: 'groups/G1/invites/T' },
        group: { name: 'Family' },
      },
    });
  });

  test('dispatches to group redemption when displayName is provided', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'group', ownerPath: 'groups/G1/invites/T' });
    db.readGroupName.mockResolvedValue({ name: 'Family' });
    db.readGroupInvite.mockResolvedValue(
      { scope: 'group', token: 'T', creatorUid: 'uid1', revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0 },
    );
    db.readMember.mockResolvedValue(null);
    const result = await attemptRedeemFromUrl('T', 'me', 'mycode', { displayName: 'Alex' });
    expect(result).toEqual({ ok: true, groupId: 'G1', groupName: 'Family' });
  });

  test('already-member short-circuits BEFORE the displayname prompt (no pointless name entry)', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'group', ownerPath: 'groups/G1/invites/T' });
    db.readGroupName.mockResolvedValue({ name: 'Family' });
    db.readMember.mockResolvedValue({ displayName: 'Alex', joinedAt: 1 });
    const result = await attemptRedeemFromUrl('T', 'me', 'mycode');
    expect(result).toEqual({ ok: false, reason: 'already-member', groupId: 'G1', groupName: 'Family' });
    expect(db.readMember).toHaveBeenCalledWith('G1', 'me');
    // Never reached the redemption path — no invite-record read, no join.
    expect(db.readGroupInvite).not.toHaveBeenCalled();
    expect(groups.joinGroup).not.toHaveBeenCalled();
  });

  test('non-member preview still returns needs-display-name (membership read runs in parallel, changes nothing)', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'group', ownerPath: 'groups/G1/invites/T' });
    db.readGroupName.mockResolvedValue({ name: 'Family' });
    db.readMember.mockResolvedValue(null);
    const result = await attemptRedeemFromUrl('T', 'me', 'mycode');
    expect(result.reason).toBe('needs-display-name');
    expect(result.groupName).toBe('Family');
  });

  test('forwarding cache from needs-display-name response skips duplicate index + group reads', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'group', ownerPath: 'groups/G1/invites/T' });
    db.readGroupName.mockResolvedValue({ name: 'Family' });
    db.readGroupInvite.mockResolvedValue(
      { scope: 'group', token: 'T', creatorUid: 'uid1', revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0 },
    );
    db.readMember.mockResolvedValue(null);

    const first = await attemptRedeemFromUrl('T', 'me', 'mycode');
    expect(first.reason).toBe('needs-display-name');
    expect(db.readInviteIndex).toHaveBeenCalledTimes(1);
    expect(db.readGroupName).toHaveBeenCalledTimes(1);

    const second = await attemptRedeemFromUrl('T', 'me', 'mycode', { displayName: 'Alex', cache: first.cache });
    expect(second.ok).toBe(true);
    // Index + group records came from the cache; no additional reads.
    expect(db.readInviteIndex).toHaveBeenCalledTimes(1);
    expect(db.readGroupName).toHaveBeenCalledTimes(1);
    // The second call still has to read the single invite, but only once.
    expect(db.readGroupInvite).toHaveBeenCalledTimes(1);
    // Membership is read twice by design: the pre-prompt already-member
    // short-circuit, then redeemGroupInvite's race-safe re-check.
    expect(db.readMember).toHaveBeenCalledTimes(2);
  });
});

describe('group-scope new-user flow integration (light)', () => {
  test('attemptRedeemFromUrl with displayName succeeds for new user joining a group', async () => {
    jest.clearAllMocks();
    db.readInviteIndex.mockResolvedValue({ scope: 'group', ownerPath: 'groups/G1/invites/T' });
    db.readGroupName.mockResolvedValue({ name: 'Family' });
    db.readGroupInvite.mockResolvedValue(
      { scope: 'group', token: 'T', creatorUid: 'owner', revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0 },
    );
    db.readMember.mockResolvedValue(null);
    const result = await attemptRedeemFromUrl('T', 'new-user', 'code', { displayName: 'Alex' });
    expect(result).toEqual({ ok: true, groupId: 'G1', groupName: 'Family' });
  });
});

describe('buildInviteUrl (spec N1/A1)', () => {
  const { buildInviteUrl } = require('../js/invites.js');
  test('builds a /invite landing link carrying the token', () => {
    expect(buildInviteUrl('AbCdEfGhIjKlMnOpQrStUv')).toMatch(/\/invite\?i=AbCdEfGhIjKlMnOpQrStUv$/);
    expect(buildInviteUrl('AbCdEfGhIjKlMnOpQrStUv')).not.toContain('/?i=');
  });
});
