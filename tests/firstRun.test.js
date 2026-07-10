/** @jest-environment jsdom */
const mockTelegram = {
  isTelegramContext: jest.fn(() => false),
  isTelegramLinked: jest.fn(() => false),
};
jest.mock('../js/telegram.js', () => mockTelegram);

const FIXTURE = `
  <main id="main-list">
    <ul id="people-list"></ul>
    <div id="first-run-panel" class="first-run-panel hidden">
      <p class="first-run-lede">KnockKnock — for when you're around and open to company.</p>
      <p class="first-run-sub">No one's here yet.</p>
      <button id="first-run-invite-btn" class="primary-btn">Invite your people</button>
      <p id="first-run-link-line" class="hint hidden">Already use KnockKnock?
        <span class="first-run-link-row"><button id="first-run-link-btn" class="ghost-btn" type="button">I have a secret phrase</button><button id="first-run-graduate-help" class="help-badge" type="button">?</button></span></p>
    </div>
    <div id="add-person-area"><button id="add-person-btn" class="add-btn">Add a person</button></div>
  </main>
  <button id="mycode-chip" class="chip">Levers &amp; knobs</button>
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
  mockTelegram.isTelegramLinked.mockReturnValue(false);
  firstRun = require('../js/firstRun.js');
});

test('isFirstRunResolved: false until setListEmpty runs once, then true (either verdict)', () => {
  expect(firstRun.isFirstRunResolved()).toBe(false); // list hasn't rendered yet
  firstRun.setListEmpty(false);                       // first render, non-empty
  expect(firstRun.isFirstRunResolved()).toBe(true);
  expect(firstRun.isFirstRunActive()).toBe(false);
});

test('isFirstRunResolved: true after an empty first render too', () => {
  expect(firstRun.isFirstRunResolved()).toBe(false);
  firstRun.setListEmpty(true);
  expect(firstRun.isFirstRunResolved()).toBe(true);
  expect(firstRun.isFirstRunActive()).toBe(true);
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

test('same-state re-call is a no-op: no dispatch, no DOM re-sync (W3-A CL#1)', () => {
  firstRun.setListEmpty(true);
  const seen = jest.fn();
  document.addEventListener('first-run-change', seen);
  // Sentinel: a re-sync would overwrite this back to 'Add by code'.
  document.getElementById('add-person-btn').textContent = 'sentinel';
  firstRun.setListEmpty(true);
  expect(seen).not.toHaveBeenCalled();
  expect(document.getElementById('add-person-btn').textContent).toBe('sentinel');
  // A genuine transition still syncs + dispatches.
  firstRun.setListEmpty(false);
  expect(seen).toHaveBeenCalledTimes(1);
  expect(document.getElementById('add-person-btn').textContent).toBe('Add a person');
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
  mockTelegram.isTelegramLinked.mockReturnValue(true);
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
  firstRun.setListEmpty(false); // flip so the next call re-syncs (CL#1 guard)
  mockTelegram.isTelegramContext.mockReturnValue(true);
  mockTelegram.isTelegramLinked.mockReturnValue(false);
  firstRun.setListEmpty(true);
  expect(document.getElementById('first-run-link-line').classList.contains('hidden')).toBe(false);
  firstRun.setListEmpty(false); // flip again
  mockTelegram.isTelegramLinked.mockReturnValue(true);
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
    mockTelegram.isTelegramLinked.mockReturnValue(true);
    firstRun.setListEmpty(true);
    expect(chip()).toBe('Levers & knobs');
  });

  test('empty + Telegram-UNLINKED (code-only) → "Share code"', () => {
    mockTelegram.isTelegramContext.mockReturnValue(true);
    mockTelegram.isTelegramLinked.mockReturnValue(false);
    firstRun.setListEmpty(true);
    expect(chip()).toBe('Share code');
  });
});

describe('graduation notice', () => {
  // The bespoke landing-notice banner was dropped (spec §7 flag); graduation's
  // copy is surfaced through the shared boot toast. consumeGraduationNotice just
  // read-and-clears the marker and returns the copy for the caller to route.
  test('stampGraduationNotice + consumeGraduationNotice: copy once, then clears (W3-B CL#13)', () => {
    firstRun.stampGraduationNotice();
    expect(sessionStorage.getItem('kk-landing')).toBe('graduated'); // key/value unchanged across the rename
    expect(firstRun.consumeGraduationNotice()).toContain('works in any browser');
    expect(sessionStorage.getItem('kk-landing')).toBeNull();
    expect(firstRun.consumeGraduationNotice()).toBeNull(); // second boot: nothing
  });

  test('a foreign marker value consumes to null', () => {
    sessionStorage.setItem('kk-landing', 'bogus'); // unrecognized kind
    expect(firstRun.consumeGraduationNotice()).toBeNull();
    expect(sessionStorage.getItem('kk-landing')).toBeNull(); // still cleared
  });

  test('stampLinkedNotice → consume returns the Telegram copy (Task 7: Mini App onramp arrival)', () => {
    firstRun.stampLinkedNotice();
    expect(sessionStorage.getItem('kk-landing')).toBe('linked');
    expect(firstRun.consumeGraduationNotice()).toBe('This account now works in Telegram too.');
    expect(sessionStorage.getItem('kk-landing')).toBeNull();
    expect(firstRun.consumeGraduationNotice()).toBeNull();
  });
});
