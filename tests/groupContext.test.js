// tests/groupContext.test.js
jest.mock('../js/db.js', () => ({
  readGroup: jest.fn().mockResolvedValue(null),
  watchGroupMeta: jest.fn(() => () => {}),
  watchGroupMembers: jest.fn(() => () => {}),
  watchStatus: jest.fn(() => () => {}),
}));
jest.mock('../js/groupNav.js', () => ({
  navigateToDirect: jest.fn().mockResolvedValue(undefined),
  getCurrentContext: jest.fn(() => ({ context: 'group', groupId: 'G1' })),
}));

const db = require('../js/db.js');
const groupNav = require('../js/groupNav.js');
const { enterGroupContext, exitGroupContext } = require('../js/groupContext');

function setupContextDom() {
  document.body.innerHTML = `
    <div id="main-ui-direct"></div>
    <div id="group-context-root" class="group-context-root hidden">
      <div class="group-breadcrumb">
        <button id="group-breadcrumb-back">←</button>
        <span id="group-breadcrumb-name"></span>
      </div>
      <header class="group-context-header">
        <h2 id="group-context-name"></h2>
        <button id="group-context-settings-btn" class="hidden">Settings</button>
      </header>
      <ul id="group-roster"></ul>
    </div>
  `;
}

describe('groupContext scaffolding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupContextDom();
  });

  test('enterGroupContext reveals the root and hides direct UI', () => {
    enterGroupContext('G1', 'me');
    expect(document.getElementById('group-context-root').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('main-ui-direct').classList.contains('hidden')).toBe(true);
  });

  test('enterGroupContext renders the breadcrumb name and header name on watchGroupMeta tick', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'owner', createdAt: 1 });
    expect(document.getElementById('group-breadcrumb-name').textContent).toBe('Family');
    expect(document.getElementById('group-context-name').textContent).toBe('Family');
  });

  test('shows the Settings button when the caller is the owner', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    expect(document.getElementById('group-context-settings-btn').classList.contains('hidden')).toBe(false);
  });

  test('keeps Settings hidden when the caller is not the owner', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'someoneElse', createdAt: 1 });
    expect(document.getElementById('group-context-settings-btn').classList.contains('hidden')).toBe(true);
  });

  test('breadcrumb back button calls navigateToDirect', () => {
    enterGroupContext('G1', 'me');
    document.getElementById('group-breadcrumb-back').click();
    expect(groupNav.navigateToDirect).toHaveBeenCalled();
  });

  test('exitGroupContext hides the root and shows direct', () => {
    enterGroupContext('G1', 'me');
    exitGroupContext();
    expect(document.getElementById('group-context-root').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('main-ui-direct').classList.contains('hidden')).toBe(false);
  });
});
