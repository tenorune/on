// tests/mycode.test.js
jest.mock('../js/notifyPrompt.js', () => ({ requestPermissionAndRegister: jest.fn() }));
jest.mock('../js/db.js', () => ({
  rotateCode: jest.fn(),
  claimInviteToken: jest.fn(),
  releaseInviteToken: jest.fn(),
  readInviteIndex: jest.fn(),
  readUserInvite: jest.fn(),
  readUserInvites: jest.fn().mockResolvedValue({}),
  writeUserInvite: jest.fn(),
  deleteUserInvite: jest.fn(),
  setInviteRevoked: jest.fn(),
  incrementInviteRedemptions: jest.fn(),
  getCreatorCode: jest.fn(),
  watchUserInvites: jest.fn(() => () => {}),
  claimGroupId: jest.fn(),
  writeUserGroupsEntry: jest.fn(),
  removeUserGroupsEntry: jest.fn(),
  readUserGroups: jest.fn().mockResolvedValue({}),
  watchUserGroups: jest.fn(() => () => {}),
  setLastVisited: jest.fn(),
  setCurrentContext: jest.fn(),
  writeGroup: jest.fn(),
  readGroup: jest.fn().mockResolvedValue(null),
  renameGroup: jest.fn(),
  deleteGroup: jest.fn(),
  watchGroupMeta: jest.fn(() => () => {}),
  writeMember: jest.fn(),
  readMember: jest.fn().mockResolvedValue(null),
  readMembers: jest.fn().mockResolvedValue({}),
  removeMember: jest.fn(),
  setMemberDisplayName: jest.fn(),
  watchGroupMembers: jest.fn(() => () => {}),
  writeGroupInvite: jest.fn(),
  readGroupInvites: jest.fn().mockResolvedValue({}),
  setGroupInviteRevoked: jest.fn(),
  watchGroupInvites: jest.fn(() => () => {}),
  setStatusOverride: jest.fn().mockResolvedValue(undefined),
  clearStatusOverride: jest.fn().mockResolvedValue(undefined),
  mergeStatusOverride: jest.fn().mockResolvedValue(undefined),
  mergeUserPrefs: jest.fn().mockResolvedValue(undefined),
  watchUserPrefs: jest.fn(() => () => {}),
  watchOwnMemberOverride: jest.fn(() => () => {}),
  watchPendingInvites: jest.fn(() => () => {}),
  writePendingInvite: jest.fn().mockResolvedValue(undefined),
  deletePendingInvite: jest.fn().mockResolvedValue(undefined),
  readPendingInviteesForGroup: jest.fn().mockResolvedValue([]),
}));
jest.mock('../js/identity.js', () => ({ saveIdentity: jest.fn(), loadIdentity: jest.fn().mockReturnValue(null) }));
jest.mock('../js/inviteModal.js', () => ({
  openInviteModal: jest.fn(),
}));
jest.mock('../js/regenFlash.js', () => ({ flashRegenerated: jest.fn() }));
// mycode.js's dependency chain (invites.js -> groups.js -> groupNav.js ->
// groupContext.js -> following.js) now pulls in firstRun.js, which imports
// telegram.js -> firebase/auth. Mock firstRun.js so that real chain never
// loads telegram.js here (this suite has nothing to do with first-run UI).
jest.mock('../js/firstRun.js', () => ({
  initFirstRun: jest.fn(),
  setListEmpty: jest.fn(),
  isFirstRunActive: jest.fn(() => false),
}));
// sharePersonalInvite pulls in invites.js (create), inviteFlow.js (share sheet),
// and telegram.js (first-name label). Mock all three so this suite stays a unit
// test and never loads firebase through telegram.js/inviteFlow.js.
jest.mock('../js/invites.js', () => ({
  buildInviteUrl: jest.fn((t) => `https://app/invite?i=${t}`),
  createPersonalInvite: jest.fn(),
  updateInviteLabel: jest.fn(),
}));
jest.mock('../js/inviteFlow.js', () => ({ shareInviteLink: jest.fn() }));
jest.mock('../js/telegram.js', () => ({ telegramFirstName: jest.fn(() => 'Ana'), isTelegramContext: jest.fn(() => false) }));

const { rotateCode, watchUserInvites } = require('../js/db.js');
const { saveIdentity } = require('../js/identity.js');
const { openInviteModal } = require('../js/inviteModal.js');
const { flashRegenerated } = require('../js/regenFlash.js');
const { createPersonalInvite, updateInviteLabel } = require('../js/invites.js');
const { shareInviteLink } = require('../js/inviteFlow.js');
const { telegramFirstName, isTelegramContext } = require('../js/telegram.js');
const { initCodeDrawer, sharePersonalInvite } = require('../js/mycode.js');

beforeEach(() => {
  document.body.innerHTML = `
    <span id="my-code-display" class="code-display"></span>
    <button id="rotate-code-btn" class="rotate-btn"></button>
    <button id="copy-code-btn" class="ghost-btn">Copy</button>
    <p id="rotate-error-msg" class="error-msg hidden"></p>
    <button id="drawer-invite-btn" class="primary-btn" type="button">Invite your people</button>
  `;
  Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
  jest.clearAllMocks();
  isTelegramContext.mockReturnValue(false);
  watchUserInvites.mockImplementation((_uid, cb) => { cb({}); return () => {}; });
});

test('initCodeDrawer sets code display to initial code', () => {
  initCodeDrawer('uid1', 'ABC123');
  expect(document.getElementById('my-code-display').textContent).toBe('ABC123');
});

test('initCodeDrawer: rotate button opens confirm sheet when online', () => {
  initCodeDrawer('uid1', 'ABC123');
  document.getElementById('rotate-code-btn').click();
  const sheet = document.getElementById('rotate-confirm');
  expect(sheet).not.toBeNull();
  expect(sheet.classList.contains('hidden')).toBe(false);
});

test('initCodeDrawer: rotate button does nothing when offline', () => {
  Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
  initCodeDrawer('uid1', 'ABC123');
  document.getElementById('rotate-code-btn').click();
  // confirm sheet is injected on init but stays hidden
  const sheet = document.getElementById('rotate-confirm');
  expect(sheet.classList.contains('hidden')).toBe(true);
});

test('rotate success: updates code display and calls saveIdentity', async () => {
  rotateCode.mockResolvedValue('XYZ789');
  initCodeDrawer('uid1', 'ABC123');

  // Open confirm, click generate
  document.getElementById('rotate-code-btn').click();
  document.getElementById('rotate-do-btn').click();

  // Flush promises and the 500ms parallel fade timeout
  await new Promise((resolve) => setTimeout(resolve, 600));

  expect(document.getElementById('my-code-display').textContent).toBe('XYZ789');
  expect(saveIdentity).toHaveBeenCalledWith('uid1', 'XYZ789', '');
  // Unified regen cue: delegates the value-flash + button→NEW-badge swap to the
  // shared flashRegenerated() (same as the invite hash / secret phrase).
  expect(flashRegenerated).toHaveBeenCalledWith(
    document.getElementById('my-code-display'),
    document.getElementById('rotate-code-btn'),
  );
});

test('rotate error: shows error message and re-enables buttons', async () => {
  rotateCode.mockRejectedValue(new Error('network'));
  initCodeDrawer('uid1', 'ABC123');

  document.getElementById('rotate-code-btn').click();
  document.getElementById('rotate-do-btn').click();

  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(document.getElementById('rotate-error-msg').classList.contains('hidden')).toBe(false);
  expect(document.getElementById('rotate-code-btn').disabled).toBe(false);
  expect(document.getElementById('copy-code-btn').disabled).toBe(false);
});

test('copy button calls clipboard.writeText with current code', () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    get: () => ({ writeText }),
    configurable: true,
  });
  initCodeDrawer('uid1', 'ABC123');
  document.getElementById('copy-code-btn').click();
  expect(writeText).toHaveBeenCalledWith('ABC123');
});

describe('drawer invite button', () => {
  test('tapping the button opens the modal with the current invite state', () => {
    let cb;
    watchUserInvites.mockImplementation((uid, _cb) => { cb = _cb; return () => {}; });
    initCodeDrawer('uid1', 'ABC123');
    cb({ T1: { scope: 'personal', token: 'T1', revoked: false, creatorLabel: 'Alex' } });
    document.getElementById('drawer-invite-btn').click();
    expect(openInviteModal).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'personal',
      userId: 'uid1',
      activeInvite: expect.objectContaining({ token: 'T1', creatorLabel: 'Alex' }),
    }));
  });

  test('tapping the button when no active invite opens the modal in create mode', () => {
    watchUserInvites.mockImplementation((uid, cb) => { cb({}); return () => {}; });
    initCodeDrawer('uid1', 'ABC123');
    document.getElementById('drawer-invite-btn').click();
    expect(openInviteModal).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'personal',
      userId: 'uid1',
      activeInvite: null,
    }));
  });

  // In Telegram the drawer invite matches the empty-state primary: one-tap deep
  // link straight to the native share sheet (spec §3/§4), never the web modal.
  test('in Telegram, tapping the button shares the deep link directly (one-tap), not the web modal', async () => {
    isTelegramContext.mockReturnValue(true);
    let cb;
    watchUserInvites.mockImplementation((uid, _cb) => { cb = _cb; return () => {}; });
    initCodeDrawer('uid1', 'ABC123');
    cb({ T1: { scope: 'personal', token: 'T1', revoked: false, creatorLabel: 'Alex' } });
    document.getElementById('drawer-invite-btn').click();
    await Promise.resolve();
    expect(openInviteModal).not.toHaveBeenCalled();
    expect(shareInviteLink).toHaveBeenCalledWith(expect.objectContaining({ token: 'T1' }));
  });
});

// spec §3/§4 — the Telegram empty-state "Invite your people" primary shares the
// deep link straight to the native share sheet (no web modal).
describe('sharePersonalInvite (Telegram one-tap)', () => {
  test('shares the active personal invite directly, without creating a new one', async () => {
    telegramFirstName.mockReturnValue('Alex'); // matches the stored label: no rewrite
    let cb;
    watchUserInvites.mockImplementation((uid, _cb) => { cb = _cb; return () => {}; });
    initCodeDrawer('uid1', 'ABC123');
    cb({ T1: { scope: 'personal', token: 'T1', revoked: false, creatorLabel: 'Alex' } });

    await sharePersonalInvite();

    expect(createPersonalInvite).not.toHaveBeenCalled();
    expect(updateInviteLabel).not.toHaveBeenCalled();
    expect(shareInviteLink).toHaveBeenCalledWith(expect.objectContaining({ token: 'T1' }));
  });

  // §29: an active invite carries whatever creatorLabel it was created with,
  // which goes stale when the Telegram first name changes (observed "Pwa" vs the
  // current "Tenorune"). Re-sharing refreshes the label on the existing invite
  // (token/URL unchanged) so the arrival interstitial names the inviter right.
  test('refreshes a stale label to the current Telegram first name, then shares', async () => {
    telegramFirstName.mockReturnValue('Tenorune');
    updateInviteLabel.mockResolvedValue('Tenorune');
    let cb;
    watchUserInvites.mockImplementation((uid, _cb) => { cb = _cb; return () => {}; });
    initCodeDrawer('uid1', 'ABC123');
    cb({ T1: { scope: 'personal', token: 'T1', revoked: false, creatorLabel: 'Pwa' } });

    await sharePersonalInvite();

    expect(createPersonalInvite).not.toHaveBeenCalled();
    expect(updateInviteLabel).toHaveBeenCalledWith('uid1', 'T1', 'Tenorune');
    expect(shareInviteLink).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'T1', creatorLabel: 'Tenorune' }),
    );
  });

  test('leaves the label alone when the Telegram name already matches', async () => {
    telegramFirstName.mockReturnValue('Tenorune');
    let cb;
    watchUserInvites.mockImplementation((uid, _cb) => { cb = _cb; return () => {}; });
    initCodeDrawer('uid1', 'ABC123');
    cb({ T1: { scope: 'personal', token: 'T1', revoked: false, creatorLabel: 'Tenorune' } });

    await sharePersonalInvite();

    expect(updateInviteLabel).not.toHaveBeenCalled();
    expect(shareInviteLink).toHaveBeenCalledWith(expect.objectContaining({ token: 'T1' }));
  });

  test('keeps the existing label (no clobber) when Telegram exposes no first name', async () => {
    telegramFirstName.mockReturnValue('');
    let cb;
    watchUserInvites.mockImplementation((uid, _cb) => { cb = _cb; return () => {}; });
    initCodeDrawer('uid1', 'ABC123');
    cb({ T1: { scope: 'personal', token: 'T1', revoked: false, creatorLabel: 'Pwa' } });

    await sharePersonalInvite();

    expect(updateInviteLabel).not.toHaveBeenCalled();
    expect(shareInviteLink).toHaveBeenCalledWith(expect.objectContaining({ token: 'T1', creatorLabel: 'Pwa' }));
  });

  test('auto-creates an invite labelled with the Telegram first name when none is active, then shares it', async () => {
    watchUserInvites.mockImplementation((uid, cb) => { cb({}); return () => {}; });
    createPersonalInvite.mockResolvedValue({ token: 'NEW', url: 'https://app/invite?i=NEW' });
    telegramFirstName.mockReturnValue('Ana');
    initCodeDrawer('uid1', 'ABC123');

    await sharePersonalInvite();

    expect(createPersonalInvite).toHaveBeenCalledWith('uid1', 'Ana');
    expect(shareInviteLink).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'NEW', url: 'https://app/invite?i=NEW' }),
    );
  });

  test('falls back to a generic label when Telegram exposes no first name', async () => {
    watchUserInvites.mockImplementation((uid, cb) => { cb({}); return () => {}; });
    createPersonalInvite.mockResolvedValue({ token: 'N2', url: 'u2' });
    telegramFirstName.mockReturnValue('');
    initCodeDrawer('uid1', 'ABC123');

    await sharePersonalInvite();

    expect(createPersonalInvite).toHaveBeenCalledWith('uid1', 'Someone');
  });
});

describe('startPersonalInviteFlow (W3-B CL#8)', () => {
  test('web: opens the invite modal', async () => {
    isTelegramContext.mockReturnValue(false);
    const mycode = require('../js/mycode.js');
    await mycode.startPersonalInviteFlow();
    expect(openInviteModal).toHaveBeenCalledWith(expect.objectContaining({ scope: 'personal' }));
  });

  test('Telegram: goes straight to the share sheet path (no modal)', async () => {
    isTelegramContext.mockReturnValue(true);
    telegramFirstName.mockReturnValue('Ana');
    createPersonalInvite.mockResolvedValue({ token: 'NEW', url: 'https://app/invite?i=NEW' });
    const mycode = require('../js/mycode.js');
    await mycode.startPersonalInviteFlow();
    expect(openInviteModal).not.toHaveBeenCalled();
    // sharePersonalInvite ran: it shares via shareInviteLink (inviteFlow mock).
    expect(shareInviteLink).toHaveBeenCalled();
  });
});
