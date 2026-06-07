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
