// tests/identity.test.js
const { generateCode, generateUserId, loadIdentity, saveIdentity, clearIdentity } = require('../js/identity');

beforeEach(() => {
  localStorage.clear();
});

test('generateCode returns 6-char uppercase alphanumeric string', () => {
  const code = generateCode();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
});

test('generateCode returns different values on successive calls', () => {
  const codes = new Set(Array.from({ length: 20 }, generateCode));
  expect(codes.size).toBeGreaterThan(1);
});

test('generateUserId returns a UUID-shaped string', () => {
  const id = generateUserId();
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('loadIdentity returns null when localStorage is empty', () => {
  expect(loadIdentity()).toBeNull();
});

test('saveIdentity persists and loadIdentity retrieves it', () => {
  saveIdentity('user-123', 'AB3K9X');
  const identity = loadIdentity();
  expect(identity).toEqual({ userId: 'user-123', code: 'AB3K9X' });
});

test('clearIdentity removes the stored identity so loadIdentity returns null', () => {
  saveIdentity('user-abc', 'XYZ123');
  clearIdentity();
  expect(loadIdentity()).toBeNull();
});
