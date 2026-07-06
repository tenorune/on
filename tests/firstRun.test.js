/** @jest-environment jsdom */
const mockTelegram = { isTelegramContext: jest.fn(() => false), telegramLinkState: jest.fn(() => null) };
jest.mock('../js/telegram.js', () => mockTelegram);

const FIXTURE = `
  <main id="main-list">
    <ul id="people-list"></ul>
    <div id="first-run-panel" class="first-run-panel hidden">
      <p class="first-run-lede">KnockKnock — for when you're around and open to company.</p>
      <p class="first-run-sub">No one's here yet.</p>
      <button id="first-run-invite-btn" class="primary-btn">Invite your people</button>
      <p id="first-run-link-line" class="hint hidden">Already use KnockKnock?
        <button id="first-run-link-btn" class="ghost-btn" type="button">Link your account</button></p>
    </div>
    <div id="add-person-area"><button id="add-person-btn" class="add-btn">Add a person</button></div>
  </main>
  <div id="code-drawer">
    <div class="drawer-section" id="drawer-section-invite">
      <p class="drawer-section-label" id="drawer-invite-label">Invite</p>
      <button id="drawer-invite-btn" class="primary-btn" type="button">Invite your people</button>
      <p class="hint" id="drawer-invite-hint">Or share this code so others can follow your status.</p>
    </div>
    <div class="drawer-section hidden" id="drawer-section-account"><div id="tg-account-slot"></div></div>
  </div>`;

let firstRun;
beforeEach(() => {
  jest.resetModules();
  document.body.innerHTML = FIXTURE;
  mockTelegram.isTelegramContext.mockReturnValue(false);
  mockTelegram.telegramLinkState.mockReturnValue(null);
  firstRun = require('../js/firstRun.js');
});

test('setListEmpty(true): panel shows, add button demotes to "Add by code"', () => {
  firstRun.setListEmpty(true);
  expect(document.getElementById('first-run-panel').classList.contains('hidden')).toBe(false);
  expect(document.getElementById('add-person-area').classList.contains('first-run-demoted')).toBe(true);
  expect(document.getElementById('add-person-btn').textContent).toBe('Add by code');
  expect(firstRun.isFirstRunActive()).toBe(true);
});

test('setListEmpty(false): panel hides, add button reverts', () => {
  firstRun.setListEmpty(true);
  firstRun.setListEmpty(false);
  expect(document.getElementById('first-run-panel').classList.contains('hidden')).toBe(true);
  expect(document.getElementById('add-person-area').classList.contains('first-run-demoted')).toBe(false);
  expect(document.getElementById('add-person-btn').textContent).toBe('Add a person');
  expect(firstRun.isFirstRunActive()).toBe(false);
});

test('guided empty state hides the drawer invite button (redundant with the on-screen CTA); restored when non-empty', () => {
  const btn = document.getElementById('drawer-invite-btn');
  expect(btn.classList.contains('hidden')).toBe(false); // visible by default
  firstRun.setListEmpty(true);
  expect(btn.classList.contains('hidden')).toBe(true);
  firstRun.setListEmpty(false);
  expect(btn.classList.contains('hidden')).toBe(false);
});

test('guided empty state: drops the "Invite" label and the "Or …" hint framing; both restored when non-empty', () => {
  const label = document.getElementById('drawer-invite-label');
  const hint = document.getElementById('drawer-invite-hint');
  firstRun.setListEmpty(false); // full drawer → label present, "Or share this code…"
  expect(label.classList.contains('hidden')).toBe(false);
  expect(hint.textContent).toBe('Or share this code so others can follow your status.');
  firstRun.setListEmpty(true);  // only the share code remains → no label, no "Or"
  expect(label.classList.contains('hidden')).toBe(true);
  expect(hint.textContent).toBe('Share this code so others can follow your status.');
  firstRun.setListEmpty(false); // restored
  expect(label.classList.contains('hidden')).toBe(false);
  expect(hint.textContent).toBe('Or share this code so others can follow your status.');
});

test('drawer invite button toggle applies on web too (not gated on Telegram)', () => {
  mockTelegram.isTelegramContext.mockReturnValue(false);
  firstRun.setListEmpty(true);
  expect(document.getElementById('drawer-invite-btn').classList.contains('hidden')).toBe(true);
});

test('Telegram: guided empty state hides the account section; restored when non-empty', () => {
  mockTelegram.isTelegramContext.mockReturnValue(true);
  const account = document.getElementById('drawer-section-account');
  firstRun.setListEmpty(false); // non-empty → account section present
  expect(account.classList.contains('hidden')).toBe(false);
  firstRun.setListEmpty(true);  // guided empty → hidden
  expect(account.classList.contains('hidden')).toBe(true);
});

test('web: the account section is never revealed by setListEmpty', () => {
  mockTelegram.isTelegramContext.mockReturnValue(false);
  const account = document.getElementById('drawer-section-account');
  firstRun.setListEmpty(false);
  expect(account.classList.contains('hidden')).toBe(true);
  firstRun.setListEmpty(true);
  expect(account.classList.contains('hidden')).toBe(true);
});

test('link line: only in TG when unlinked', () => {
  firstRun.setListEmpty(true);
  expect(document.getElementById('first-run-link-line').classList.contains('hidden')).toBe(true); // web
  mockTelegram.isTelegramContext.mockReturnValue(true);
  mockTelegram.telegramLinkState.mockReturnValue({ linked: false });
  firstRun.setListEmpty(true);
  expect(document.getElementById('first-run-link-line').classList.contains('hidden')).toBe(false);
  mockTelegram.telegramLinkState.mockReturnValue({ linked: true });
  firstRun.setListEmpty(true);
  expect(document.getElementById('first-run-link-line').classList.contains('hidden')).toBe(true);
});

test('every flip dispatches first-run-change', () => {
  const seen = jest.fn();
  document.addEventListener('first-run-change', seen);
  firstRun.setListEmpty(true);
  firstRun.setListEmpty(false);
  expect(seen).toHaveBeenCalledTimes(2);
});

test('initFirstRun wires the invite and link buttons', () => {
  const onInvite = jest.fn(); const onLink = jest.fn();
  firstRun.initFirstRun({ userId: 'u1', onInvite, onLink });
  document.getElementById('first-run-invite-btn').click();
  expect(onInvite).toHaveBeenCalled();
  document.getElementById('first-run-link-btn').click();
  expect(onLink).toHaveBeenCalled();
});

describe('landing notices', () => {
  // The link/unlink banners were removed (unwanted inline-toast style). The
  // mechanism survives only for the designed-but-unbuilt graduation landing.
  test('stampLanding + showLandingNotice renders once and clears the key', () => {
    firstRun.stampLanding('graduated');
    firstRun.showLandingNotice();
    const notice = document.getElementById('landing-notice');
    expect(notice.textContent).toContain('works in any browser');
    expect(sessionStorage.getItem('kk-landing')).toBeNull();
    firstRun.showLandingNotice(); // second boot: nothing
    expect(document.querySelectorAll('.landing-notice').length).toBe(1);
  });

  test('dismiss removes the banner', () => {
    firstRun.stampLanding('graduated');
    firstRun.showLandingNotice();
    document.getElementById('landing-notice-dismiss').click();
    expect(document.getElementById('landing-notice')).toBeNull();
  });

  test('link and unlink no longer render a landing banner', () => {
    firstRun.stampLanding('linked');
    firstRun.showLandingNotice();
    expect(document.getElementById('landing-notice')).toBeNull();
    firstRun.stampLanding('unlinked');
    firstRun.showLandingNotice();
    expect(document.getElementById('landing-notice')).toBeNull();
  });

  test('no key → no banner; unknown kind → no banner', () => {
    firstRun.showLandingNotice();
    expect(document.getElementById('landing-notice')).toBeNull();
    sessionStorage.setItem('kk-landing', 'bogus');
    firstRun.showLandingNotice();
    expect(document.getElementById('landing-notice')).toBeNull();
  });
});
