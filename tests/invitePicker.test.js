// tests/invitePicker.test.js
jest.mock('../js/db.js', () => ({
  writePendingInvite: jest.fn().mockResolvedValue(undefined),
  deletePendingInvite: jest.fn().mockResolvedValue(undefined),
}));

import { hasDisplayableInvitees } from '../js/invitePicker.js';

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
  test('renders labeled people first (by label), then follower-only rows (by code)', () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: { uMutA: 'codeA', uMutB: 'codeB', uFollC: 'codeC', uFollD: 'codeD' },
      following: [{ userId: 'uMutB', label: 'Bea' }, { userId: 'uMutA', label: 'Alex' }],
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
      following: [{ userId: 'uMut', label: '' }], // followed-back, never given a name
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
      following: [],
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
      following: [],
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
      following: [],
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
      following: [],
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
      following: [],
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
      following: [],
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
      following: [],
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
      following: [],
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

  test('rendering shows followees by their local label; follower-only rows by share code', () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: { uMut: 'mutCode', uFoll: 'follCode' },
      following: [{ userId: 'uMut', label: 'Bea' }],
      currentMemberUids: new Set(),
      pendingInviteeUids: new Set(),
    });
    const mutRow = document.querySelector('.invite-picker-row[data-uid="uMut"]');
    const follRow = document.querySelector('.invite-picker-row[data-uid="uFoll"]');
    expect(mutRow.querySelector('.invite-picker-name').textContent).toBe('Bea');
    expect(follRow.querySelector('.invite-picker-name').textContent).toBe('follCode');
  });
});

// A1 (social-model Wave A, #291): eligibility is key-based — everyone whose key
// you hold: (followers ∪ following) − members − self. People you follow who
// don't follow you back are invitable, shown by your private label for them.
describe('key-based eligibility (followers ∪ following)', () => {
  test('renders a followee who does not follow back', () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: {},
      following: [{ userId: 'uF', label: 'Fred', code: 'FREDCO' }],
      currentMemberUids: new Set(),
      pendingInviteeUids: new Set(),
    });
    const row = document.querySelector('.invite-picker-row[data-uid="uF"]');
    expect(row).not.toBeNull();
    expect(row.querySelector('.invite-picker-name').textContent).toBe('Fred');
  });

  test('a followee with no label falls back to their code', () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: {},
      following: [{ userId: 'uF', label: '', code: 'FREDCO' }],
      currentMemberUids: new Set(),
      pendingInviteeUids: new Set(),
    });
    const row = document.querySelector('.invite-picker-row[data-uid="uF"]');
    expect(row).not.toBeNull();
    expect(row.querySelector('.invite-picker-name').textContent).toBe('FREDCO');
  });

  test('labeled people (following) render before code-only rows (follower-only)', () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: { uZ: 'AAACODE' }, // sorts first alphabetically, but tier order wins
      following: [{ userId: 'uF', label: 'Zoe', code: 'ZOECODE' }],
      currentMemberUids: new Set(),
      pendingInviteeUids: new Set(),
    });
    const rows = document.querySelectorAll('.invite-picker-row');
    expect(rows.length).toBe(2);
    expect(rows[0].dataset.uid).toBe('uF');
    expect(rows[1].dataset.uid).toBe('uZ');
  });

  test('excludes followees who are already members, and self', () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: {},
      following: [
        { userId: 'uMember', label: 'In Already', code: 'CODE-M' },
        { userId: 'me', label: 'Myself', code: 'CODE-ME' },
      ],
      currentMemberUids: new Set(['uMember']),
      pendingInviteeUids: new Set(),
    });
    expect(document.querySelectorAll('.invite-picker-row').length).toBe(0);
  });

  test('a mutual (in both followers and following) renders once, by label', () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: { uMut: 'MUTCODE' },
      following: [{ userId: 'uMut', label: 'Bea', code: 'MUTCODE' }],
      currentMemberUids: new Set(),
      pendingInviteeUids: new Set(),
    });
    const rows = document.querySelectorAll('.invite-picker-row');
    expect(rows.length).toBe(1);
    expect(rows[0].dataset.uid).toBe('uMut');
    expect(rows[0].querySelector('.invite-picker-name').textContent).toBe('Bea');
  });

  test('hasDisplayableInvitees is true when the only candidate is a non-follower followee', () => {
    expect(hasDisplayableInvitees({
      inviterUid: 'me',
      followers: {},
      following: [{ userId: 'uF', label: 'Fred', code: 'FREDCO' }],
      currentMemberUids: new Set(),
    })).toBe(true);
  });

  test('hasDisplayableInvitees is false when every followee is a member or self', () => {
    expect(hasDisplayableInvitees({
      inviterUid: 'me',
      followers: {},
      following: [
        { userId: 'uMember', label: 'In Already', code: 'CODE-M' },
        { userId: 'me', label: 'Myself', code: 'CODE-ME' },
      ],
      currentMemberUids: new Set(['uMember']),
    })).toBe(false);
  });
});

describe('hasDisplayableInvitees', () => {
  const base = { inviterUid: 'me', currentMemberUids: new Set() };
  test('true when a non-member follower exists', () => {
    expect(hasDisplayableInvitees({ ...base, followers: { a: 'CODE-A' }, following: [] })).toBe(true);
  });
  test('true when a mutual (present in followers) exists', () => {
    expect(hasDisplayableInvitees({ ...base, followers: { a: 'CODE-A' }, following: [{ userId: 'a', label: 'Ana' }] })).toBe(true);
  });
  test('false when the only follower is already a member', () => {
    expect(hasDisplayableInvitees({ ...base, followers: { a: 'CODE-A' }, following: [], currentMemberUids: new Set(['a']) })).toBe(false);
  });
  test('false when the only follower is self', () => {
    expect(hasDisplayableInvitees({ ...base, followers: { me: 'CODE-ME' }, following: [] })).toBe(false);
  });
  test('false when followers is empty', () => {
    expect(hasDisplayableInvitees({ ...base, followers: {}, following: [] })).toBe(false);
  });
});
