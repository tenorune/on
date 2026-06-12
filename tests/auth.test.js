jest.mock('../js/firebase-config.js', () => ({
  auth: { currentUser: null, authStateReady: jest.fn().mockResolvedValue(undefined) },
  callValidateRecovery: jest.fn(),
}));
jest.mock('firebase/auth', () => ({ signInWithCustomToken: jest.fn(), signOut: jest.fn() }));

const { auth, callValidateRecovery } = require('../js/firebase-config.js');
const { signInWithCustomToken, signOut } = require('firebase/auth');
const { ensureSignedIn } = require('../js/auth.js');
const { deriveUserIdFromRecoveryCode } = require('../js/identity.js');

beforeEach(() => { jest.clearAllMocks(); auth.currentUser = null; });

test('reuses a cached session for the same account — no validateRecovery call', async () => {
  const code = 'swift-river-amber-dust';
  auth.currentUser = { uid: await deriveUserIdFromRecoveryCode(code) };
  await ensureSignedIn(code);
  expect(callValidateRecovery).not.toHaveBeenCalled();
  expect(signInWithCustomToken).not.toHaveBeenCalled();
  expect(signOut).not.toHaveBeenCalled();
});

test('re-auths when the cached session belongs to a different account', async () => {
  // A prior failed restore (mistyped phrase) can leave a dead-uid session;
  // a subsequent correct phrase must replace it, not reuse it.
  auth.currentUser = { uid: 'deadbeefdeadbeefdeadbeefdeadbeef' };
  callValidateRecovery.mockResolvedValue('TOKEN');
  await ensureSignedIn('swift-river-amber-dust');
  expect(signOut).toHaveBeenCalledWith(auth);
  expect(callValidateRecovery).toHaveBeenCalledWith('swift-river-amber-dust');
  expect(signInWithCustomToken).toHaveBeenCalledWith(auth, 'TOKEN');
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
