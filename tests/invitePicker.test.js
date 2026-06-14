// tests/invitePicker.test.js
jest.mock('../js/db.js', () => ({
  writePendingInvite: jest.fn().mockResolvedValue(undefined),
  deletePendingInvite: jest.fn().mockResolvedValue(undefined),
}));

const db = require('../js/db.js');
const { renderInvitePicker } = require('../js/invitePicker.js');

function makeContainer() {
  document.body.innerHTML = `
    <div>
      <button id="invite-modal-picker-send-btn"></button>
      <ul id="invite-modal-picker-list"></ul>
    </div>
  `;
}

beforeEach(() => {
  jest.clearAllMocks();
  makeContainer();
});

describe('renderInvitePicker', () => {
  test('renders mutuals first (by label), then non-mutual followers (by code)', () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: { uMutA: 'codeA', uMutB: 'codeB', uFollC: 'codeC', uFollD: 'codeD' },
      mutuals: [{ userId: 'uMutB', label: 'Bea' }, { userId: 'uMutA', label: 'Alex' }],
      currentMemberUids: new Set(['someoneElse']),
      pendingInviteeUids: new Set(),
    });
    const rows = document.querySelectorAll('#invite-modal-picker-list .invite-picker-row');
    expect(rows.length).toBe(4);
    // Mutuals first, sorted by label: Alex, Bea
    expect(rows[0].dataset.uid).toBe('uMutA');
    expect(rows[1].dataset.uid).toBe('uMutB');
    // Non-mutual followers next, sorted by code: codeC, codeD
    expect(rows[2].dataset.uid).toBe('uFollC');
    expect(rows[3].dataset.uid).toBe('uFollD');
  });

  test('a mutual with no custom label shows their share code, not a blank name', () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: { uMut: 'MUTCODE' },
      mutuals: [{ userId: 'uMut', label: '' }], // followed-back, never given a name
      currentMemberUids: new Set(),
      pendingInviteeUids: new Set(),
    });
    const row = document.querySelector('.invite-picker-row[data-uid="uMut"]');
    expect(row).not.toBeNull();
    expect(row.querySelector('.invite-picker-name').textContent).toBe('MUTCODE');
  });

  test('excludes followers who are already group members', () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: { uA: 'codeA', uB: 'codeB' },
      mutuals: [],
      currentMemberUids: new Set(['uB']),
      pendingInviteeUids: new Set(),
    });
    const rows = document.querySelectorAll('.invite-picker-row');
    expect(rows.length).toBe(1);
    expect(rows[0].dataset.uid).toBe('uA');
  });

  test('rows with a pending invite show an Invited pill instead of selection indicator', () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: { uA: 'codeA', uB: 'codeB' },
      mutuals: [],
      currentMemberUids: new Set(),
      pendingInviteeUids: new Set(['uA']),
    });
    const rowA = document.querySelector('.invite-picker-row[data-uid="uA"]');
    const rowB = document.querySelector('.invite-picker-row[data-uid="uB"]');
    expect(rowA.querySelector('.invite-picker-pill-invited')).not.toBeNull();
    expect(rowB.querySelector('.invite-picker-pill-invited')).toBeNull();
  });

  test('tapping an unselected row toggles selection', () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: { uA: 'codeA' },
      mutuals: [],
      currentMemberUids: new Set(),
      pendingInviteeUids: new Set(),
    });
    const row = document.querySelector('.invite-picker-row[data-uid="uA"]');
    row.click();
    expect(row.classList.contains('selected')).toBe(true);
    row.click();
    expect(row.classList.contains('selected')).toBe(false);
  });

  test('Invite button is disabled until a row is selected, and re-disables when none remain', () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: { uA: 'codeA' },
      mutuals: [],
      currentMemberUids: new Set(),
      pendingInviteeUids: new Set(),
    });
    const sendBtn = () => document.getElementById('invite-modal-picker-send-btn');
    expect(sendBtn().disabled).toBe(true); // nothing selected on first render
    const row = document.querySelector('.invite-picker-row[data-uid="uA"]');
    row.click();
    expect(sendBtn().disabled).toBe(false); // one selected
    row.click();
    expect(sendBtn().disabled).toBe(true); // deselected → disabled again
  });

  test('Invite button re-disables after a successful send clears the selection', async () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: { uA: 'codeA' },
      mutuals: [],
      currentMemberUids: new Set(),
      pendingInviteeUids: new Set(),
    });
    document.querySelector('.invite-picker-row[data-uid="uA"]').click();
    expect(document.getElementById('invite-modal-picker-send-btn').disabled).toBe(false);
    document.getElementById('invite-modal-picker-send-btn').click();
    await Promise.resolve(); await Promise.resolve();
    expect(document.getElementById('invite-modal-picker-send-btn').disabled).toBe(true);
  });

  test('Invite button writes pending invites for each selected row', async () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: { uA: 'codeA', uB: 'codeB' },
      mutuals: [],
      currentMemberUids: new Set(),
      pendingInviteeUids: new Set(),
    });
    document.querySelector('.invite-picker-row[data-uid="uA"]').click();
    document.querySelector('.invite-picker-row[data-uid="uB"]').click();
    document.getElementById('invite-modal-picker-send-btn').click();
    // Let pending microtasks resolve
    await Promise.resolve();
    await Promise.resolve();
    expect(db.writePendingInvite).toHaveBeenCalledWith('me', 'uA', 'G1');
    expect(db.writePendingInvite).toHaveBeenCalledWith('me', 'uB', 'G1');
  });

  test('after Invite sends, the affected rows flip to Invited state and selection clears', async () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: { uA: 'codeA' },
      mutuals: [],
      currentMemberUids: new Set(),
      pendingInviteeUids: new Set(),
    });
    const row = document.querySelector('.invite-picker-row[data-uid="uA"]');
    row.click();
    document.getElementById('invite-modal-picker-send-btn').click();
    await Promise.resolve();
    await Promise.resolve();
    expect(row.classList.contains('selected')).toBe(false);
    expect(row.querySelector('.invite-picker-pill-invited')).not.toBeNull();
  });

  test('tapping an Invited pill deletes the pending invite and re-renders the row as selectable', async () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: { uA: 'codeA' },
      mutuals: [],
      currentMemberUids: new Set(),
      pendingInviteeUids: new Set(['uA']),
    });
    const pill = document.querySelector('.invite-picker-row[data-uid="uA"] .invite-picker-pill-invited');
    pill.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(db.deletePendingInvite).toHaveBeenCalledWith('uA', 'G1');
    const row = document.querySelector('.invite-picker-row[data-uid="uA"]');
    expect(row.querySelector('.invite-picker-pill-invited')).toBeNull();
  });

  test('rendering shows mutuals by their local label; non-mutual followers by share code', () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: { uMut: 'mutCode', uFoll: 'follCode' },
      mutuals: [{ userId: 'uMut', label: 'Bea' }],
      currentMemberUids: new Set(),
      pendingInviteeUids: new Set(),
    });
    const mutRow = document.querySelector('.invite-picker-row[data-uid="uMut"]');
    const follRow = document.querySelector('.invite-picker-row[data-uid="uFoll"]');
    expect(mutRow.querySelector('.invite-picker-name').textContent).toBe('Bea');
    expect(follRow.querySelector('.invite-picker-name').textContent).toBe('follCode');
  });
});
