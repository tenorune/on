// tests/featureSettings.test.js
jest.mock('../js/prefs.js', () => ({
  getFeatureToggle: jest.fn(() => true),
  setFeatureToggle: jest.fn(),
}));

const { getFeatureToggle, setFeatureToggle } = require('../js/prefs.js');
const { initFeatureSettings, _setReloadForTests } = require('../js/featureSettings.js');

let reload;
beforeEach(() => {
  document.body.innerHTML = '<div id="feature-settings" class="feature-settings hidden"></div>';
  getFeatureToggle.mockReturnValue(true);
  setFeatureToggle.mockClear();
  reload = jest.fn();
  _setReloadForTests(reload);
  window.history.pushState({}, '', '/'); // no ?features
});

test('does nothing (section stays hidden) without the ?features query param', () => {
  initFeatureSettings();
  const el = document.getElementById('feature-settings');
  expect(el.classList.contains('hidden')).toBe(true);
  expect(el.children.length).toBe(0);
});

test('renders and reveals the section with ?features, one switch per feature', () => {
  window.history.pushState({}, '', '/?features');
  initFeatureSettings();
  const el = document.getElementById('feature-settings');
  expect(el.classList.contains('hidden')).toBe(false);
  expect(el.querySelector('#feature-toggle-palettes')).not.toBeNull();
  expect(el.querySelector('#feature-toggle-groups')).not.toBeNull();
});

test('switches reflect current toggle state', () => {
  window.history.pushState({}, '', '/?features');
  getFeatureToggle.mockImplementation((k) => k !== 'groups'); // groups off
  initFeatureSettings();
  expect(document.getElementById('feature-toggle-palettes').checked).toBe(true);
  expect(document.getElementById('feature-toggle-groups').checked).toBe(false);
});

test('flipping a switch writes the pref and reloads', () => {
  window.history.pushState({}, '', '/?features');
  initFeatureSettings();
  const sw = document.getElementById('feature-toggle-groups');
  sw.checked = false;
  sw.dispatchEvent(new Event('change'));
  expect(setFeatureToggle).toHaveBeenCalledWith('groups', false);
  expect(reload).toHaveBeenCalledTimes(1);
  // Brief reload affordance: the flipped switch is disabled and a status shows.
  expect(sw.disabled).toBe(true);
  expect(document.querySelector('.feature-settings-status').textContent).toBe('Reloading…');
});

test('is a no-op when the #feature-settings container is absent', () => {
  window.history.pushState({}, '', '/?features');
  document.body.innerHTML = ''; // container missing
  expect(() => initFeatureSettings()).not.toThrow();
});
