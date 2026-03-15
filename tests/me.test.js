// tests/me.test.js
jest.mock('../js/db.js', () => ({
  setStatus: jest.fn().mockResolvedValue(undefined),
  isExpired: (t) => t !== null && t !== undefined && t < Date.now(),
  formatTimeRemaining: (ms) => ms > 0 ? '2h' : '',
  timeRemainingMs: (t) => !t ? 0 : Math.max(0, t - Date.now()),
}));
jest.mock('../js/store.js', () => ({
  getLastTimeout: jest.fn(),
  setLastTimeout: jest.fn(),
}));

const { setStatus } = require('../js/db.js');
const { getLastTimeout, setLastTimeout } = require('../js/store.js');
const { applyOwnStatus, initHeader } = require('../js/me.js');

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
  getLastTimeout.mockReturnValue(480); // index 7 = 8 hours
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
