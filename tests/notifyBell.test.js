// tests/notifyBell.test.js
jest.mock('../js/prefs.js', () => ({
  getNotifyPrefs: jest.fn(() => ({ knock: false, call: false, availability: false })),
  setNotifyPref: jest.fn(),
}));
const { createNotifyBell } = require('../js/notifyBell.js');
const { getNotifyPrefs, setNotifyPref } = require('../js/prefs.js');

beforeEach(() => {
  document.body.innerHTML = '';
  getNotifyPrefs.mockReturnValue({ knock: false, call: false, availability: false });
  getNotifyPrefs.mockClear();
  setNotifyPref.mockClear();
});

test('renders a focusable button (not a div)', () => {
  const bell = createNotifyBell('alex', {});
  expect(bell.tagName).toBe('BUTTON');
  expect(bell.classList.contains('notify-bell')).toBe(true);
});

test('clicking the bell opens a popover with three switches', () => {
  const bell = createNotifyBell('alex', {});
  document.body.appendChild(bell);
  bell.click();
  const popover = document.querySelector('.notify-popover');
  expect(popover).not.toBeNull();
  expect(popover.querySelectorAll('button[role="switch"]').length).toBe(3);
});

test('popover is portaled to <body>, not nested under the bell container', () => {
  const wrapper = document.createElement('div');
  const bell = createNotifyBell('alex', {});
  wrapper.appendChild(bell);
  document.body.appendChild(wrapper);
  bell.click();
  const popover = document.querySelector('.notify-popover');
  expect(popover.parentElement).toBe(document.body);
  expect(wrapper.querySelector('.notify-popover')).toBeNull();
});

test('toggling a switch writes the pref', () => {
  const bell = createNotifyBell('alex', {});
  document.body.appendChild(bell);
  bell.click();
  document.querySelector('[data-type="knock"]').click();
  expect(setNotifyPref).toHaveBeenCalledWith('alex', 'knock', true);
});

test('turning a switch on calls onNeedPermission', () => {
  const onNeedPermission = jest.fn();
  const bell = createNotifyBell('alex', { onNeedPermission });
  document.body.appendChild(bell);
  bell.click();
  document.querySelector('[data-type="call"]').click();
  expect(onNeedPermission).toHaveBeenCalled();
});

test('bell shows active state when any pref is on', () => {
  getNotifyPrefs.mockReturnValue({ knock: true, call: false, availability: false });
  const bell = createNotifyBell('alex', {});
  expect(bell.classList.contains('active')).toBe(true);
});

test('renders only the switches in the types list', () => {
  const bell = createNotifyBell('alex', { types: ['knock', 'availability'] });
  document.body.appendChild(bell);
  bell.click();
  const switches = [...document.querySelectorAll('.notify-switch')].map((s) => s.dataset.type);
  expect(switches).toEqual(['knock', 'availability']);
});

test('defaults to all three types when types omitted', () => {
  const bell = createNotifyBell('alex', {});
  document.body.appendChild(bell);
  bell.click();
  const switches = [...document.querySelectorAll('.notify-switch')].map((s) => s.dataset.type);
  expect(switches).toEqual(['knock', 'call', 'availability']);
});

test('active-state counts only visible types', () => {
  getNotifyPrefs.mockReturnValue({ knock: true, call: false, availability: false });
  const bell = createNotifyBell('alex', { types: ['availability'] });
  expect(bell.classList.contains('active')).toBe(false);
});

test('renders an inline svg glyph (not the emoji)', () => {
  const bell = createNotifyBell('alex', {});
  expect(bell.querySelector('svg')).not.toBeNull();
  expect(bell.textContent).not.toContain('\u{1F514}');
});

test('single-type bell toggles the pref directly without a popover', () => {
  const bell = createNotifyBell('alex', { types: ['availability'] });
  document.body.appendChild(bell);
  bell.click();
  expect(document.querySelector('.notify-popover')).toBeNull();
  expect(setNotifyPref).toHaveBeenCalledWith('alex', 'availability', true);
});

test('single-type bell turning on calls onNeedPermission', () => {
  const onNeedPermission = jest.fn();
  const bell = createNotifyBell('alex', { types: ['availability'], onNeedPermission });
  document.body.appendChild(bell);
  bell.click();
  expect(onNeedPermission).toHaveBeenCalled();
});

test('single-type bell turning OFF does not call onNeedPermission', () => {
  getNotifyPrefs.mockReturnValue({ knock: false, call: false, availability: true });
  const onNeedPermission = jest.fn();
  const bell = createNotifyBell('alex', { types: ['availability'], onNeedPermission });
  document.body.appendChild(bell);
  bell.click();
  expect(setNotifyPref).toHaveBeenCalledWith('alex', 'availability', false);
  expect(onNeedPermission).not.toHaveBeenCalled();
});

test('multi-type bell still opens the popover', () => {
  const bell = createNotifyBell('alex', { types: ['knock', 'availability'] });
  document.body.appendChild(bell);
  bell.click();
  expect(document.querySelector('.notify-popover')).not.toBeNull();
});

test('clicking a single-type bell dismisses another bell\'s open popover', () => {
  const multi = createNotifyBell('alex', { types: ['knock', 'availability'] });
  const single = createNotifyBell('sam', { types: ['availability'] });
  document.body.append(multi, single);
  multi.click(); // opens popover
  expect(document.querySelector('.notify-popover')).not.toBeNull();
  single.click(); // single-type direct toggle — must close the orphaned popover
  expect(document.querySelector('.notify-popover')).toBeNull();
});

describe('popover placement (flip above the bell when it would clip off-screen)', () => {
  const POPOVER_H = 120;
  let heightSpy;

  function bellWithRect(rect) {
    const bell = createNotifyBell('alex', { types: ['knock', 'availability'] });
    bell.getBoundingClientRect = () => ({
      width: rect.right - rect.left, height: rect.bottom - rect.top,
      x: rect.left, y: rect.top, ...rect,
    });
    document.body.appendChild(bell);
    return bell;
  }

  beforeEach(() => {
    // jsdom has no layout: give every element a measurable popover height and
    // pin the viewport so the placement math is deterministic.
    heightSpy = jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(POPOVER_H);
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true, writable: true });
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true, writable: true });
  });
  afterEach(() => { heightSpy.mockRestore(); });

  test('opens below the bell when there is room', () => {
    const bell = bellWithRect({ top: 76, bottom: 100, left: 260, right: 300 });
    bell.click();
    const popover = document.querySelector('.notify-popover');
    expect(popover.style.top).toBe('104px'); // bottom + 4
  });

  test('flips above the bell when opening below would clip the viewport bottom', () => {
    const bell = bellWithRect({ top: 726, bottom: 750, left: 260, right: 300 });
    bell.click();
    const popover = document.querySelector('.notify-popover');
    expect(popover.style.top).toBe('602px'); // top - 4 - height
  });

  test('flipped placement never goes above the viewport (clamped to the top margin)', () => {
    Object.defineProperty(window, 'innerHeight', { value: 160, configurable: true, writable: true });
    const bell = bellWithRect({ top: 50, bottom: 74, left: 260, right: 300 });
    bell.click();
    const popover = document.querySelector('.notify-popover');
    expect(popover.style.top).toBe('8px');
  });
});

test('open popover closes when a card-drawer-close event fires', () => {
  const bell = createNotifyBell('alex', { types: ['knock', 'availability'] });
  document.body.appendChild(bell);
  bell.click();
  expect(document.querySelector('.notify-popover')).not.toBeNull();
  document.dispatchEvent(new CustomEvent('card-drawer-close'));
  expect(document.querySelector('.notify-popover')).toBeNull();
});
