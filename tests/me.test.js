// tests/me.test.js
jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true }));
jest.mock('../js/favorites.js', () => ({ saveCombo: jest.fn(), buildDirectCombo: jest.fn(() => ({})), initFavoritesStrip: jest.fn() }));
jest.mock('../js/palettes.js', () => ({ applyThemeHint: jest.fn(), restoreSetSwitchPulse: jest.fn() }));
jest.mock('../js/db.js', () => ({
  setStatus: jest.fn().mockResolvedValue(undefined),
  isExpired: (t) => t !== null && t !== undefined && t < Date.now(),
  isAvailable: (s, t) => s === 'available' && !(t !== null && t !== undefined && t < Date.now()),
  formatTimeRemaining: (ms) => ms > 0 ? '2h' : '',
  timeRemainingMs: (t) => !t ? 0 : Math.max(0, t - Date.now()),
  setLastTimeoutMinutes: jest.fn().mockResolvedValue(undefined),
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
jest.mock('../js/store.js', () => ({
  getLastTimeout: jest.fn(),
  setLastTimeout: jest.fn(),
  getPaletteState: jest.fn(() => ({ activeSet: 1, sets: { '1': { selectedKey: 'forest' }, '2': { selectedKey: 'volt' } } })),
}));
jest.mock('../js/groups.js', () => ({
  showToast: jest.fn(),
  LOCATION_DENIED_TOAST: 'Location permission is denied — allow location access for this app in your device settings.',
}));
jest.mock('../js/locationShare.js', () => ({
  toggleContext: jest.fn(),
  capabilityState: jest.fn(() => 'supported'),
  initLocationShare: jest.fn(),
  _resetLocationShare: jest.fn(),
}));

const { setStatus } = require('../js/db.js');
const { getLastTimeout, setLastTimeout } = require('../js/store.js');
const { applyOwnStatus, initHeader, enterFirstUseMode, setOwnStatusReadyCallback } = require('../js/me.js');
const { toggleContext, capabilityState } = require('../js/locationShare.js');
// Top-level bind (NOT a require inside a test body): a later describe runs
// jest.resetModules(), after which an in-test require would return a FRESH
// mock instance while me.js keeps the original — same landmine as
// following.test.js's mid-file require.
const { showToast } = require('../js/groups.js');
// prefs.js is NOT mocked — real module, backed by the mocked store.js/db.js above,
// so getLocationOptIn/setLocationOptIn exercise real localStorage caching.
const { getLocationOptIn, setLocationOptIn } = require('../js/prefs.js');

// jsdom doesn't apply stylesheets. #header-chips is always display:flex in CSS;
// opacity and pointer-events are controlled by JS.
function makeFixture() {
  document.body.innerHTML = `
    <div id="my-dot"></div>
    <span id="my-status-label" class="status-label">Unavailable</span>
    <span id="time-remaining" style="display:none"></span>
    <button id="location-glyph" class="location-glyph" aria-label="Share location" aria-pressed="false" style="display:none"></button>
    <div id="header-chips">
      <button id="time-chip" class="chip time-chip"></button>
      <button id="mycode-chip" class="chip"></button>
    </div>
    <div id="swatch-row"></div>
    <div id="code-drawer"></div>
  `;
}

beforeEach(() => {
  jest.useFakeTimers();
  global.requestAnimationFrame = (fn) => fn();
  makeFixture();
  jest.clearAllMocks();
  getLastTimeout.mockReturnValue(2); // old-format default — set AFTER clearAllMocks
});

afterEach(() => {
  jest.useRealTimers();
});

// --- applyOwnStatus ---

// Label text and chip visibility change inside a 200ms setTimeout (after the
// fade-out). Advance 250ms to fire that timeout before asserting final state.

test('applyOwnStatus available: dot gets available class', () => {
  applyOwnStatus('available', Date.now() + 7200000);
  // dot changes immediately, no timer advance needed
  expect(document.getElementById('my-dot').classList.contains('available')).toBe(true);
});

test('applyOwnStatus available: label text is "Available"', () => {
  applyOwnStatus('available', Date.now() + 7200000);
  jest.advanceTimersByTime(250);
  expect(document.getElementById('my-status-label').textContent).toBe('Available');
});

test('applyOwnStatus available: time-remaining is visible with time text', () => {
  applyOwnStatus('available', Date.now() + 7200000);
  jest.advanceTimersByTime(250);
  const el = document.getElementById('time-remaining');
  expect(el.style.display).not.toBe('none');
  // The · separator is rendered via CSS ::before, not in the textContent.
  expect(el.textContent).toMatch(/^.+ left$/);
});

test('applyOwnStatus available: header-chips opacity set to 1 (rAF is synchronous in tests)', () => {
  applyOwnStatus('available', Date.now() + 7200000);
  jest.advanceTimersByTime(250);
  expect(document.getElementById('header-chips').style.opacity).toBe('1');
});

test('applyOwnStatus available: header-chips pointer-events restored', () => {
  applyOwnStatus('available', Date.now() + 7200000);
  jest.advanceTimersByTime(250);
  expect(document.getElementById('header-chips').style.pointerEvents).toBe('auto');
});

test('applyOwnStatus unavailable: dot loses available class', () => {
  applyOwnStatus('available', Date.now() + 7200000);
  applyOwnStatus('unavailable', null);
  // dot changes immediately, no timer advance needed
  expect(document.getElementById('my-dot').classList.contains('available')).toBe(false);
});

test('applyOwnStatus unavailable: label text is "Unavailable"', () => {
  applyOwnStatus('available', Date.now() + 7200000);
  jest.advanceTimersByTime(250); // complete available animation
  applyOwnStatus('unavailable', null);
  jest.advanceTimersByTime(250); // complete unavailable animation
  expect(document.getElementById('my-status-label').textContent).toBe('Unavailable');
});

test('applyOwnStatus unavailable: time-remaining is hidden after fade-out', () => {
  applyOwnStatus('available', Date.now() + 7200000);
  jest.advanceTimersByTime(250);
  applyOwnStatus('unavailable', null);
  jest.advanceTimersByTime(250);
  expect(document.getElementById('time-remaining').style.display).toBe('none');
});

test('applyOwnStatus unavailable: header-chips faded out with pointer-events disabled', () => {
  applyOwnStatus('available', Date.now() + 7200000);
  jest.advanceTimersByTime(250);
  applyOwnStatus('unavailable', null);
  expect(document.getElementById('header-chips').style.opacity).toBe('0');
  expect(document.getElementById('header-chips').style.pointerEvents).toBe('none');
});

test('applyOwnStatus unavailable: closes code drawer and deactivates mycode chip', () => {
  applyOwnStatus('available', Date.now() + 7200000);
  jest.advanceTimersByTime(250);
  document.getElementById('code-drawer').classList.add('open');
  document.getElementById('mycode-chip').classList.add('active');
  applyOwnStatus('unavailable', null);
  // drawer closes immediately (synchronous), no advance needed
  expect(document.getElementById('code-drawer').classList.contains('open')).toBe(false);
  expect(document.getElementById('mycode-chip').classList.contains('active')).toBe(false);
});

test('countdown timer fires after expiry: dot loses available class', () => {
  const availableUntil = Date.now() + 1000;
  applyOwnStatus('available', availableUntil);
  expect(document.getElementById('my-dot').classList.contains('available')).toBe(true);
  jest.advanceTimersByTime(35000);
  expect(document.getElementById('my-dot').classList.contains('available')).toBe(false);
});

// --- chip migration ---

test('getLastTimeout returning 2 (old format hours): time-chip text is "2 hours"', () => {
  getLastTimeout.mockReturnValue(2);
  initHeader('uid1');
  expect(document.getElementById('time-chip').textContent).toBe('2 hours');
});

test('getLastTimeout returning 120 (new format minutes): time-chip text is "2 hours"', () => {
  getLastTimeout.mockReturnValue(120);
  initHeader('uid1');
  expect(document.getElementById('time-chip').textContent).toBe('2 hours');
});

test('getLastTimeout returning 60 (new format minutes): time-chip text is "1 hour"', () => {
  getLastTimeout.mockReturnValue(60);
  initHeader('uid1');
  expect(document.getElementById('time-chip').textContent).toBe('1 hour');
});

test('getLastTimeout returning 1 (old format 1h): time-chip text is "1 hour"', () => {
  getLastTimeout.mockReturnValue(1);
  initHeader('uid1');
  expect(document.getElementById('time-chip').textContent).toBe('1 hour');
});

// --- time chip cycle ---

test('clicking time chip while available advances to next chip and calls setStatus', async () => {
  getLastTimeout.mockReturnValue(120); // index 3 = 2 hours
  initHeader('uid1');
  document.getElementById('my-dot').classList.add('available');

  document.getElementById('time-chip').click();
  await Promise.resolve();

  // Advances from index 3 (120min/2 hours) to index 4 (180min/3 hours)
  expect(document.getElementById('time-chip').textContent).toBe('3 hours');
  expect(setStatus).toHaveBeenCalledWith('uid1', 'available', expect.any(Number));
  expect(setLastTimeout).toHaveBeenCalledWith(180);
});

test('time chip cycle wraps from last chip back to first', async () => {
  getLastTimeout.mockReturnValue(1440); // index 10 = 24 hours (last chip)
  initHeader('uid1');
  document.getElementById('my-dot').classList.add('available');

  document.getElementById('time-chip').click();
  await Promise.resolve();

  expect(document.getElementById('time-chip').textContent).toBe('30 minutes');
  expect(setLastTimeout).toHaveBeenCalledWith(30);
});

test('clicking time chip while unavailable does nothing', async () => {
  getLastTimeout.mockReturnValue(120);
  initHeader('uid1');
  // dot does NOT have 'available' class

  document.getElementById('time-chip').click();
  await Promise.resolve();

  expect(setStatus).not.toHaveBeenCalled();
});

// --- mycode chip ---

test('clicking mycode chip toggles code-drawer open class', () => {
  getLastTimeout.mockReturnValue(2);
  initHeader('uid1');

  const drawer = document.getElementById('code-drawer');
  expect(drawer.classList.contains('open')).toBe(false);

  document.getElementById('mycode-chip').click();
  expect(drawer.classList.contains('open')).toBe(true);

  document.getElementById('mycode-chip').click();
  expect(drawer.classList.contains('open')).toBe(false);
});

test('clicking mycode chip toggles active class on the chip', () => {
  getLastTimeout.mockReturnValue(2);
  initHeader('uid1');

  const chip = document.getElementById('mycode-chip');
  chip.click();
  expect(chip.classList.contains('active')).toBe(true);
  chip.click();
  expect(chip.classList.contains('active')).toBe(false);
});

const mountRecoveryRow = (noteHidden) => document.body.insertAdjacentHTML('beforeend', `
  <div id="recovery-pill-row">
    <button id="recovery-show-pill" class="hidden"></button>
    <div id="recovery-revealed"></div>
    <button id="drawer-recovery-copy-btn"></button>
    <p id="recovery-elsewhere-note"${noteHidden ? ' class="hidden"' : ''}></p>
  </div>`);

test('drawer close keeps the phrase pill hidden while the onramp phrase-note is showing', () => {
  mountRecoveryRow(false); // note visible = onramp-linked TG account
  initHeader('uid1');
  const chip = document.getElementById('mycode-chip');
  chip.click(); // open
  chip.click(); // close → pill-reset logic runs
  expect(document.getElementById('recovery-show-pill').classList.contains('hidden')).toBe(true);
});

test('drawer close re-shows the phrase pill when there is no onramp note (web account)', () => {
  mountRecoveryRow(true); // note hidden = normal web reveal pill
  initHeader('uid1');
  const chip = document.getElementById('mycode-chip');
  chip.click();
  chip.click();
  expect(document.getElementById('recovery-show-pill').classList.contains('hidden')).toBe(false);
});

// --- swatch row toggle (PALETTES_ENABLED: true) ---

test('swatch row gets .visible after applyOwnStatus unavailable', () => {
  applyOwnStatus('unavailable', null);
  jest.advanceTimersByTime(250);
  expect(document.getElementById('swatch-row').classList.contains('visible')).toBe(true);
});

test('swatch row loses .visible after applyOwnStatus available', () => {
  applyOwnStatus('unavailable', null);
  jest.advanceTimersByTime(250);
  applyOwnStatus('available', Date.now() + 7200000);
  jest.advanceTimersByTime(250);
  expect(document.getElementById('swatch-row').classList.contains('visible')).toBe(false);
});

// --- first-use state ---

describe('first-use state', () => {
  afterEach(() => {
    // Ensure firstUseActive is cleared between tests — call applyOwnStatus
    // with 'available' which sets firstUseActive = false if it was true.
    applyOwnStatus('available', Date.now() + 7200000);
    jest.advanceTimersByTime(250);
  });

  test('applyOwnStatus unavailable while first-use: dot has .available class', () => {
    enterFirstUseMode();
    applyOwnStatus('unavailable', null);
    expect(document.getElementById('my-dot').classList.contains('available')).toBe(true);
  });

  test('applyOwnStatus unavailable while first-use: label text is blank', () => {
    enterFirstUseMode();
    applyOwnStatus('unavailable', null);
    expect(document.getElementById('my-status-label').textContent).toBe('');
  });

  test('applyOwnStatus unavailable while first-use: chips are hidden', () => {
    enterFirstUseMode();
    applyOwnStatus('unavailable', null);
    expect(document.getElementById('header-chips').style.opacity).toBe('0');
  });

  test('applyOwnStatus unavailable while first-use: swatch row has no .visible', () => {
    enterFirstUseMode();
    applyOwnStatus('unavailable', null);
    expect(document.getElementById('swatch-row').classList.contains('visible')).toBe(false);
  });

  test('applyOwnStatus available while first-use: transitions to Available label', () => {
    enterFirstUseMode();
    applyOwnStatus('unavailable', null);
    applyOwnStatus('available', Date.now() + 7200000);
    jest.advanceTimersByTime(250);
    expect(document.getElementById('my-status-label').textContent).toBe('Available');
  });

  test('applyOwnStatus available while first-use: dot retains .available class', () => {
    enterFirstUseMode();
    applyOwnStatus('unavailable', null);
    applyOwnStatus('available', Date.now() + 7200000);
    expect(document.getElementById('my-dot').classList.contains('available')).toBe(true);
  });

  test('applyOwnStatus available while first-use: chips are visible', () => {
    enterFirstUseMode();
    applyOwnStatus('unavailable', null);
    applyOwnStatus('available', Date.now() + 7200000);
    jest.advanceTimersByTime(250);
    expect(document.getElementById('header-chips').style.opacity).not.toBe('0');
  });

  test('enterFirstUseMode pulses both Direct and group dots when both exist', () => {
    // Add the group dot to the fixture.
    const groupDot = document.createElement('div');
    groupDot.id = 'group-my-dot';
    document.body.appendChild(groupDot);
    enterFirstUseMode();
    expect(document.getElementById('my-dot').classList.contains('first-use-pulse')).toBe(true);
    expect(document.getElementById('group-my-dot').classList.contains('first-use-pulse')).toBe(true);
  });

  test('clicking either dot clears the pulse from BOTH dots', () => {
    const groupDot = document.createElement('div');
    groupDot.id = 'group-my-dot';
    document.body.appendChild(groupDot);
    enterFirstUseMode();
    // Click the group dot.
    document.getElementById('group-my-dot').click();
    expect(document.getElementById('my-dot').classList.contains('first-use-pulse')).toBe(false);
    expect(document.getElementById('group-my-dot').classList.contains('first-use-pulse')).toBe(false);
  });
});

describe('setOwnStatusReadyCallback', () => {
  beforeEach(() => {
    makeFixture();
    initHeader('u1');
  });

  test('callback fires on first applyOwnStatus call', () => {
    const cb = jest.fn();
    setOwnStatusReadyCallback(cb);
    applyOwnStatus('available', Date.now() + 7200000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('callback does not fire on second applyOwnStatus call', () => {
    const cb = jest.fn();
    setOwnStatusReadyCallback(cb);
    applyOwnStatus('available', Date.now() + 7200000);
    applyOwnStatus('unavailable', null);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('callback fires on first-use path (setKnockKnock branch)', () => {
    const cb = jest.fn();
    setOwnStatusReadyCallback(cb);
    enterFirstUseMode();
    applyOwnStatus('unavailable', null); // triggers setKnockKnock
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('initHeader resets the flag so callback fires again after re-init', () => {
    const cb = jest.fn();
    setOwnStatusReadyCallback(cb);
    applyOwnStatus('available', Date.now() + 7200000);
    jest.advanceTimersByTime(250); // flush the setAvailable 200ms timer before re-init
    initHeader('u1'); // re-init resets ownStatusSignalled
    applyOwnStatus('unavailable', null);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

describe('optimistic Direct status toggle (parity with the group context)', () => {
  // Device-reported defect: every Direct toggle awaited the setStatus write
  // before painting (a full server round-trip), and the RTDB echo then re-ran
  // the 200ms label crossfade a second time — "the UI looks like it is
  // thinking". Group context paints synchronously (pushOptimistic). Direct
  // must paint first and write in the background, and the echo of the exact
  // optimistic state must not restart the animation.

  test('dot click to available paints immediately, before the write resolves', () => {
    getLastTimeout.mockReturnValue(120);
    initHeader('uid1');
    applyOwnStatus('unavailable', null);
    jest.advanceTimersByTime(250);
    setStatus.mockReturnValue(new Promise(() => {})); // write never resolves (slow network)

    document.getElementById('my-dot').click();

    expect(document.getElementById('my-dot').classList.contains('available')).toBe(true);
    jest.advanceTimersByTime(250);
    expect(document.getElementById('my-status-label').textContent).toBe('Available');
    expect(setStatus).toHaveBeenCalledWith('uid1', 'available', expect.any(Number));
  });

  test('dot click to unavailable paints immediately, before the write resolves', () => {
    getLastTimeout.mockReturnValue(120);
    initHeader('uid1');
    applyOwnStatus('available', Date.now() + 7200000);
    jest.advanceTimersByTime(250);
    setStatus.mockReturnValue(new Promise(() => {}));

    document.getElementById('my-dot').click();

    expect(document.getElementById('my-dot').classList.contains('available')).toBe(false);
    jest.advanceTimersByTime(250);
    expect(document.getElementById('my-status-label').textContent).toBe('Unavailable');
    expect(setStatus).toHaveBeenCalledWith('uid1', 'unavailable', null);
  });

  test('the echo of the optimistic available state does not restart the label crossfade', () => {
    getLastTimeout.mockReturnValue(120);
    initHeader('uid1');
    applyOwnStatus('unavailable', null);
    jest.advanceTimersByTime(250);

    document.getElementById('my-dot').click();
    jest.advanceTimersByTime(250); // crossfade completes
    const label = document.getElementById('my-status-label');
    expect(label.style.opacity).toBe('1');

    // The subscription echoes back the exact values the click wrote.
    const writtenUntil = setStatus.mock.calls.at(-1)[2];
    applyOwnStatus('available', writtenUntil);
    expect(label.style.opacity).toBe('1'); // no fade-out restart
    expect(label.textContent).toBe('Available');
  });

  test('the echo of the optimistic unavailable state does not restart the label crossfade', () => {
    getLastTimeout.mockReturnValue(120);
    initHeader('uid1');
    applyOwnStatus('available', Date.now() + 7200000);
    jest.advanceTimersByTime(250);

    document.getElementById('my-dot').click(); // → unavailable
    jest.advanceTimersByTime(250);
    const label = document.getElementById('my-status-label');
    expect(label.style.opacity).toBe('1');

    applyOwnStatus('unavailable', null);
    expect(label.style.opacity).toBe('1');
    expect(label.textContent).toBe('Unavailable');
  });

  test('a cross-device change (different availableUntil) is NOT absorbed as an echo — the countdown retargets', () => {
    getLastTimeout.mockReturnValue(120);
    initHeader('uid1');
    applyOwnStatus('unavailable', null);
    applyOwnStatus('available', Date.now() + 31000); // expires in ~31s
    // Sibling device extends the window. If this were wrongly absorbed, the
    // countdown would still target the old 31s window and flip us unavailable.
    applyOwnStatus('available', Date.now() + 7200000);
    jest.advanceTimersByTime(60000);
    expect(document.getElementById('my-dot').classList.contains('available')).toBe(true);
  });

  test('time-chip tap updates the countdown text immediately with NO label crossfade, and its echo is absorbed', () => {
    getLastTimeout.mockReturnValue(120);
    initHeader('uid1');
    applyOwnStatus('available', Date.now() + 7200000);
    jest.advanceTimersByTime(250);
    const label = document.getElementById('my-status-label');
    setStatus.mockClear();
    setStatus.mockReturnValue(new Promise(() => {}));

    document.getElementById('time-chip').click();

    // Immediate paint, no await.
    expect(document.getElementById('time-remaining').textContent).toMatch(/ left$/);
    expect(setStatus).toHaveBeenCalledWith('uid1', 'available', expect.any(Number));
    expect(label.style.opacity).toBe('1'); // chip taps never crossfade the label

    // Echo with the chip's new until — absorbed, still no crossfade.
    const writtenUntil = setStatus.mock.calls.at(-1)[2];
    applyOwnStatus('available', writtenUntil);
    expect(label.style.opacity).toBe('1');
  });
});

describe('synchronous label swap (no 200ms crossfade choreography)', () => {
  // Operator call: Direct switches must read as instantaneous like the group
  // context. The old choreography staged the swap behind a 200ms setTimeout
  // (fade out → swap → fade in); everything now applies in the same frame and
  // any softness comes from the CSS opacity transitions alone.

  test('going available: label, chips and time-remaining are final synchronously', () => {
    getLastTimeout.mockReturnValue(120);
    initHeader('uid1');
    applyOwnStatus('unavailable', null);
    applyOwnStatus('available', Date.now() + 7200000);
    // No jest.advanceTimersByTime — same-frame swap.
    const label = document.getElementById('my-status-label');
    expect(label.textContent).toBe('Available');
    expect(label.style.opacity).not.toBe('0');
    expect(document.getElementById('header-chips').style.opacity).toBe('1');
    expect(document.getElementById('time-remaining').textContent).toMatch(/ left$/);
    expect(document.getElementById('swatch-row').classList.contains('visible')).toBe(false);
  });

  test('going unavailable: label and swatch row are final synchronously', () => {
    getLastTimeout.mockReturnValue(120);
    initHeader('uid1');
    applyOwnStatus('available', Date.now() + 7200000);
    applyOwnStatus('unavailable', null);
    const label = document.getElementById('my-status-label');
    expect(label.textContent).toBe('Unavailable');
    expect(label.style.opacity).not.toBe('0');
    expect(document.getElementById('swatch-row').classList.contains('visible')).toBe(true);
    expect(document.getElementById('time-remaining').style.display).toBe('none');
  });
});

describe('saveCombo guard in setAvailable', () => {
  let applyOwnStatus, saveComboMock;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true }));
    jest.mock('../js/favorites.js', () => ({ saveCombo: jest.fn(), buildDirectCombo: jest.fn(() => ({})), initFavoritesStrip: jest.fn() }));
    jest.mock('../js/db.js', () => ({
      setStatus: jest.fn().mockResolvedValue(undefined),
      isExpired: (t) => t !== null && t !== undefined && t < Date.now(),
  isAvailable: (s, t) => s === 'available' && !(t !== null && t !== undefined && t < Date.now()),
      formatTimeRemaining: (ms) => ms > 0 ? '2h' : '',
      timeRemainingMs: (t) => !t ? 0 : Math.max(0, t - Date.now()),
      setLastTimeoutMinutes: jest.fn().mockResolvedValue(undefined),
    }));
    jest.mock('../js/store.js', () => ({
      getLastTimeout: jest.fn().mockReturnValue(2),
      setLastTimeout: jest.fn(),
      getPaletteState: jest.fn(() => ({ activeSet: 1, sets: { '1': { selectedKey: 'forest' }, '2': { selectedKey: 'volt' } } })),
    }));
    jest.useFakeTimers();
    global.requestAnimationFrame = (fn) => fn();
    makeFixture();
    ({ applyOwnStatus } = require('../js/me.js'));
    saveComboMock = require('../js/favorites.js').saveCombo;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('saveCombo does NOT fire during page-load restore of available status', () => {
    // Fresh module: savingEnabled starts false. applyOwnStatus with available is the
    // page-load restore path — saveCombo must not fire here.
    applyOwnStatus('available', Date.now() + 7200000);
    expect(saveComboMock).not.toHaveBeenCalled();
  });

  test('saveCombo fires when applyOwnStatus sets available after prior status call', () => {
    // applyOwnStatus(unavailable) → sets savingEnabled = true, then
    // applyOwnStatus(available) → setAvailable → saveCombo fires.
    applyOwnStatus('unavailable', null);
    applyOwnStatus('available', Date.now() + 7200000);
    expect(saveComboMock).toHaveBeenCalledTimes(1);
    expect(saveComboMock).toHaveBeenCalledWith({}); // buildDirectCombo mock returns {}
  });
});

describe('location glyph (Direct header)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('hidden while unavailable, shown while available, reflects opt-in', () => {
    setLocationOptIn('direct', true);
    initHeader('uid1');
    const glyph = document.getElementById('location-glyph');

    // Initial paint from getLocationOptIn happens in initHeader, independent
    // of availability.
    expect(glyph.classList.contains('on')).toBe(true);

    // display:none is the markup default (mirrors #time-remaining) until the
    // dot goes available.
    expect(glyph.style.display).toBe('none');

    applyOwnStatus('available', Date.now() + 7200000);
    jest.advanceTimersByTime(250);
    expect(glyph.style.display).not.toBe('none');

    applyOwnStatus('unavailable', null);
    jest.advanceTimersByTime(250);
    expect(glyph.style.display).toBe('none');
  });

  test('capabilityState unsupported paints denied at init, regardless of opt-in', () => {
    setLocationOptIn('direct', true);
    capabilityState.mockReturnValueOnce('unsupported');
    initHeader('uid1');
    const glyph = document.getElementById('location-glyph');
    expect(glyph.classList.contains('denied')).toBe(true);
  });

  test('click calls toggleContext("direct") and repaints from the result', async () => {
    initHeader('uid1');
    const glyph = document.getElementById('location-glyph');
    expect(glyph.classList.contains('on')).toBe(false);

    toggleContext.mockResolvedValueOnce('on');
    glyph.click();
    await Promise.resolve();

    expect(toggleContext).toHaveBeenCalledWith('direct');
    expect(glyph.classList.contains('on')).toBe(true);
    expect(glyph.getAttribute('aria-pressed')).toBe('true');
    expect(glyph.title).toBe('');

    toggleContext.mockResolvedValueOnce('denied');
    glyph.click();
    await Promise.resolve();

    expect(glyph.classList.contains('on')).toBe(false);
    expect(glyph.classList.contains('denied')).toBe(true);
    expect(glyph.getAttribute('aria-pressed')).toBe('false');
    expect(glyph.title).toBe('Location unavailable — check permissions');
  });

  test('a denied tap shows the permission toast (OS-level deny makes the glyph read as a no-op otherwise)', async () => {
    initHeader('uid1');
    const glyph = document.getElementById('location-glyph');

    toggleContext.mockResolvedValueOnce('denied');
    glyph.click();
    await Promise.resolve();
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/location permission/i));

    // An ordinary on/off tap never toasts.
    showToast.mockClear();
    toggleContext.mockResolvedValueOnce('on');
    glyph.click();
    await Promise.resolve();
    expect(showToast).not.toHaveBeenCalled();
  });

  test('cross-device pref sync (location-prefs-synced) repaints the glyph', () => {
    initHeader('uid1');
    const glyph = document.getElementById('location-glyph');
    expect(glyph.classList.contains('on')).toBe(false);

    // Simulate another device's opt-in landing via prefs.syncFromServer, which
    // writes the localStorage cache and dispatches this event.
    setLocationOptIn('direct', true);
    document.dispatchEvent(new CustomEvent('location-prefs-synced'));

    expect(glyph.classList.contains('on')).toBe(true);
  });

  test('opt-in flipped outside the tap path (location-optin-changed — e.g. revocation teardown) repaints the glyph', () => {
    setLocationOptIn('direct', true);
    initHeader('uid1');
    const glyph = document.getElementById('location-glyph');
    expect(glyph.classList.contains('on')).toBe(true);

    // locationShare's mid-flight-revocation teardown flips the pref off and
    // dispatches this event — no glyph tap involved, so the paint must ride
    // the event.
    setLocationOptIn('direct', false);
    document.dispatchEvent(new CustomEvent('location-optin-changed', { detail: { context: 'direct' } }));

    expect(glyph.classList.contains('on')).toBe(false);
  });
});
