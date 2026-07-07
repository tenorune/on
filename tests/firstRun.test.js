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
        <span class="first-run-link-row"><button id="first-run-link-btn" class="ghost-btn" type="button">Link your account</button><button id="first-run-graduate-help" class="help-badge" type="button">?</button></span></p>
    </div>
    <div id="add-person-area"><button id="add-person-btn" class="add-btn">Add a person</button></div>
  </main>
  <button id="mycode-chip" class="chip">Share code</button>
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

test('Telegram linked account: account section stays visible in the guided empty state (unlink still reachable)', () => {
  mockTelegram.isTelegramContext.mockReturnValue(true);
  mockTelegram.telegramLinkState.mockReturnValue({ linked: true });
  const account = document.getElementById('drawer-section-account');
  firstRun.setListEmpty(true);  // guided empty, but linked → keep the section
  expect(account.classList.contains('hidden')).toBe(false);
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

test('initFirstRun wires the invite, link, and graduation-help buttons', () => {
  const onInvite = jest.fn(); const onLink = jest.fn(); const onGraduateInfo = jest.fn();
  firstRun.initFirstRun({ userId: 'u1', onInvite, onLink, onGraduateInfo });
  document.getElementById('first-run-invite-btn').click();
  expect(onInvite).toHaveBeenCalled();
  document.getElementById('first-run-link-btn').click();
  expect(onLink).toHaveBeenCalled();
  document.getElementById('first-run-graduate-help').click();
  expect(onGraduateInfo).toHaveBeenCalled();
});

describe('#mycode-chip label', () => {
  const chip = () => document.getElementById('mycode-chip').textContent;

  test('guided empty state (code-only drawer) → "Share code"', () => {
    firstRun.setListEmpty(true);
    expect(chip()).toBe('Share code');
  });

  test('non-empty (grab-bag drawer) → "Levers & knobs"', () => {
    firstRun.setListEmpty(false);
    expect(chip()).toBe('Levers & knobs');
  });

  test('empty but Telegram-LINKED (account + notification sections stay) → "Levers & knobs"', () => {
    mockTelegram.isTelegramContext.mockReturnValue(true);
    mockTelegram.telegramLinkState.mockReturnValue({ linked: true });
    firstRun.setListEmpty(true);
    expect(chip()).toBe('Levers & knobs');
  });

  test('empty + Telegram-UNLINKED (code-only) → "Share code"', () => {
    mockTelegram.isTelegramContext.mockReturnValue(true);
    mockTelegram.telegramLinkState.mockReturnValue({ linked: false });
    firstRun.setListEmpty(true);
    expect(chip()).toBe('Share code');
  });
});

describe('landing notice', () => {
  // The bespoke landing-notice banner was dropped (spec §7 flag); graduation's
  // copy is surfaced through the shared boot toast. consumeLandingNotice just
  // read-and-clears the marker and returns the copy for the caller to route.
  test('stampLanding + consumeLandingNotice returns the copy once, then clears', () => {
    firstRun.stampLanding('graduated');
    expect(firstRun.consumeLandingNotice()).toContain('works in any browser');
    expect(sessionStorage.getItem('kk-landing')).toBeNull();
    expect(firstRun.consumeLandingNotice()).toBeNull(); // second boot: nothing
  });

  test('link and unlink no longer stamp a landing (only graduation does)', () => {
    firstRun.stampLanding('linked');
    expect(firstRun.consumeLandingNotice()).toBeNull();
    firstRun.stampLanding('unlinked');
    expect(firstRun.consumeLandingNotice()).toBeNull();
  });

  test('no key → null; unknown kind → null', () => {
    expect(firstRun.consumeLandingNotice()).toBeNull();
    sessionStorage.setItem('kk-landing', 'bogus');
    expect(firstRun.consumeLandingNotice()).toBeNull();
  });

  test('no bespoke landing-notice banner is rendered', () => {
    firstRun.stampLanding('graduated');
    firstRun.consumeLandingNotice();
    expect(document.getElementById('landing-notice')).toBeNull();
  });
});
