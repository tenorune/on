jest.mock('../js/firebase-config.js', () => ({
  auth: { currentUser: null, authStateReady: jest.fn().mockResolvedValue(undefined) },
  db: {},
  callValidateRecovery: jest.fn(),
}));
jest.mock('firebase/auth', () => ({ signInWithCustomToken: jest.fn(), signOut: jest.fn() }));
jest.mock('firebase/database', () => ({ ref: jest.fn((_db, path) => path), get: jest.fn().mockResolvedValue({}) }));

const { auth, callValidateRecovery } = require('../js/firebase-config.js');
const { signInWithCustomToken, signOut } = require('firebase/auth');
const { get } = require('firebase/database');
const { ensureSignedIn } = require('../js/auth.js');
const { deriveUserIdFromRecoveryCode } = require('../js/identity.js');

beforeEach(() => { jest.clearAllMocks(); auth.currentUser = null; get.mockResolvedValue({}); });

test('after a fresh sign-in, waits for RTDB auth to propagate (retries the warm-up read past a denial)', async () => {
  auth.currentUser = null;
  callValidateRecovery.mockResolvedValue('TOKEN');
  signInWithCustomToken.mockImplementation(async () => { auth.currentUser = { uid: 'abc' }; });
  // The RTDB connection isn't authed yet on the first probe, then becomes authed.
  get.mockRejectedValueOnce(new Error('Permission denied')).mockResolvedValueOnce({});
  await ensureSignedIn('swift-river-amber-dust');
  expect(get).toHaveBeenCalledTimes(2); // retried until the read succeeded
});

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

test('re-auth on a different account clears any stored graduation phrase (F5 #287)', async () => {
  localStorage.clear();
  localStorage.setItem('statusapp_grad_phrase_deadbeef', 'echo-foxtrot-golf-hotel');
  auth.currentUser = { uid: 'deadbeefdeadbeefdeadbeefdeadbeef' };
  callValidateRecovery.mockResolvedValue('TOKEN');
  await ensureSignedIn('swift-river-amber-dust');
  expect(signOut).toHaveBeenCalledWith(auth);
  expect(localStorage.getItem('statusapp_grad_phrase_deadbeef')).toBeNull();
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
