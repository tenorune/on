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
jest.mock('../js/telegram.js', () => ({ tgWebApp: jest.fn(() => null), isTelegramContext: jest.fn(() => true) }));

const { resolveBackAction } = require('../js/telegramChrome.js');

const SHELL = `
  <div id="restore-screen" class="hidden"><button id="restore-cancel-btn"></button></div>
  <div id="tg-invite-screen" class="hidden"></div>
  <div id="recovery-modal" class="hidden"></div>
  <div id="invite-modal" class="hidden"></div>
  <div id="create-group-modal" class="hidden"><button id="create-group-cancel-btn"></button></div>
  <div id="inbox-modal" class="hidden"></div>
  <div id="invite-failure-overlay" class="hidden"><button id="invite-failure-continue"></button></div>
  <div id="code-drawer"><button id="mycode-chip"></button></div>
  <div id="add-person-form"><button id="add-cancel-btn"></button></div>`;

beforeEach(() => { document.body.innerHTML = SHELL; jest.clearAllMocks();
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
