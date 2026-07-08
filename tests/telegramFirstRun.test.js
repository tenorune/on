/** @jest-environment jsdom */
const mockWa = { initDataUnsafe: {} };
jest.mock('../js/telegram.js', () => ({
  isTelegramContext: jest.fn(() => true),
  tgWebApp: jest.fn(() => mockWa),
}));
jest.mock('../js/invites.js', () => ({ resolveInvitePreview: jest.fn() }));
jest.mock('../js/telegramSettings.js', () => ({ showLinkScreen: jest.fn() }));
jest.mock('../js/groups.js', () => ({ showToast: jest.fn() }));

const { resolveInvitePreview } = require('../js/invites.js');
const { showLinkScreen } = require('../js/telegramSettings.js');
const { isTelegramContext } = require('../js/telegram.js');
const { telegramInviteGate, extractStartParamToken, stampInviteOutcome, stampedInviteOutcome } = require('../js/telegramFirstRun.js');

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
const SCREEN = `
  <div id="tg-invite-screen" class="welcome-screen hidden">
    <p id="tg-invite-framing"></p>
    <button id="tg-invite-accept-btn"></button>
    <button id="tg-invite-phrase-btn"></button>
    <button id="tg-invite-dismiss-btn"></button>
  </div>`;

beforeEach(() => {
  document.body.innerHTML = SCREEN;
  mockWa.initDataUnsafe = {};
  jest.clearAllMocks();
  isTelegramContext.mockReturnValue(true);
});

test('extractStartParamToken: valid token / garbage / missing / outside TG', () => {
  mockWa.initDataUnsafe = { start_param: TOKEN };
  expect(extractStartParamToken()).toBe(TOKEN);
  mockWa.initDataUnsafe = { start_param: 'nope nope!' };
  expect(extractStartParamToken()).toBeNull();
  mockWa.initDataUnsafe = {};
  expect(extractStartParamToken()).toBeNull();
  isTelegramContext.mockReturnValue(false);
  mockWa.initDataUnsafe = { start_param: TOKEN };
  expect(extractStartParamToken()).toBeNull();
});

test('no token → null, preview never fetched', async () => {
  expect(await telegramInviteGate({ linked: false, dismissSplash: jest.fn() })).toBeNull();
  expect(resolveInvitePreview).not.toHaveBeenCalled();
});

test('invalid/revoked token (null preview) → null, no interstitial', async () => {
  mockWa.initDataUnsafe = { start_param: TOKEN };
  resolveInvitePreview.mockResolvedValue(null);
  expect(await telegramInviteGate({ linked: false, dismissSplash: jest.fn() })).toBeNull();
  expect(document.getElementById('tg-invite-screen').classList.contains('hidden')).toBe(true);
});

test('linked → silent token, no interstitial', async () => {
  mockWa.initDataUnsafe = { start_param: TOKEN };
  resolveInvitePreview.mockResolvedValue({ scope: 'personal', label: 'Ana' });
  const got = await telegramInviteGate({ linked: true, dismissSplash: jest.fn() });
  expect(got).toEqual({ token: TOKEN, preview: { scope: 'personal', label: 'Ana' }, silent: true });
  expect(document.getElementById('tg-invite-screen').classList.contains('hidden')).toBe(true);
});

test('unlinked: interstitial with personal framing; Accept resolves the token', async () => {
  mockWa.initDataUnsafe = { start_param: TOKEN };
  resolveInvitePreview.mockResolvedValue({ scope: 'personal', label: 'Ana' });
  const dismissSplash = jest.fn();
  const p = telegramInviteGate({ linked: false, dismissSplash });
  await Promise.resolve(); await Promise.resolve();
  expect(dismissSplash).toHaveBeenCalled();
  expect(document.getElementById('tg-invite-screen').classList.contains('hidden')).toBe(false);
  expect(document.getElementById('tg-invite-framing').textContent).toBe('Ana invited you to follow them.');
  document.getElementById('tg-invite-accept-btn').click();
  const got = await p;
  expect(got.token).toBe(TOKEN);
  expect(got.silent).toBe(false);
  expect(document.getElementById('tg-invite-screen').classList.contains('hidden')).toBe(true);
});

test('group framing text', async () => {
  mockWa.initDataUnsafe = { start_param: TOKEN };
  resolveInvitePreview.mockResolvedValue({ scope: 'group', groupName: 'Buddies', groupId: 'g1' });
  const p = telegramInviteGate({ linked: false, dismissSplash: jest.fn() });
  await Promise.resolve(); await Promise.resolve();
  expect(document.getElementById('tg-invite-framing').textContent).toBe("You've been invited to join Buddies.");
  document.getElementById('tg-invite-dismiss-btn').click();
  await p;
});

test('"I have a secret phrase" → showLinkScreen, resolves null', async () => {
  mockWa.initDataUnsafe = { start_param: TOKEN };
  resolveInvitePreview.mockResolvedValue({ scope: 'personal', label: 'Ana' });
  const p = telegramInviteGate({ linked: false, dismissSplash: jest.fn() });
  await Promise.resolve(); await Promise.resolve();
  document.getElementById('tg-invite-phrase-btn').click();
  expect(await p).toBeNull();
  expect(showLinkScreen).toHaveBeenCalled();
});

test('"Not now" → resolves null, nothing redeemed', async () => {
  mockWa.initDataUnsafe = { start_param: TOKEN };
  resolveInvitePreview.mockResolvedValue({ scope: 'personal', label: 'Ana' });
  const p = telegramInviteGate({ linked: false, dismissSplash: jest.fn() });
  await Promise.resolve(); await Promise.resolve();
  document.getElementById('tg-invite-dismiss-btn').click();
  expect(await p).toBeNull();
});

test('returning unlinked arrival sees "Accept", not "& get started"', async () => {
  mockWa.initDataUnsafe = { start_param: TOKEN };
  resolveInvitePreview.mockResolvedValue({ scope: 'personal', label: 'Ana' });
  const p = telegramInviteGate({ linked: false, isNew: false, dismissSplash: jest.fn() });
  await Promise.resolve(); await Promise.resolve();
  expect(document.getElementById('tg-invite-accept-btn').textContent).toBe('Accept');
  document.getElementById('tg-invite-dismiss-btn').click();
  await p;
});

test('first-ever open keeps "Accept & get started"', async () => {
  mockWa.initDataUnsafe = { start_param: TOKEN };
  resolveInvitePreview.mockResolvedValue({ scope: 'personal', label: 'Ana' });
  const p = telegramInviteGate({ linked: false, isNew: true, dismissSplash: jest.fn() });
  await Promise.resolve(); await Promise.resolve();
  expect(document.getElementById('tg-invite-accept-btn').textContent).toBe('Accept & get started');
  document.getElementById('tg-invite-dismiss-btn').click();
  await p;
});

describe('invite outcome stamps (W1 J#4/J#5)', () => {
  beforeEach(() => localStorage.clear());

  test('stamp + read round-trip', () => {
    stampInviteOutcome('tokA', 'dismissed');
    expect(stampedInviteOutcome('tokA')).toBe('dismissed');
    expect(stampedInviteOutcome('tokB')).toBeNull();
  });

  test('prunes to the 8 most recent tokens', () => {
    for (let i = 0; i < 10; i++) stampInviteOutcome(`tok${i}`, 'redeemed');
    expect(stampedInviteOutcome('tok0')).toBeNull();
    expect(stampedInviteOutcome('tok9')).toBe('redeemed');
  });

  test('corrupt storage reads as unstamped', () => {
    localStorage.setItem('statusapp_invite_outcomes', '{not json');
    expect(stampedInviteOutcome('tokA')).toBeNull();
  });

  test('prunes numeric tokens correctly (object key-order invariant)', () => {
    // Stamp 8 non-numeric tokens first (these should be the 8 to keep)
    for (let i = 0; i < 8; i++) stampInviteOutcome(`tokA${i}`, 'redeemed');
    // Then stamp a numeric token (all-digit string, canonical numeric key, should be newest)
    stampInviteOutcome('1234567890', 'redeemed');
    // Numeric keys sort first in Object.keys(), so it comes before non-numeric keys.
    // The pruning logic deletes keys[0..N-OUTCOME_MAX], which would delete the numeric key
    // even though it's the newest. After fix, numeric token should survive as newest.
    expect(stampedInviteOutcome('1234567890')).toBe('redeemed');
    // The oldest non-numeric token should be pruned (tokA0)
    expect(stampedInviteOutcome('tokA0')).toBeNull();
    // The newest non-numeric token should still survive
    expect(stampedInviteOutcome('tokA7')).toBe('redeemed');
  });
});
