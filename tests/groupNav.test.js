// tests/groupNav.test.js
jest.mock('../js/db.js', () => ({
  setCurrentContext: jest.fn().mockResolvedValue(undefined),
  setLastVisited: jest.fn().mockResolvedValue(undefined),
  watchUserGroups: jest.fn(),
  watchGroupMeta: jest.fn(),
  readMembers: jest.fn().mockResolvedValue({}),
}));
jest.mock('../js/features.js', () => ({ GROUPS_ENABLED: true }));
jest.mock('../js/groups.js', () => ({
  createGroup: jest.fn(),
}));

const db = require('../js/db.js');
const groups = require('../js/groups.js');
const {
  initNav, getCurrentContext, navigateToDirect, navigateToGroup,
  onContextChange, applyServerCurrentContext,
} = require('../js/groupNav');

describe('groupNav state machine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    initNav('uid1');
  });

  test('initNav defaults to direct context', () => {
    expect(getCurrentContext()).toEqual({ context: 'direct', groupId: null });
  });

  test('navigateToGroup writes currentContext + lastVisited and emits change', async () => {
    const seen = [];
    onContextChange((ctx) => seen.push(ctx));
    await navigateToGroup('G1');
    expect(getCurrentContext()).toEqual({ context: 'group', groupId: 'G1' });
    expect(db.setCurrentContext).toHaveBeenCalledWith('uid1', 'group:G1');
    expect(db.setLastVisited).toHaveBeenCalledWith('uid1', 'G1', expect.any(Number));
    expect(seen[seen.length - 1]).toEqual({ context: 'group', groupId: 'G1' });
  });

  test('navigateToDirect writes direct + emits change', async () => {
    await navigateToGroup('G1');
    const seen = [];
    onContextChange((ctx) => seen.push(ctx));
    await navigateToDirect();
    expect(getCurrentContext()).toEqual({ context: 'direct', groupId: null });
    expect(db.setCurrentContext).toHaveBeenCalledWith('uid1', 'direct');
    expect(seen[seen.length - 1]).toEqual({ context: 'direct', groupId: null });
  });

  test('navigation is idempotent: same context twice does not double-write', async () => {
    await navigateToGroup('G1');
    db.setCurrentContext.mockClear();
    await navigateToGroup('G1');
    expect(db.setCurrentContext).not.toHaveBeenCalled();
  });

  test('applyServerCurrentContext updates local state without round-tripping to Firebase', () => {
    const seen = [];
    onContextChange((ctx) => seen.push(ctx));
    applyServerCurrentContext('group:G2');
    expect(getCurrentContext()).toEqual({ context: 'group', groupId: 'G2' });
    expect(db.setCurrentContext).not.toHaveBeenCalled();
    expect(seen[seen.length - 1]).toEqual({ context: 'group', groupId: 'G2' });
  });

  test('applyServerCurrentContext for direct works', () => {
    applyServerCurrentContext('group:G2');
    applyServerCurrentContext('direct');
    expect(getCurrentContext()).toEqual({ context: 'direct', groupId: null });
  });

  test('applyServerCurrentContext no-ops when already in the same context', () => {
    const seen = [];
    onContextChange((ctx) => seen.push(ctx));
    applyServerCurrentContext('direct');
    expect(seen.length).toBe(0);
  });

  test('falls back to direct when server provides a malformed value', () => {
    applyServerCurrentContext('garbage');
    expect(getCurrentContext()).toEqual({ context: 'direct', groupId: null });
  });
});

const { initCardsRow, renderCardsRow, onCreateRequested, openCreateGroupModal } = require('../js/groupNav');

function setupCardsDom() {
  document.body.innerHTML = `
    <div id="group-cards-row" class="group-cards-row hidden"></div>
  `;
}

describe('group cards row render', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupCardsDom();
    initNav('uid1');
  });

  test('zero-state: empty groups → CTA visible, row visible', () => {
    renderCardsRow({}, {});
    const row = document.getElementById('group-cards-row');
    expect(row.classList.contains('hidden')).toBe(false);
    expect(row.querySelector('.group-cards-zero')).not.toBeNull();
    expect(row.querySelector('.group-cards-zero').textContent).toMatch(/Create your first group/);
  });

  test('renders one card per enumerated group, sorted by lastVisited desc', () => {
    const enumeration = {
      G1: { lastVisited: 100 },
      G2: { lastVisited: 300 },
      G3: { lastVisited: 200 },
    };
    const metaByGroupId = {
      G1: { name: 'Alpha' },
      G2: { name: 'Bravo' },
      G3: { name: 'Charlie' },
    };
    renderCardsRow(enumeration, metaByGroupId);
    const cards = document.querySelectorAll('.group-card');
    expect(cards.length).toBe(3);
    expect(cards[0].textContent).toContain('Bravo');
    expect(cards[1].textContent).toContain('Charlie');
    expect(cards[2].textContent).toContain('Alpha');
  });

  test('renders the trailing + button after group cards', () => {
    renderCardsRow({ G1: { lastVisited: 1 } }, { G1: { name: 'Family' } });
    expect(document.getElementById('group-cards-plus')).not.toBeNull();
  });

  test('clicking a card calls navigateToGroup', async () => {
    renderCardsRow({ G1: { lastVisited: 1 } }, { G1: { name: 'Family' } });
    const card = document.querySelector('.group-card');
    card.click();
    await new Promise(setImmediate);
    expect(db.setCurrentContext).toHaveBeenCalledWith('uid1', 'group:G1');
  });

  test('marks the current group card as active', () => {
    applyServerCurrentContext('group:G1');
    renderCardsRow({ G1: { lastVisited: 1 } }, { G1: { name: 'Family' } });
    expect(document.querySelector('.group-card').classList.contains('active')).toBe(true);
  });

  test('+ button emits create-requested', () => {
    renderCardsRow({ G1: { lastVisited: 1 } }, { G1: { name: 'Family' } });
    const seen = [];
    onCreateRequested(() => seen.push(true));
    document.getElementById('group-cards-plus').click();
    expect(seen).toEqual([true]);
  });

  test('zero-state CTA emits create-requested', () => {
    renderCardsRow({}, {});
    const seen = [];
    onCreateRequested(() => seen.push(true));
    document.getElementById('group-cards-zero').click();
    expect(seen).toEqual([true]);
  });
});

function setupCreateModalDom() {
  document.body.innerHTML += `
    <div id="create-group-modal" class="modal-overlay hidden">
      <div class="modal-card">
        <input id="create-group-name-input" type="text" maxlength="40" />
        <input id="create-group-displayname-input" type="text" maxlength="40" />
        <p id="create-group-error" class="error-msg hidden"></p>
        <button id="create-group-submit-btn"></button>
        <button id="create-group-cancel-btn"></button>
      </div>
    </div>
  `;
}

describe('create-group modal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupCardsDom();
    setupCreateModalDom();
    initNav('uid1');
  });

  test('openCreateGroupModal reveals the overlay and clears inputs', () => {
    document.getElementById('create-group-name-input').value = 'stale';
    document.getElementById('create-group-displayname-input').value = 'stale';
    openCreateGroupModal();
    expect(document.getElementById('create-group-modal').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('create-group-name-input').value).toBe('');
    expect(document.getElementById('create-group-displayname-input').value).toBe('');
  });

  test('Cancel closes without writing', () => {
    openCreateGroupModal();
    document.getElementById('create-group-cancel-btn').click();
    expect(document.getElementById('create-group-modal').classList.contains('hidden')).toBe(true);
    expect(groups.createGroup).not.toHaveBeenCalled();
  });

  test('Submit validates: empty name shows error', async () => {
    openCreateGroupModal();
    document.getElementById('create-group-name-input').value = '   ';
    document.getElementById('create-group-displayname-input').value = 'Mike';
    document.getElementById('create-group-submit-btn').click();
    await new Promise(setImmediate);
    expect(document.getElementById('create-group-error').classList.contains('hidden')).toBe(false);
    expect(groups.createGroup).not.toHaveBeenCalled();
  });

  test('Submit happy path: calls createGroup, closes modal, navigates to new group', async () => {
    groups.createGroup.mockResolvedValue({ groupId: 'G1ABCDEF', name: 'Family' });
    openCreateGroupModal();
    document.getElementById('create-group-name-input').value = 'Family';
    document.getElementById('create-group-displayname-input').value = 'Mike';
    document.getElementById('create-group-submit-btn').click();
    await new Promise(setImmediate);
    expect(groups.createGroup).toHaveBeenCalledWith('uid1', 'Family', 'Mike');
    expect(document.getElementById('create-group-modal').classList.contains('hidden')).toBe(true);
    expect(db.setCurrentContext).toHaveBeenCalledWith('uid1', 'group:G1ABCDEF');
  });

  test('Submit failure: surfaces error from createGroup, stays open', async () => {
    groups.createGroup.mockRejectedValue(new Error('boom'));
    openCreateGroupModal();
    document.getElementById('create-group-name-input').value = 'Family';
    document.getElementById('create-group-displayname-input').value = 'Mike';
    document.getElementById('create-group-submit-btn').click();
    await new Promise(setImmediate);
    expect(document.getElementById('create-group-error').textContent).toBe('boom');
    expect(document.getElementById('create-group-modal').classList.contains('hidden')).toBe(false);
  });
});
