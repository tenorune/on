// tests/mycode.test.js
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
}));
jest.mock('../js/identity.js', () => ({ saveIdentity: jest.fn(), loadIdentity: jest.fn().mockReturnValue(null) }));
jest.mock('../js/inviteModal.js', () => ({
  openInviteModal: jest.fn(),
}));

const { rotateCode, watchUserInvites } = require('../js/db.js');
const { saveIdentity } = require('../js/identity.js');
const { openInviteModal } = require('../js/inviteModal.js');
const { initCodeDrawer } = require('../js/mycode.js');

beforeEach(() => {
  document.body.innerHTML = `
    <span id="my-code-display" class="code-display"></span>
    <button id="rotate-code-btn" class="rotate-btn"></button>
    <button id="copy-code-btn" class="ghost-btn">Copy</button>
    <p id="rotate-error-msg" class="error-msg hidden"></p>
    <button id="invite-link-btn" class="ghost-btn">Create invite link</button>
  `;
  Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
  jest.clearAllMocks();
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

describe('invite-link row', () => {
  test('initCodeDrawer shows "Create invite link" when no active invite is present', () => {
    watchUserInvites.mockImplementation((uid, cb) => { cb({}); return () => {}; });
    initCodeDrawer('uid1', 'ABC123');
    expect(document.getElementById('invite-link-btn').textContent).toBe('Create invite link');
  });

  test('initCodeDrawer shows "View invite link" when an active invite exists', () => {
    watchUserInvites.mockImplementation((uid, cb) => {
      cb({ T1: { scope: 'personal', token: 'T1', revoked: false, creatorLabel: 'Mike' } });
      return () => {};
    });
    initCodeDrawer('uid1', 'ABC123');
    expect(document.getElementById('invite-link-btn').textContent).toBe('View invite link');
  });

  test('tapping the button opens the modal with the current invite state', () => {
    let cb;
    watchUserInvites.mockImplementation((uid, _cb) => { cb = _cb; return () => {}; });
    initCodeDrawer('uid1', 'ABC123');
    cb({ T1: { scope: 'personal', token: 'T1', revoked: false, creatorLabel: 'Mike' } });
    document.getElementById('invite-link-btn').click();
    expect(openInviteModal).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'personal',
      userId: 'uid1',
      activeInvite: expect.objectContaining({ token: 'T1', creatorLabel: 'Mike' }),
    }));
  });

  test('tapping the button when no active invite opens the modal in create mode', () => {
    watchUserInvites.mockImplementation((uid, cb) => { cb({}); return () => {}; });
    initCodeDrawer('uid1', 'ABC123');
    document.getElementById('invite-link-btn').click();
    expect(openInviteModal).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'personal',
      userId: 'uid1',
      activeInvite: null,
    }));
  });
});
