// tests/me.test.js
jest.mock('../js/db.js', () => ({
  setStatus: jest.fn().mockResolvedValue(undefined),
  isExpired: (t) => t !== null && t !== undefined && t < Date.now(),
  formatTimeRemaining: (ms) => (ms > 0 ? '1h' : ''),
  timeRemainingMs: (t) => (!t ? 0 : Math.max(0, t - Date.now())),
}));
jest.mock('../js/store.js', () => ({
  getLastTimeout: () => 2,
  setLastTimeout: jest.fn(),
}));

const { applyOwnStatus } = require('../js/me');

beforeEach(() => {
  jest.useFakeTimers();
  document.body.innerHTML = `
    <div id="my-dot"></div>
    <div id="my-status-label"></div>
    <div id="slider-wrap" class="hidden"></div>
    <input id="timeout-slider" type="range" value="2" min="1" max="12" />
    <span id="slider-value">2h</span>
  `;
});

afterEach(() => {
  jest.useRealTimers();
});

test('dot loses available class when countdown timer fires after expiry', () => {
  const availableUntil = Date.now() + 1000; // expires 1 second from now
  applyOwnStatus('available', availableUntil);

  const dot = document.getElementById('my-dot');
  expect(dot.classList.contains('available')).toBe(true);

  jest.advanceTimersByTime(35000); // advance past expiry and past the 30s interval tick

  expect(dot.classList.contains('available')).toBe(false);
});
