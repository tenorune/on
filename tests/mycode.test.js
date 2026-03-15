// tests/mycode.test.js
jest.mock('../js/db.js', () => ({
  rotateCode: jest.fn(),
}));
jest.mock('../js/identity.js', () => ({ saveIdentity: jest.fn() }));

const { rotateCode } = require('../js/db.js');
const { saveIdentity } = require('../js/identity.js');
const { initCodeDrawer } = require('../js/mycode.js');

beforeEach(() => {
  document.body.innerHTML = `
    <span id="my-code-display" class="code-display"></span>
    <button id="rotate-code-btn" class="rotate-btn"></button>
    <button id="copy-code-btn" class="ghost-btn">Copy</button>
    <p id="rotate-error-msg" class="error-msg hidden"></p>
  `;
  Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
  jest.clearAllMocks();
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

  // Flush promises and the 200ms fade timeout
  await new Promise((resolve) => setTimeout(resolve, 250));

  expect(document.getElementById('my-code-display').textContent).toBe('XYZ789');
  expect(saveIdentity).toHaveBeenCalledWith('uid1', 'XYZ789');
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
