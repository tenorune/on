jest.mock('../js/firebase-config.js', () => ({
  auth: { currentUser: null, authStateReady: jest.fn().mockResolvedValue(undefined) },
  callValidateRecovery: jest.fn(),
}));
jest.mock('firebase/auth', () => ({ signInWithCustomToken: jest.fn() }));

const { auth, callValidateRecovery } = require('../js/firebase-config.js');
const { signInWithCustomToken } = require('firebase/auth');
const { ensureSignedIn } = require('../js/auth.js');

beforeEach(() => { jest.clearAllMocks(); auth.currentUser = null; });

test('reuses a cached session — no validateRecovery call', async () => {
  auth.currentUser = { uid: 'abc' };
  await ensureSignedIn('swift-river-amber-dust');
  expect(callValidateRecovery).not.toHaveBeenCalled();
  expect(signInWithCustomToken).not.toHaveBeenCalled();
});

test('cold start signs in with a freshly minted token', async () => {
  auth.currentUser = null;
  callValidateRecovery.mockResolvedValue('TOKEN');
  signInWithCustomToken.mockResolvedValue({ user: { uid: 'abc' } });
  await ensureSignedIn('swift-river-amber-dust');
  expect(callValidateRecovery).toHaveBeenCalledWith('swift-river-amber-dust');
  expect(signInWithCustomToken).toHaveBeenCalledWith(auth, 'TOKEN');
});

test('throws when no cached session and no code is available', async () => {
  auth.currentUser = null;
  await expect(ensureSignedIn(null)).rejects.toThrow(/recovery code/i);
  expect(callValidateRecovery).not.toHaveBeenCalled();
});
