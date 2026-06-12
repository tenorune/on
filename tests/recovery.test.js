// tests/recovery.test.js

// Deterministic microtask/promise-chain flush — drains pending promise
// callbacks after the macrotask queue, replacing arbitrary setTimeout delays.
const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

// Poll a condition across flushes, for paths that await genuinely async work
// (e.g. the real WebCrypto digest in deriveUserIdFromRecoveryCode — identity.js
// is NOT mocked here). Drains as many ticks as the op needs, bounded, instead of
// a fixed sleep that's too short under load / wastefully long otherwise.
async function waitFor(cond, tries = 100) {
  for (let i = 0; i < tries; i += 1) {
    if (cond()) return;
    await flushPromises();
  }
  throw new Error('waitFor: condition not met in time');
}

jest.mock('../js/notifyPrompt.js', () => ({ requestPermissionAndRegister: jest.fn() }));
jest.mock('../js/firebase-config.js', () => ({ db: {}, getMessagingIfSupported: jest.fn() }));
jest.mock('../js/auth.js', () => ({ ensureSignedIn: jest.fn().mockResolvedValue(undefined) }));

// Mocks required so that require('../js/app') doesn't crash on Firebase imports.
// These do NOT mock identity.js so the real functions work for the tests above.
jest.mock('../js/db.js', () => ({
  initUser: jest.fn().mockResolvedValue(true),
  watchStatus: jest.fn(),
  watchPendingInvites: jest.fn(() => () => {}),
  writePendingInvite: jest.fn().mockResolvedValue(undefined),
  deletePendingInvite: jest.fn().mockResolvedValue(undefined),
  readPendingInviteesForGroup: jest.fn().mockResolvedValue([]),
  isExpired: jest.fn().mockReturnValue(false),
  writeBackExpired: jest.fn(),
  userExists: jest.fn().mockResolvedValue(true),
  touchLastSeen: jest.fn().mockResolvedValue(undefined),
  setStatus: jest.fn().mockResolvedValue(undefined),
  watchOwnCall: jest.fn(() => () => {}),
  endCall: jest.fn().mockResolvedValue(undefined),
  getUser: jest.fn().mockResolvedValue(null),
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
  incrementGroupInviteRedemptions: jest.fn(),
  watchGroupInvites: jest.fn(() => () => {}),
  setStatusOverride: jest.fn().mockResolvedValue(undefined),
  clearStatusOverride: jest.fn().mockResolvedValue(undefined),
  mergeStatusOverride: jest.fn().mockResolvedValue(undefined),
  mergeUserPrefs: jest.fn().mockResolvedValue(undefined),
  watchUserPrefs: jest.fn(() => () => {}),
  watchOwnMemberOverride: jest.fn(() => () => {}),
}));
jest.mock('../js/me.js', () => ({
  initHeader: jest.fn(),
  applyOwnStatus: jest.fn(),
  enterFirstUseMode: jest.fn(),
  setOwnStatusReadyCallback: jest.fn(),
}));
jest.mock('../js/following.js', () => ({
  initList: jest.fn(),
  setFolloweeReadyCallback: jest.fn(),
  reEnterCallMode: jest.fn(),
  exitCallMode: jest.fn(),
  getCallModeCalleeId: jest.fn().mockReturnValue(null),
}));
jest.mock('../js/knock.js', () => ({ initKnocks: jest.fn() }));
jest.mock('../js/mycode.js', () => ({ initCodeDrawer: jest.fn() }));
jest.mock('../js/features.js', () => ({
  PALETTES_ENABLED: false,
  PALETTE_INTERACTIONS_ENABLED: false,
  KNOCK_ENABLED: false,
  CALL_ENABLED: false,
}));
jest.mock('../js/palettes.js', () => ({
  applyPaletteVars: jest.fn(),
  initSwatches: jest.fn(),
}));
jest.mock('../js/favorites.js', () => ({ initFavoritesStrip: jest.fn() }));
jest.mock('../js/store.js', () => ({
  getPaletteState: jest.fn(() => ({ activeSet: 1, sets: { '1': { selectedKey: 'default', activePaletteKey: 'default' } } })),
  getFollowing: jest.fn().mockReturnValue([]),
}));

const { generateRecoveryCode, parseRecoveryCode, deriveUserIdFromRecoveryCode } = require('../js/identity');
const { WORDSET } = require('../js/wordlist');

describe('generateRecoveryCode', () => {
  test('returns 4 dash-separated lowercase words', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[a-z]+(?:-[a-z]+){3}$/);
  });

  test('all 4 words are in the wordlist', () => {
    const code = generateRecoveryCode();
    for (const word of code.split('-')) {
      expect(WORDSET.has(word)).toBe(true);
    }
  });

  test('generates different codes on successive calls', () => {
    const codes = new Set(Array.from({ length: 50 }, generateRecoveryCode));
    expect(codes.size).toBeGreaterThan(40);
  });
});

describe('parseRecoveryCode', () => {
  test('accepts standard dash form', () => {
    const code = generateRecoveryCode();
    expect(parseRecoveryCode(code)).toBe(code);
  });

  test('accepts space-separated form', () => {
    const code = generateRecoveryCode();
    const spaced = code.replace(/-/g, ' ');
    expect(parseRecoveryCode(spaced)).toBe(code);
  });

  test('accepts comma-separated form', () => {
    const code = generateRecoveryCode();
    const commaed = code.split('-').join(', ');
    expect(parseRecoveryCode(commaed)).toBe(code);
  });

  test('normalizes case', () => {
    const code = generateRecoveryCode();
    expect(parseRecoveryCode(code.toUpperCase())).toBe(code);
  });

  test('rejects fewer than 4 tokens', () => {
    expect(parseRecoveryCode('one-two-three')).toBeNull();
  });

  test('rejects more than 4 tokens', () => {
    const code = generateRecoveryCode();
    expect(parseRecoveryCode(code + '-extra')).toBeNull();
  });

  test('rejects tokens not in wordlist', () => {
    expect(parseRecoveryCode('xyzzy-foo-bar-baz')).toBeNull();
  });

  test('rejects empty input', () => {
    expect(parseRecoveryCode('')).toBeNull();
    expect(parseRecoveryCode('   ')).toBeNull();
  });
});

describe('deriveUserIdFromRecoveryCode', () => {
  test('returns a 32-char lowercase hex string', async () => {
    const id = await deriveUserIdFromRecoveryCode('swift-river-amber-dust');
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  test('is deterministic for the same input', async () => {
    const a = await deriveUserIdFromRecoveryCode('swift-river-amber-dust');
    const b = await deriveUserIdFromRecoveryCode('swift-river-amber-dust');
    expect(a).toBe(b);
  });

  test('different inputs yield different userIds', async () => {
    const a = await deriveUserIdFromRecoveryCode('swift-river-amber-dust');
    const b = await deriveUserIdFromRecoveryCode('swift-river-amber-other');
    expect(a).not.toBe(b);
  });
});

describe('showWelcomeScreen', () => {
  let showWelcomeScreen;
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="welcome-screen" class="welcome-screen hidden">
        <button id="welcome-new-btn"></button>
        <button id="welcome-restore-btn"></button>
      </div>`;
    jest.resetModules();
    ({ showWelcomeScreen } = require('../js/app'));
  });

  test('reveals the screen and resolves "new" when "I\'m new" tapped', async () => {
    const promise = showWelcomeScreen();
    expect(document.getElementById('welcome-screen').classList.contains('hidden')).toBe(false);
    document.getElementById('welcome-new-btn').click();
    const choice = await promise;
    expect(choice).toBe('new');
    expect(document.getElementById('welcome-screen').classList.contains('hidden')).toBe(true);
  });

  test('resolves "restore" when "I have a recovery code" tapped', async () => {
    const promise = showWelcomeScreen();
    document.getElementById('welcome-restore-btn').click();
    expect(await promise).toBe('restore');
    expect(document.getElementById('welcome-screen').classList.contains('hidden')).toBe(true);
  });
});

describe('showRecoveryCodeModal', () => {
  let showRecoveryCodeModal;
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="recovery-modal" class="modal-overlay hidden">
        <span id="recovery-code-text"></span>
        <button id="recovery-rotate-btn"></button>
        <button id="recovery-copy-btn">Copy</button>
        <button id="recovery-saved-btn">I've saved it</button>
      </div>`;
    jest.resetModules();
    ({ showRecoveryCodeModal } = require('../js/app'));
  });

  test('displays the initial code and reveals the modal', async () => {
    const p = showRecoveryCodeModal('alpha-bravo-charlie-delta');
    expect(document.getElementById('recovery-code-text').textContent).toBe('alpha-bravo-charlie-delta');
    expect(document.getElementById('recovery-modal').classList.contains('hidden')).toBe(false);
    document.getElementById('recovery-saved-btn').click();
    expect(await p).toBe('alpha-bravo-charlie-delta');
    expect(document.getElementById('recovery-modal').classList.contains('hidden')).toBe(true);
  });

  test('rotate (↻) updates the displayed code in place; modal stays open', async () => {
    const p = showRecoveryCodeModal('alpha-bravo-charlie-delta');
    const before = document.getElementById('recovery-code-text').textContent;
    document.getElementById('recovery-rotate-btn').click();
    const after = document.getElementById('recovery-code-text').textContent;
    expect(after).not.toBe(before);
    expect(after).toMatch(/^[a-z]+(?:-[a-z]+){3}$/);
    expect(document.getElementById('recovery-modal').classList.contains('hidden')).toBe(false);
    document.getElementById('recovery-saved-btn').click();
    expect(await p).toBe(after);
  });

  test('committed code reflects the last shown after multiple rotates', async () => {
    const p = showRecoveryCodeModal('alpha-bravo-charlie-delta');
    document.getElementById('recovery-rotate-btn').click();
    document.getElementById('recovery-rotate-btn').click();
    document.getElementById('recovery-rotate-btn').click();
    const finalCode = document.getElementById('recovery-code-text').textContent;
    document.getElementById('recovery-saved-btn').click();
    expect(await p).toBe(finalCode);
  });
});

describe('initRecoveryPill', () => {
  let initRecoveryPill;
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = `
      <div id="recovery-pill-row">
        <button id="recovery-show-pill" class="chip">Show recovery code</button>
        <div id="recovery-revealed" class="recovery-revealed hidden">
          <span id="drawer-recovery-code"></span>
          <button id="drawer-recovery-copy-btn">Copy</button>
        </div>
      </div>`;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    jest.unmock('../js/mycode.js');
    jest.resetModules();
    ({ initRecoveryPill } = require('../js/mycode'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('starts in Idle state (pill visible, revealed hidden)', () => {
    initRecoveryPill('alpha-bravo-charlie-delta');
    expect(document.getElementById('recovery-show-pill').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('recovery-revealed').classList.contains('hidden')).toBe(true);
  });

  test('tap pill enters Revealed: shows code and hides pill', () => {
    initRecoveryPill('alpha-bravo-charlie-delta');
    document.getElementById('recovery-show-pill').click();
    expect(document.getElementById('recovery-revealed').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('recovery-show-pill').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('drawer-recovery-code').textContent).toBe('alpha-bravo-charlie-delta');
  });

  test('15s idle in Revealed returns to Idle', () => {
    initRecoveryPill('alpha-bravo-charlie-delta');
    document.getElementById('recovery-show-pill').click();
    jest.advanceTimersByTime(15000);
    expect(document.getElementById('recovery-revealed').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('recovery-show-pill').classList.contains('hidden')).toBe(false);
  });

  test('Copy enters Copied state then returns to Idle after 1.5s', async () => {
    initRecoveryPill('alpha-bravo-charlie-delta');
    document.getElementById('recovery-show-pill').click();
    const copyBtn = document.getElementById('drawer-recovery-copy-btn');
    copyBtn.click();
    await Promise.resolve();
    expect(copyBtn.textContent).toBe('Copied!');
    jest.advanceTimersByTime(1500);
    expect(document.getElementById('recovery-revealed').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('recovery-show-pill').classList.contains('hidden')).toBe(false);
  });

  test('tapping the code text in Revealed resets the 15s timer', () => {
    initRecoveryPill('alpha-bravo-charlie-delta');
    document.getElementById('recovery-show-pill').click();
    jest.advanceTimersByTime(14000);
    document.getElementById('drawer-recovery-code').click();
    jest.advanceTimersByTime(10000); // total 24s from reveal, but timer was reset at 14s
    expect(document.getElementById('recovery-revealed').classList.contains('hidden')).toBe(false);
    jest.advanceTimersByTime(5000); // 15s after the reset
    expect(document.getElementById('recovery-revealed').classList.contains('hidden')).toBe(true);
  });
});

describe('showRestoreScreen', () => {
  let showRestoreScreen;
  let mockUserExists;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="restore-screen" class="restore-screen hidden">
        <input id="restore-input" />
        <p id="restore-error" class="error-msg hidden"></p>
        <button id="restore-submit-btn"></button>
        <button id="restore-cancel-btn"></button>
      </div>`;
    jest.resetModules();
    jest.mock('../js/db', () => ({
      userExists: jest.fn(),
      getUser: jest.fn(),
    }));
    mockUserExists = require('../js/db').userExists;
    ({ showRestoreScreen } = require('../js/app'));
  });

  test('resolves null when Cancel is tapped', async () => {
    const p = showRestoreScreen();
    expect(document.getElementById('restore-screen').classList.contains('hidden')).toBe(false);
    document.getElementById('restore-cancel-btn').click();
    expect(await p).toBeNull();
    expect(document.getElementById('restore-screen').classList.contains('hidden')).toBe(true);
  });

  test('shows error and does not resolve when input is malformed', async () => {
    const p = showRestoreScreen();
    document.getElementById('restore-input').value = 'only-three-words';
    document.getElementById('restore-submit-btn').click();
    await flushPromises();
    expect(document.getElementById('restore-error').classList.contains('hidden')).toBe(false);
    expect(mockUserExists).not.toHaveBeenCalled();
    document.getElementById('restore-cancel-btn').click();
    await p;
  });

  test('shows "no account" error when userExists returns false', async () => {
    mockUserExists.mockResolvedValue(false);
    const { generateRecoveryCode } = require('../js/identity');
    const code = generateRecoveryCode();
    const p = showRestoreScreen();
    document.getElementById('restore-input').value = code;
    document.getElementById('restore-submit-btn').click();
    await waitFor(() => mockUserExists.mock.calls.length > 0); // real crypto digest precedes this
    expect(mockUserExists).toHaveBeenCalled();
    expect(document.getElementById('restore-error').classList.contains('hidden')).toBe(false);
    document.getElementById('restore-cancel-btn').click();
    await p;
  });

  test('resolves with identity when code is valid and Firebase record exists', async () => {
    const { generateRecoveryCode, deriveUserIdFromRecoveryCode } = require('../js/identity');
    const code = generateRecoveryCode();
    const expectedUid = await deriveUserIdFromRecoveryCode(code);
    mockUserExists.mockResolvedValue(true);
    require('../js/db').getUser = jest.fn().mockResolvedValue({ code: 'XK7P2M' });
    const p = showRestoreScreen();
    document.getElementById('restore-input').value = code;
    document.getElementById('restore-submit-btn').click();
    const result = await p;
    expect(result).toEqual({ userId: expectedUid, code: 'XK7P2M', recoveryCode: code });
    expect(document.getElementById('restore-screen').classList.contains('hidden')).toBe(true);
  });
});
