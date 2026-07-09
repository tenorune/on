/** @jest-environment jsdom */
// Task 7: Mini App boot arrival path for the web onramp deep link
// (t.me/<bot>?startapp=lk_<token>). Redeems the lk_ token, showing the
// replace-confirm modal when the server reports this Telegram already has its
// own account (needsConfirm), then stamps the landing notice and reboots.
let startParam = 'lk_tok0000000000000000';
const mockTelegram = {
  isTelegramContext: jest.fn(() => true),
  tgWebApp: jest.fn(() => ({ initData: 'INIT', initDataUnsafe: { start_param: startParam } })),
  isTelegramLinked: jest.fn(() => false),
};
const mockRedeem = jest.fn();
const mockConfirm = jest.fn();
const mockToast = jest.fn();
const mockStampLinked = jest.fn();

jest.mock('../js/telegram.js', () => mockTelegram);
jest.mock('../js/firebase-config.js', () => ({ callRedeemTelegramLinkToken: (...a) => mockRedeem(...a) }));
jest.mock('../js/promptModal.js', () => ({ showConfirmModal: (...a) => mockConfirm(...a) }));
jest.mock('../js/groups.js', () => ({ showToast: (...a) => mockToast(...a) }));
jest.mock('../js/firstRun.js', () => ({ stampLinkedNotice: (...a) => mockStampLinked(...a) }));

let telegramLinkArrival;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  startParam = 'lk_tok0000000000000000';
  mockTelegram.isTelegramContext.mockReturnValue(true);
  mockTelegram.tgWebApp.mockImplementation(() => ({ initData: 'INIT', initDataUnsafe: { start_param: startParam } }));
  mockTelegram.isTelegramLinked.mockReturnValue(false);
  telegramLinkArrival = require('../js/telegramLinkArrival.js');
});
// Note: jsdom's window.location.reload is a non-configurable, non-writable
// own property here — it can't be deleted, reassigned, or spied on (verified
// directly against this repo's jsdom). Same constraint already documented in
// tests/graduation.test.js and tests/app-boot-cacheOwner.test.js. So — as
// those tests do — success is asserted via the observable gate immediately
// before the real reload() call (stampLinkedNotice), not the reload itself.

describe('extractLinkToken', () => {
  test('reads the lk_ prefix', () => {
    expect(telegramLinkArrival.extractLinkToken()).toBe('tok0000000000000000');
  });

  test('null outside Telegram', () => {
    mockTelegram.isTelegramContext.mockReturnValue(false);
    expect(telegramLinkArrival.extractLinkToken()).toBeNull();
  });

  test('null when start_param has no lk_ prefix', () => {
    startParam = 'someOtherToken1234567890';
    expect(telegramLinkArrival.extractLinkToken()).toBeNull();
  });

  test('null when the remainder fails the token shape check', () => {
    startParam = 'lk_short';
    expect(telegramLinkArrival.extractLinkToken()).toBeNull();
  });

  test('null when there is no start_param at all', () => {
    mockTelegram.tgWebApp.mockReturnValue({ initData: 'INIT', initDataUnsafe: {} });
    expect(telegramLinkArrival.extractLinkToken()).toBeNull();
  });
});

describe('runLinkArrival', () => {
  test('not an lk_ path → false, no redeem call', async () => {
    startParam = '';
    mockTelegram.tgWebApp.mockImplementation(() => ({ initData: 'INIT', initDataUnsafe: { start_param: startParam } }));
    const handled = await telegramLinkArrival.runLinkArrival({ dismissSplash: jest.fn() });
    expect(handled).toBe(false);
    expect(mockRedeem).not.toHaveBeenCalled();
  });

  test('empty account → silent link + stamp + reload', async () => {
    mockRedeem.mockResolvedValueOnce({ token: 'auth' });
    const handled = await telegramLinkArrival.runLinkArrival({ dismissSplash: jest.fn() });
    expect(handled).toBe(true);
    expect(mockRedeem).toHaveBeenCalledWith('INIT', 'tok0000000000000000', false);
    expect(mockStampLinked).toHaveBeenCalled();
  });

  test('needsConfirm → shows replace confirm; confirming re-redeems with confirm:true', async () => {
    mockRedeem.mockResolvedValueOnce({ needsConfirm: true, counts: { contacts: 2, groups: 1 } });
    mockConfirm.mockImplementationOnce(async ({ onConfirm }) => { await onConfirm(); return true; });
    mockRedeem.mockResolvedValueOnce({ token: 'auth' });
    const handled = await telegramLinkArrival.runLinkArrival({ dismissSplash: jest.fn() });
    expect(handled).toBe(true);
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Linking replaces this temporary Telegram account — its contacts and groups will be removed.',
      confirmLabel: 'Link account',
      busyLabel: 'Linking…',
    }));
    expect(mockRedeem).toHaveBeenLastCalledWith('INIT', 'tok0000000000000000', true);
    expect(mockStampLinked).toHaveBeenCalled();
  });

  test('needsConfirm + cancel → not handled, no stamp (let boot render the derived account)', async () => {
    mockRedeem.mockResolvedValueOnce({ needsConfirm: true, counts: { contacts: 1, groups: 0 } });
    mockConfirm.mockResolvedValueOnce(false);
    const handled = await telegramLinkArrival.runLinkArrival({ dismissSplash: jest.fn() });
    expect(handled).toBe(false);
    expect(mockStampLinked).not.toHaveBeenCalled();
  });

  test('expired token → toast, not handled, no stamp (let boot render the derived account)', async () => {
    mockRedeem.mockRejectedValueOnce(new Error('expired'));
    const dismissSplash = jest.fn();
    const handled = await telegramLinkArrival.runLinkArrival({ dismissSplash });
    expect(handled).toBe(false);
    expect(mockToast).toHaveBeenCalled();
    expect(dismissSplash).toHaveBeenCalled();
    expect(mockStampLinked).not.toHaveBeenCalled();
  });

  test('already linked (post-success reload re-presenting the same start_param) → false, no redeem call', async () => {
    mockTelegram.isTelegramLinked.mockReturnValue(true);
    const handled = await telegramLinkArrival.runLinkArrival({ dismissSplash: jest.fn() });
    expect(handled).toBe(false);
    expect(mockRedeem).not.toHaveBeenCalled();
  });
});
