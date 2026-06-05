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
