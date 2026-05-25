// tests/inviteModal.test.js
jest.mock('../js/invites.js', () => ({
  createPersonalInvite: jest.fn(),
  regeneratePersonalInvite: jest.fn(),
  revokePersonalInvite: jest.fn(),
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
          <button id="invite-modal-cancel-btn"></button>
        </div>
        <div id="invite-modal-manage" class="hidden">
          <code id="invite-modal-url"></code>
          <button id="invite-modal-copy-btn"></button>
          <button id="invite-modal-regen-btn"></button>
          <button id="invite-modal-revoke-btn"></button>
          <button id="invite-modal-close-btn"></button>
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

  test('Close button hides the modal', () => {
    openInviteModal({ scope: 'personal', userId: 'uid1', activeInvite: { token: 'T', creatorLabel: 'Mike', url: 'https://x/?i=T' } });
    document.getElementById('invite-modal-close-btn').click();
    expect(document.getElementById('invite-modal').classList.contains('hidden')).toBe(true);
  });

  test('Cancel button (Create state) hides the modal without writing', () => {
    openInviteModal({ scope: 'personal', userId: 'uid1', activeInvite: null });
    document.getElementById('invite-modal-cancel-btn').click();
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
