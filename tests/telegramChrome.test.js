/** @jest-environment jsdom */
const mocks = {
  cardOpen: jest.fn(() => false), closeCard: jest.fn(),
  popOpen: jest.fn(() => false), dismissPop: jest.fn(),
  closeInvite: jest.fn(), closeInbox: jest.fn(),
  ctx: jest.fn(() => ({ context: 'direct' })), toDirect: jest.fn(),
  callee: jest.fn(() => null), incoming: jest.fn(() => null),
};
jest.mock('../js/cardDrawer.js', () => ({ isCardDrawerOpen: (...a) => mocks.cardOpen(...a), closeCardDrawer: (...a) => mocks.closeCard(...a) }));
jest.mock('../js/notifyBell.js', () => ({ isNotifyPopoverOpen: (...a) => mocks.popOpen(...a), dismissNotifyPopover: (...a) => mocks.dismissPop(...a) }));
jest.mock('../js/inviteModal.js', () => ({ closeInviteModal: (...a) => mocks.closeInvite(...a) }));
jest.mock('../js/inbox.js', () => ({ closeInboxModal: (...a) => mocks.closeInbox(...a) }));
jest.mock('../js/groupNav.js', () => ({ navigateToDirect: (...a) => mocks.toDirect(...a), getCurrentContext: (...a) => mocks.ctx(...a) }));
jest.mock('../js/following.js', () => ({ getCallModeCalleeId: (...a) => mocks.callee(...a), getIncomingCallFrom: (...a) => mocks.incoming(...a) }));
let mockWa = null;
jest.mock('../js/telegram.js', () => ({ tgWebApp: jest.fn(() => mockWa), isTelegramContext: jest.fn(() => true) }));

const { resolveBackAction, initTelegramChrome, syncChromeColor } = require('../js/telegramChrome.js');

const SHELL = `
  <div id="restore-screen" class="hidden"><button id="restore-cancel-btn"></button></div>
  <div id="tg-invite-screen" class="hidden"></div>
  <div id="recovery-modal" class="hidden"></div>
  <div id="invite-modal" class="hidden"></div>
  <div id="create-group-modal" class="hidden"><button id="create-group-cancel-btn"></button></div>
  <div id="inbox-modal" class="hidden"></div>
  <div id="invite-failure-overlay" class="hidden"><button id="invite-failure-continue"></button></div>
  <div id="code-drawer"><button id="mycode-chip"></button></div>
  <div id="add-person-form"><button id="add-cancel-btn"></button></div>
  <div id="confirm-modal" class="hidden"><button id="confirm-modal-cancel-btn"></button></div>
  <div id="text-prompt-modal" class="hidden"><button id="text-prompt-cancel-btn"></button></div>
  <div id="unfollow-confirm" class="hidden"><button id="unfollow-cancel-btn"></button></div>
  <div id="rotate-confirm" class="hidden"><button id="rotate-cancel-btn"></button></div>
  <div id="graduation-info-toast" class="hidden"><button id="graduation-info-close"></button></div>
  <div id="tg-invite-error" class="hidden"><button id="tg-invite-error-dismiss"></button></div>
  <div id="boot-error-overlay" class="hidden"></div>`;

beforeEach(() => { document.body.innerHTML = SHELL; jest.clearAllMocks();
  mockWa = null;
  mocks.cardOpen.mockReturnValue(false); mocks.popOpen.mockReturnValue(false);
  mocks.ctx.mockReturnValue({ context: 'direct' }); });

const show = (id) => document.getElementById(id).classList.remove('hidden');

test('nothing open, direct context → null', () => {
  expect(resolveBackAction()).toBeNull();
});

test('restore screen wins over everything → clicks its cancel', () => {
  show('restore-screen'); show('invite-modal'); mocks.ctx.mockReturnValue({ context: 'group', groupId: 'g' });
  const cancelSpy = jest.fn();
  document.getElementById('restore-cancel-btn').addEventListener('click', cancelSpy);
  resolveBackAction()();
  expect(cancelSpy).toHaveBeenCalled();
});

test('interstitial and recovery modal → null (Telegram default / history trap)', () => {
  show('tg-invite-screen');
  expect(resolveBackAction()).toBeNull();
  document.getElementById('tg-invite-screen').classList.add('hidden');
  show('recovery-modal');
  expect(resolveBackAction()).toBeNull();
});

test('modals in priority order: invite → create-group → inbox → failure overlay', () => {
  show('invite-modal');
  resolveBackAction()();
  expect(mocks.closeInvite).toHaveBeenCalled();
  document.getElementById('invite-modal').classList.add('hidden');
  show('inbox-modal');
  resolveBackAction()();
  expect(mocks.closeInbox).toHaveBeenCalled();
});

test('popover, card drawer, add form, code drawer', () => {
  mocks.popOpen.mockReturnValue(true);
  resolveBackAction()();
  expect(mocks.dismissPop).toHaveBeenCalled();
  mocks.popOpen.mockReturnValue(false);

  mocks.cardOpen.mockReturnValue(true);
  resolveBackAction()();
  expect(mocks.closeCard).toHaveBeenCalled();
  mocks.cardOpen.mockReturnValue(false);

  document.getElementById('add-person-form').classList.add('open');
  const addCancel = jest.fn();
  document.getElementById('add-cancel-btn').addEventListener('click', addCancel);
  resolveBackAction()();
  expect(addCancel).toHaveBeenCalled();
  document.getElementById('add-person-form').classList.remove('open');

  document.getElementById('code-drawer').classList.add('open');
  const chip = jest.fn();
  document.getElementById('mycode-chip').addEventListener('click', chip);
  resolveBackAction()();
  expect(chip).toHaveBeenCalled();
});

test('group context → navigateToDirect', () => {
  mocks.ctx.mockReturnValue({ context: 'group', groupId: 'g1' });
  resolveBackAction()();
  expect(mocks.toDirect).toHaveBeenCalled();
});

test('create-group-modal visible → clicks its cancel button', () => {
  show('create-group-modal');
  const cancelSpy = jest.fn();
  document.getElementById('create-group-cancel-btn').addEventListener('click', cancelSpy);
  resolveBackAction()();
  expect(cancelSpy).toHaveBeenCalled();
});

test('invite-failure-overlay visible → clicks its continue button', () => {
  show('invite-failure-overlay');
  const continueSpy = jest.fn();
  document.getElementById('invite-failure-continue').addEventListener('click', continueSpy);
  resolveBackAction()();
  expect(continueSpy).toHaveBeenCalled();
});

describe('back button covers the W1 overlays (C#1)', () => {
  test.each([
    ['confirm-modal', 'confirm-modal-cancel-btn'],
    ['text-prompt-modal', 'text-prompt-cancel-btn'],
    ['unfollow-confirm', 'unfollow-cancel-btn'],
    ['rotate-confirm', 'rotate-cancel-btn'],
    ['graduation-info-toast', 'graduation-info-close'],
    ['tg-invite-error', 'tg-invite-error-dismiss'],
  ])('%s open → back clicks %s', (overlayId, cancelId) => {
    show(overlayId);
    const clicked = jest.fn();
    document.getElementById(cancelId).click = clicked;
    resolveBackAction()();
    expect(clicked).toHaveBeenCalled();
  });

  test('confirm-modal wins over an open group context', () => {
    show('confirm-modal');
    mocks.ctx.mockReturnValue({ context: 'group', groupId: 'g' });
    const clicked = jest.fn();
    document.getElementById('confirm-modal-cancel-btn').click = clicked;
    resolveBackAction()();
    expect(clicked).toHaveBeenCalled();
  });

  test('boot-error-overlay open → back hidden (null)', () => {
    show('boot-error-overlay');
    expect(resolveBackAction()).toBeNull();
  });
});

describe('call-state gating (inCall)', () => {
  const makeFakeWa = () => ({
    isVersionAtLeast: () => true,
    ready: jest.fn(),
    expand: jest.fn(),
    disableVerticalSwipes: jest.fn(),
    setHeaderColor: jest.fn(),
    setBackgroundColor: jest.fn(),
    BackButton: { show: jest.fn(), hide: jest.fn(), onClick: jest.fn() },
    enableClosingConfirmation: jest.fn(),
    disableClosingConfirmation: jest.fn(),
  });

  test('in a call → BackButton hidden (not shown) and closing confirmation enabled', () => {
    mockWa = makeFakeWa();
    mocks.callee.mockReturnValue('callee-123');
    mocks.incoming.mockReturnValue(null);
    // Some overlay is open, so resolveBackAction would otherwise return an
    // action — proving the hide comes from call-state gating, not lack of
    // anything to close.
    show('invite-modal');

    initTelegramChrome();

    expect(mockWa.BackButton.hide).toHaveBeenCalled();
    expect(mockWa.BackButton.show).not.toHaveBeenCalled();
    expect(mockWa.enableClosingConfirmation).toHaveBeenCalled();
    expect(mockWa.disableClosingConfirmation).not.toHaveBeenCalled();
  });

  test('no call, overlay open → BackButton shown and closing confirmation disabled', () => {
    mockWa = makeFakeWa();
    mocks.callee.mockReturnValue(null);
    mocks.incoming.mockReturnValue(null);
    show('invite-modal');

    initTelegramChrome();

    expect(mockWa.BackButton.show).toHaveBeenCalled();
    expect(mockWa.BackButton.hide).not.toHaveBeenCalled();
    expect(mockWa.disableClosingConfirmation).toHaveBeenCalled();
    expect(mockWa.enableClosingConfirmation).not.toHaveBeenCalled();
  });
});

describe('chrome color memoization (postEvent noise reduction)', () => {
  const makeFakeWa = () => ({
    isVersionAtLeast: () => true,
    ready: jest.fn(), expand: jest.fn(), disableVerticalSwipes: jest.fn(),
    setHeaderColor: jest.fn(), setBackgroundColor: jest.fn(),
    BackButton: { show: jest.fn(), hide: jest.fn(), onClick: jest.fn() },
    enableClosingConfirmation: jest.fn(), disableClosingConfirmation: jest.fn(),
  });

  afterEach(() => { document.documentElement.style.removeProperty('--bg'); });

  test('re-posts header/background color only when --bg actually changes', () => {
    mockWa = makeFakeWa();
    document.documentElement.style.setProperty('--bg', '#111111');
    initTelegramChrome(); // boot resets the memo and applies once
    expect(mockWa.setHeaderColor).toHaveBeenCalledTimes(1);
    expect(mockWa.setHeaderColor).toHaveBeenLastCalledWith('#111111');
    expect(mockWa.setBackgroundColor).toHaveBeenCalledTimes(1);

    syncChromeColor(); // identical --bg → no redundant postEvent pair
    expect(mockWa.setHeaderColor).toHaveBeenCalledTimes(1);
    expect(mockWa.setBackgroundColor).toHaveBeenCalledTimes(1);

    document.documentElement.style.setProperty('--bg', '#222222');
    syncChromeColor(); // changed → re-post exactly once
    expect(mockWa.setHeaderColor).toHaveBeenCalledTimes(2);
    expect(mockWa.setHeaderColor).toHaveBeenLastCalledWith('#222222');
    expect(mockWa.setBackgroundColor).toHaveBeenCalledTimes(2);
  });
});
