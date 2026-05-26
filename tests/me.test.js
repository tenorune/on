// tests/me.test.js
jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true }));
jest.mock('../js/favorites.js', () => ({ saveFavorite: jest.fn(), initFavoritesStrip: jest.fn() }));
jest.mock('../js/palettes.js', () => ({ applyThemeHint: jest.fn(), restoreSetSwitchPulse: jest.fn() }));
jest.mock('../js/db.js', () => ({
  setStatus: jest.fn().mockResolvedValue(undefined),
  isExpired: (t) => t !== null && t !== undefined && t < Date.now(),
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
}));
jest.mock('../js/store.js', () => ({
  getLastTimeout: jest.fn(),
  setLastTimeout: jest.fn(),
  getPaletteState: jest.fn(() => ({ activeSet: 1, sets: { '1': { selectedKey: 'forest' }, '2': { selectedKey: 'volt' } } })),
}));

const { setStatus } = require('../js/db.js');
const { getLastTimeout, setLastTimeout } = require('../js/store.js');
const { applyOwnStatus, initHeader, enterFirstUseMode, setOwnStatusReadyCallback } = require('../js/me.js');

// jsdom doesn't apply stylesheets. #header-chips is always display:flex in CSS;
// opacity and pointer-events are controlled by JS.
function makeFixture() {
  document.body.innerHTML = `
    <div id="my-dot"></div>
    <span id="my-status-label" class="status-label">Unavailable</span>
    <span id="time-remaining" style="display:none"></span>
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
  expect(el.textContent).toMatch(/^· .+ left$/);
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

describe('saveFavorite guard in setAvailable', () => {
  let applyOwnStatus, saveFavoriteMock;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true }));
    jest.mock('../js/favorites.js', () => ({ saveFavorite: jest.fn(), initFavoritesStrip: jest.fn() }));
    jest.mock('../js/db.js', () => ({
      setStatus: jest.fn().mockResolvedValue(undefined),
      isExpired: (t) => t !== null && t !== undefined && t < Date.now(),
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
    saveFavoriteMock = require('../js/favorites.js').saveFavorite;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('saveFavorite does NOT fire during page-load restore of available status', () => {
    // Fresh module: savingEnabled starts false. applyOwnStatus with available is the
    // page-load restore path — saveFavorite must not fire here.
    applyOwnStatus('available', Date.now() + 7200000);
    expect(saveFavoriteMock).not.toHaveBeenCalled();
  });

  test('saveFavorite fires when applyOwnStatus sets available after prior status call', () => {
    // applyOwnStatus(unavailable) → sets savingEnabled = true, then
    // applyOwnStatus(available) → setAvailable → saveFavorite fires.
    applyOwnStatus('unavailable', null);
    applyOwnStatus('available', Date.now() + 7200000);
    expect(saveFavoriteMock).toHaveBeenCalledTimes(1);
  });
});
