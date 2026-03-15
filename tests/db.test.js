// tests/db.test.js
const { userExists, touchLastSeen } = require('../js/db');

jest.mock('firebase/database', () => ({
  ref: jest.fn(() => 'mock-ref'),
  get: jest.fn(),
  update: jest.fn(),
}));
jest.mock('../js/firebase-config', () => ({ db: {} }));

const { get, update } = require('firebase/database');

test('userExists returns true when Firebase record exists', async () => {
  get.mockResolvedValueOnce({ exists: () => true });
  const result = await userExists('user-123');
  expect(result).toBe(true);
});

test('userExists returns false when Firebase record does not exist', async () => {
  get.mockResolvedValueOnce({ exists: () => false });
  const result = await userExists('user-456');
  expect(result).toBe(false);
});

test('touchLastSeen writes lastSeen timestamp to users/{userId}', async () => {
  update.mockResolvedValueOnce();
  await touchLastSeen('user-789');
  expect(update).toHaveBeenCalledWith('mock-ref', expect.objectContaining({ lastSeen: expect.any(Number) }));
});
