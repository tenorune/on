// tests/identity.test.js
const { generateCode, loadIdentity, saveIdentity, clearIdentity } = require('../js/identity');

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

test('loadIdentity returns null when localStorage is empty', () => {
  expect(loadIdentity()).toBeNull();
});

test('saveIdentity persists v2 schema and loadIdentity retrieves it', () => {
  saveIdentity('user-123', 'AB3K9X', 'swift-river-amber-dust');
  const identity = loadIdentity();
  expect(identity).toEqual({
    userId: 'user-123',
    code: 'AB3K9X',
    recoveryCode: 'swift-river-amber-dust',
  });
});

test('clearIdentity removes the stored identity so loadIdentity returns null', () => {
  saveIdentity('user-abc', 'XYZ123', 'one-two-three-four');
  clearIdentity();
  expect(loadIdentity()).toBeNull();
});

test('loadIdentity returns null and wipes localStorage when v1-shape data is stored', () => {
  localStorage.setItem('statusapp_identity', JSON.stringify({ userId: 'old-uid', code: 'OLD123' }));
  expect(loadIdentity()).toBeNull();
  expect(localStorage.getItem('statusapp_identity')).toBeNull();
});

test('loadIdentity returns null and wipes localStorage when stored value is corrupt', () => {
  localStorage.setItem('statusapp_identity', '{bad json');
  expect(loadIdentity()).toBeNull();
  expect(localStorage.getItem('statusapp_identity')).toBeNull();
});
