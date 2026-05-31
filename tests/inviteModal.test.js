// tests/inviteModal.test.js
jest.mock('../js/invites.js', () => ({
  createPersonalInvite: jest.fn(),
  regeneratePersonalInvite: jest.fn(),
  revokePersonalInvite: jest.fn(),
  createGroupInvite: jest.fn(),
  regenerateGroupInvite: jest.fn(),
  revokeGroupInvite: jest.fn(),
}));

const invites = require('../js/invites.js');
const { openInviteModal } = require('../js/inviteModal');

function setupDom() {
  document.body.innerHTML = `
    <div id="invite-modal" class="modal-overlay hidden">
      <div class="modal-card">
        <h2 id="invite-modal-title"></h2>
        <p id="invite-modal-subtitle"></p>
        <div id="invite-modal-create" class="hidden">
          <label id="invite-modal-label-hint"></label>
          <input id="invite-modal-label-input" type="text" maxlength="40" />
          <p id="invite-modal-label-error" class="error-msg hidden"></p>
          <button id="invite-modal-create-btn"></button>
        </div>
        <div id="invite-modal-manage" class="hidden">
          <code id="invite-modal-url"></code>
          <button id="invite-modal-copy-btn"></button>
          <button id="invite-modal-regen-btn"></button>
          <button id="invite-modal-revoke-btn"></button>
        </div>
      </div>
    </div>
  `;
}

describe('openInviteModal — personal scope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDom();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
  });

  test('renders State A (create) when no active invite is supplied', () => {
    openInviteModal({ scope: 'personal', userId: 'uid1', activeInvite: null });
    expect(document.getElementById('invite-modal').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('invite-modal-create').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('invite-modal-manage').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('invite-modal-title').textContent).toBe('Your invite link');
  });

  test('renders State B (manage) when an active invite is supplied', () => {
    openInviteModal({ scope: 'personal', userId: 'uid1', activeInvite: { token: 'TOKEN', creatorLabel: 'Mike', url: 'https://x/?i=TOKEN' } });
    expect(document.getElementById('invite-modal-manage').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('invite-modal-create').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('invite-modal-url').textContent).toBe('https://x/?i=TOKEN');
  });

  test('Create button validates label and calls createPersonalInvite', async () => {
    invites.createPersonalInvite.mockResolvedValue({ token: 'NEW', url: 'https://x/?i=NEW', existing: false });
    openInviteModal({ scope: 'personal', userId: 'uid1', activeInvite: null });

    document.getElementById('invite-modal-label-input').value = '   '; // empty after trim
    document.getElementById('invite-modal-create-btn').click();
    await Promise.resolve();
    expect(document.getElementById('invite-modal-label-error').classList.contains('hidden')).toBe(false);
    expect(invites.createPersonalInvite).not.toHaveBeenCalled();

    document.getElementById('invite-modal-label-input').value = 'Mike P.';
    document.getElementById('invite-modal-create-btn').click();
    await new Promise(setImmediate);
    expect(invites.createPersonalInvite).toHaveBeenCalledWith('uid1', 'Mike P.');
    expect(document.getElementById('invite-modal-url').textContent).toBe('https://x/?i=NEW');
    expect(document.getElementById('invite-modal-manage').classList.contains('hidden')).toBe(false);
  });

  test('Copy button writes the URL to the clipboard and flips text to Copied!', async () => {
    jest.useFakeTimers();
    openInviteModal({ scope: 'personal', userId: 'uid1', activeInvite: { token: 'T', creatorLabel: 'Mike', url: 'https://x/?i=T' } });
    const btn = document.getElementById('invite-modal-copy-btn');
    btn.textContent = 'Copy';
    btn.click();
    await Promise.resolve(); await Promise.resolve();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://x/?i=T');
    expect(btn.textContent).toBe('Copied!');
    jest.advanceTimersByTime(1500);
    expect(btn.textContent).toBe('Copy');
    jest.useRealTimers();
  });

  test('Regenerate calls regeneratePersonalInvite and refreshes the URL', async () => {
    invites.regeneratePersonalInvite.mockResolvedValue({ token: 'NEW2', url: 'https://x/?i=NEW2', existing: false });
    openInviteModal({ scope: 'personal', userId: 'uid1', activeInvite: { token: 'T', creatorLabel: 'Mike', url: 'https://x/?i=T' } });
    document.getElementById('invite-modal-regen-btn').click();
    await new Promise(setImmediate);
    expect(invites.regeneratePersonalInvite).toHaveBeenCalledWith('uid1', 'Mike');
    expect(document.getElementById('invite-modal-url').textContent).toBe('https://x/?i=NEW2');
  });

  test('Revoke calls revokePersonalInvite and transitions to Create state', async () => {
    invites.revokePersonalInvite.mockResolvedValue();
    openInviteModal({ scope: 'personal', userId: 'uid1', activeInvite: { token: 'T', creatorLabel: 'Mike', url: 'https://x/?i=T' } });
    document.getElementById('invite-modal-revoke-btn').click();
    await new Promise(setImmediate);
    expect(invites.revokePersonalInvite).toHaveBeenCalledWith('uid1');
    expect(document.getElementById('invite-modal-create').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('invite-modal-manage').classList.contains('hidden')).toBe(true);
  });

  test('overlay tap (Manage state) hides the modal', () => {
    openInviteModal({ scope: 'personal', userId: 'uid1', activeInvite: { token: 'T', creatorLabel: 'Mike', url: 'https://x/?i=T' } });
    document.getElementById('invite-modal').click();
    expect(document.getElementById('invite-modal').classList.contains('hidden')).toBe(true);
  });

  test('overlay tap (Create state) hides the modal without writing', () => {
    openInviteModal({ scope: 'personal', userId: 'uid1', activeInvite: null });
    document.getElementById('invite-modal').click();
    expect(document.getElementById('invite-modal').classList.contains('hidden')).toBe(true);
    expect(invites.createPersonalInvite).not.toHaveBeenCalled();
  });

  test('applies SCOPE_COPY.labelHint to the label element', () => {
    openInviteModal({ scope: 'personal', userId: 'uid1', activeInvite: null });
    expect(document.getElementById('invite-modal-label-hint').textContent).toBe('Your name on the invite');
  });

  test('Regenerate surfaces an error when the underlying call rejects', async () => {
    invites.regeneratePersonalInvite.mockRejectedValue(new Error('network down'));
    openInviteModal({ scope: 'personal', userId: 'uid1', activeInvite: { token: 'T', creatorLabel: 'Mike', url: 'https://x/?i=T' } });
    document.getElementById('invite-modal-regen-btn').click();
    await new Promise(setImmediate);
    expect(document.getElementById('invite-modal-label-error').textContent).toBe('network down');
    expect(document.getElementById('invite-modal-label-error').classList.contains('hidden')).toBe(false);
  });

  test('Revoke surfaces an error when the underlying call rejects', async () => {
    invites.revokePersonalInvite.mockRejectedValue(new Error('boom'));
    openInviteModal({ scope: 'personal', userId: 'uid1', activeInvite: { token: 'T', creatorLabel: 'Mike', url: 'https://x/?i=T' } });
    document.getElementById('invite-modal-revoke-btn').click();
    await new Promise(setImmediate);
    expect(document.getElementById('invite-modal-label-error').textContent).toBe('boom');
  });
});

describe('openInviteModal — group scope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDom();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
  });

  test('throws when groupId or groupName is missing', () => {
    expect(() => openInviteModal({ scope: 'group', userId: 'uid1' })).toThrow(/groupId.*groupName/);
  });

  test('renders title and subtitle with the group name interpolated', () => {
    openInviteModal({ scope: 'group', userId: 'uid1', groupId: 'G1', groupName: 'Family' });
    expect(document.getElementById('invite-modal-title').textContent).toBe('Invite link for Family');
    expect(document.getElementById('invite-modal-subtitle').textContent).toContain('Family');
  });

  test('hides the label input for group scope', () => {
    openInviteModal({ scope: 'group', userId: 'uid1', groupId: 'G1', groupName: 'Family' });
    expect(document.getElementById('invite-modal-label-input').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('invite-modal-label-hint').classList.contains('hidden')).toBe(true);
  });

  test('Create button calls createGroupInvite(userId, groupId)', async () => {
    invites.createGroupInvite.mockResolvedValue({ token: 'NEW', url: 'https://x/?i=NEW', existing: false });
    openInviteModal({ scope: 'group', userId: 'uid1', groupId: 'G1', groupName: 'Family' });
    document.getElementById('invite-modal-create-btn').click();
    await new Promise(setImmediate);
    expect(invites.createGroupInvite).toHaveBeenCalledWith('uid1', 'G1');
    expect(document.getElementById('invite-modal-url').textContent).toBe('https://x/?i=NEW');
  });

  test('Regenerate calls regenerateGroupInvite(userId, groupId)', async () => {
    invites.regenerateGroupInvite.mockResolvedValue({ token: 'NEW2', url: 'https://x/?i=NEW2', existing: false });
    openInviteModal({
      scope: 'group', userId: 'uid1', groupId: 'G1', groupName: 'Family',
      activeInvite: { token: 'T', url: 'https://x/?i=T', scope: 'group' },
    });
    document.getElementById('invite-modal-regen-btn').click();
    await new Promise(setImmediate);
    expect(invites.regenerateGroupInvite).toHaveBeenCalledWith('uid1', 'G1');
  });

  test('Revoke calls revokeGroupInvite(userId, groupId)', async () => {
    invites.revokeGroupInvite.mockResolvedValue();
    openInviteModal({
      scope: 'group', userId: 'uid1', groupId: 'G1', groupName: 'Family',
      activeInvite: { token: 'T', url: 'https://x/?i=T', scope: 'group' },
    });
    document.getElementById('invite-modal-revoke-btn').click();
    await new Promise(setImmediate);
    expect(invites.revokeGroupInvite).toHaveBeenCalledWith('uid1', 'G1');
  });
});

describe('openInviteModal — overlay dismiss', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
  });

  test('clicking the modal overlay (outside the card) dismisses the modal', () => {
    document.body.innerHTML = `
      <div id="invite-modal" class="modal-overlay hidden">
        <div class="modal-card">
          <h2 id="invite-modal-title"></h2>
          <p id="invite-modal-subtitle"></p>
          <p id="invite-modal-label-error" class="hidden"></p>
          <label id="invite-modal-label-hint"></label>
          <input id="invite-modal-label-input" type="text" />
          <div id="invite-modal-create">
            <button id="invite-modal-create-btn"></button>
          </div>
          <div id="invite-modal-manage">
            <code id="invite-modal-url"></code>
            <button id="invite-modal-copy-btn"></button>
            <button id="invite-modal-regen-btn"></button>
            <button id="invite-modal-revoke-btn"></button>
          </div>
        </div>
      </div>
    `;
    openInviteModal({ scope: 'personal', userId: 'u1' });
    expect(document.getElementById('invite-modal').classList.contains('hidden')).toBe(false);
    // Click the overlay (the modal-overlay element itself, not the card)
    document.getElementById('invite-modal').click();
    expect(document.getElementById('invite-modal').classList.contains('hidden')).toBe(true);
  });

  test('clicking inside the modal card does NOT dismiss', () => {
    document.body.innerHTML = `
      <div id="invite-modal" class="modal-overlay hidden">
        <div class="modal-card" id="card">
          <h2 id="invite-modal-title"></h2>
          <p id="invite-modal-subtitle"></p>
          <p id="invite-modal-label-error" class="hidden"></p>
          <label id="invite-modal-label-hint"></label>
          <input id="invite-modal-label-input" type="text" />
          <div id="invite-modal-create">
            <button id="invite-modal-create-btn"></button>
          </div>
          <div id="invite-modal-manage">
            <code id="invite-modal-url"></code>
            <button id="invite-modal-copy-btn"></button>
            <button id="invite-modal-regen-btn"></button>
            <button id="invite-modal-revoke-btn"></button>
          </div>
        </div>
      </div>
    `;
    openInviteModal({ scope: 'personal', userId: 'u1' });
    document.getElementById('card').click();
    expect(document.getElementById('invite-modal').classList.contains('hidden')).toBe(false);
  });
});
