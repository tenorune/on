/** @jest-environment jsdom */
// tests/devReset.test.js — dev-only, env-gated identity-reset link (js/devReset.js).
// Covers: full-match fire, each individual gate failing closed, allowlist
// comma-parsing, and signOut rejection being swallowed.
//
// A note on window.location: this jsdom version hardcodes window.location
// (and its hostname/replace accessors) as non-configurable "unforgeable"
// properties (see node_modules/jsdom/lib/jsdom/browser/Window.js), so unlike
// older jsdom releases it cannot be deleted, reassigned, or spied on here —
// verified directly against this repo's jsdom/jest versions. That's the same
// constraint already documented in tests/graduation.test.js and
// tests/app-boot-cacheOwner.test.js for window.location.reload(). So:
//   - `search` is driven with the real, supported history.pushState (jsdom
//     does implement same-document history navigation).
//   - `hostname` is jsdom's fixed default ('localhost' — probed directly);
//     allowlist tests vary DEV_RESET_HOSTS around that fixed value instead of
//     trying to vary the hostname itself.
//   - `replace()` can't be spied on directly, so — mirroring the existing
//     project pattern of asserting the observable gate immediately before an
//     unmockable navigation call — we assert the real (mocked) clearIdentity/
//     signOut/console.info calls that precede it, plus the fact that jsdom's
//     "not implemented: navigation" report fires, which only happens if
//     window.location.replace() was actually invoked.

const mockClearIdentity = jest.fn();
const mockSignOut = jest.fn(() => Promise.resolve());

jest.mock('../js/identity.js', () => ({ clearIdentity: (...a) => mockClearIdentity(...a) }));
jest.mock('../js/firebase-config.js', () => ({ auth: {} }));
jest.mock('firebase/auth', () => ({ signOut: (...a) => mockSignOut(...a) }));

const { maybeRunDevReset } = require('../js/devReset.js');

let consoleInfoSpy;
let consoleErrorSpy;

function setSearch(search) {
  history.pushState(null, '', search || '/');
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DEV_RESET_SECRET;
  delete process.env.DEV_RESET_HOSTS;
  setSearch('/');
  consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
  // Silences jsdom's expected "Not implemented: navigation" report from the
  // real replace() call (see file header); also doubles as proof that
  // replace() was actually reached in the "fires" tests below.
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.DEV_RESET_SECRET;
  delete process.env.DEV_RESET_HOSTS;
  consoleInfoSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

function expectReplaceWasInvoked() {
  expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  const err = consoleErrorSpy.mock.calls[0][0];
  // jsdom's not-implemented reporter stamps error.type; check that rather than
  // `instanceof Error` since jsdom's Error and the test realm's Error are
  // different constructors here.
  expect(err.type).toBe('not implemented');
  expect(err.message).toMatch(/not implemented: navigation/i);
}

describe('maybeRunDevReset', () => {
  test('fires on correct secret + allowlisted host', async () => {
    process.env.DEV_RESET_SECRET = 's3cr3t';
    process.env.DEV_RESET_HOSTS = 'localhost,dev.example.com';
    setSearch('/?dev-reset=s3cr3t');

    const result = await maybeRunDevReset();

    expect(result).toBe(true);
    expect(mockClearIdentity).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(consoleInfoSpy).toHaveBeenCalledWith('[dev-reset] identity cleared');
    expectReplaceWasInvoked();
  });

  test('no-op when secret is empty/unset', async () => {
    // DEV_RESET_SECRET left unset by beforeEach
    process.env.DEV_RESET_HOSTS = 'localhost';
    setSearch('/?dev-reset=anything');

    const result = await maybeRunDevReset();

    expect(result).toBe(false);
    expect(mockClearIdentity).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  test('no-op when the dev-reset param is missing', async () => {
    process.env.DEV_RESET_SECRET = 's3cr3t';
    process.env.DEV_RESET_HOSTS = 'localhost';
    setSearch('/');

    const result = await maybeRunDevReset();

    expect(result).toBe(false);
    expect(mockClearIdentity).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  test('no-op when the dev-reset param has the wrong value', async () => {
    process.env.DEV_RESET_SECRET = 's3cr3t';
    process.env.DEV_RESET_HOSTS = 'localhost';
    setSearch('/?dev-reset=nope');

    const result = await maybeRunDevReset();

    expect(result).toBe(false);
    expect(mockClearIdentity).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  test('no-op when the correct secret is used but hostname is not in the allowlist', async () => {
    process.env.DEV_RESET_SECRET = 's3cr3t';
    process.env.DEV_RESET_HOSTS = 'dev.example.com'; // excludes the real jsdom hostname ('localhost')
    setSearch('/?dev-reset=s3cr3t');

    const result = await maybeRunDevReset();

    expect(result).toBe(false);
    expect(mockClearIdentity).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  test('allowlist: matches one of several comma-separated entries with surrounding spaces', async () => {
    process.env.DEV_RESET_SECRET = 's3cr3t';
    process.env.DEV_RESET_HOSTS = ' foo.example.com , localhost , bar.example.com ';
    setSearch('/?dev-reset=s3cr3t');

    const result = await maybeRunDevReset();

    expect(result).toBe(true);
    expect(mockClearIdentity).toHaveBeenCalledTimes(1);
    expectReplaceWasInvoked();
  });

  test('allowlist: a host not among the comma-separated entries does not fire', async () => {
    process.env.DEV_RESET_SECRET = 's3cr3t';
    process.env.DEV_RESET_HOSTS = ' foo.example.com , bar.example.com , baz.example.com ';
    setSearch('/?dev-reset=s3cr3t');

    const result = await maybeRunDevReset();

    expect(result).toBe(false);
    expect(mockClearIdentity).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  test('signOut rejection is swallowed: clearIdentity + replace still happen, returns true', async () => {
    process.env.DEV_RESET_SECRET = 's3cr3t';
    process.env.DEV_RESET_HOSTS = 'localhost';
    mockSignOut.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    setSearch('/?dev-reset=s3cr3t');

    const result = await maybeRunDevReset();

    expect(result).toBe(true);
    expect(mockClearIdentity).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(consoleInfoSpy).toHaveBeenCalledWith('[dev-reset] identity cleared');
    expectReplaceWasInvoked();
  });
});
