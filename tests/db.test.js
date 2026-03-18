// tests/db.test.js
const {
  userExists, touchLastSeen, rotateCode, setStatusColor, setPaletteKey,
  setCallState, clearCallState, getUser,
} = require('../js/db');

jest.mock('firebase/database', () => ({
  ref: jest.fn(() => 'mock-ref'),
  get: jest.fn(),
  update: jest.fn(),
  set: jest.fn(),
  remove: jest.fn(),
  runTransaction: jest.fn(),
}));
jest.mock('../js/firebase-config', () => ({ db: {} }));
jest.mock('../js/identity.js', () => ({ generateCode: jest.fn() }));
jest.mock('../js/store.js', () => ({ getFollowing: jest.fn() }));

const { ref, get, update, set, remove, runTransaction } = require('firebase/database');
const { generateCode } = require('../js/identity.js');
const { getFollowing } = require('../js/store.js');

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

describe('rotateCode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getFollowing.mockReturnValue([]);
  });

  test('happy path: reserves new code, updates user record, releases old code, returns new code', async () => {
    generateCode.mockReturnValue('NEW456');
    runTransaction.mockResolvedValue({ committed: true });
    update.mockResolvedValue();
    remove.mockResolvedValue();

    const result = await rotateCode('user-1', 'OLD123');

    expect(runTransaction).toHaveBeenCalledWith('mock-ref', expect.any(Function));
    expect(update).toHaveBeenCalledWith('mock-ref', { code: 'NEW456' });
    expect(remove).toHaveBeenCalledWith('mock-ref');
    expect(result).toBe('NEW456');
  });

  test('retries on collision: generateCode called twice, returns code from second attempt', async () => {
    generateCode
      .mockReturnValueOnce('TAKEN1')
      .mockReturnValueOnce('NEW456');
    runTransaction
      .mockResolvedValueOnce({ committed: false })
      .mockResolvedValueOnce({ committed: true });
    update.mockResolvedValue();
    remove.mockResolvedValue();

    const result = await rotateCode('user-1', 'OLD123');

    expect(generateCode).toHaveBeenCalledTimes(2);
    expect(result).toBe('NEW456');
  });

  test('calls set once per following entry with correct path value', async () => {
    getFollowing.mockReturnValue([
      { userId: 'followee-A', code: 'CODEA1', label: 'Alice' },
      { userId: 'followee-B', code: 'CODEB2', label: 'Bob' },
    ]);
    generateCode.mockReturnValue('NEW456');
    runTransaction.mockResolvedValue({ committed: true });
    update.mockResolvedValue();
    set.mockResolvedValue();
    remove.mockResolvedValue();

    await rotateCode('user-1', 'OLD123');

    expect(set).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenCalledWith('mock-ref', 'NEW456');
  });

  test('failure in step 2 (update) rejects the promise; remove is not called', async () => {
    generateCode.mockReturnValue('NEW456');
    runTransaction.mockResolvedValue({ committed: true });
    update.mockRejectedValue(new Error('network error'));

    await expect(rotateCode('user-1', 'OLD123')).rejects.toThrow('network error');
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('setStatusColor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('writes statusColor to users/{userId} path', async () => {
    update.mockResolvedValueOnce();
    await setStatusColor('user-1', '#a855f7');
    expect(ref).toHaveBeenCalledWith(expect.anything(), 'users/user-1');
    expect(update).toHaveBeenCalledWith('mock-ref', { statusColor: '#a855f7' });
  });
});

describe('setPaletteKey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('setPaletteKey calls update with paletteKey field', async () => {
    update.mockResolvedValueOnce();
    await setPaletteKey('uid1', 'ember');
    expect(update).toHaveBeenCalledWith(
      expect.anything(),
      { paletteKey: 'ember' }
    );
  });

  test('setPaletteKey coerces undefined to null', async () => {
    update.mockResolvedValueOnce();
    await setPaletteKey('uid1', undefined);
    expect(update).toHaveBeenCalledWith(
      expect.anything(),
      { paletteKey: null }
    );
  });
});

describe('setCallState', () => {
  beforeEach(() => jest.clearAllMocks());

  test('writes callState {calleeId, since} to users/{callerId}', async () => {
    update.mockResolvedValueOnce();
    await setCallState('caller-1', 'callee-2');
    expect(ref).toHaveBeenCalledWith(expect.anything(), 'users/caller-1');
    expect(update).toHaveBeenCalledWith('mock-ref', {
      callState: expect.objectContaining({
        calleeId: 'callee-2',
        since: expect.any(Number),
      }),
    });
  });
});

describe('clearCallState', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sets callState to null on users/{callerId}', async () => {
    update.mockResolvedValueOnce();
    await clearCallState('caller-1');
    expect(ref).toHaveBeenCalledWith(expect.anything(), 'users/caller-1');
    expect(update).toHaveBeenCalledWith('mock-ref', { callState: null });
  });
});

describe('getUser', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns user data when record exists', async () => {
    get.mockResolvedValueOnce({ exists: () => true, val: () => ({ status: 'available' }) });
    const result = await getUser('user-1');
    expect(result).toEqual({ status: 'available' });
  });

  test('returns null when record does not exist', async () => {
    get.mockResolvedValueOnce({ exists: () => false });
    const result = await getUser('user-1');
    expect(result).toBeNull();
  });
});
