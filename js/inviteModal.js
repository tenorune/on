// js/inviteModal.js
// Shared invite-link modal component. Parameterized by scope.
// Phase 0 wires only scope='personal'. Phase 1 will wire scope='group'.

import { createPersonalInvite, regeneratePersonalInvite, revokePersonalInvite } from './invites.js';

const SCOPE_COPY = {
  personal: {
    title: 'Your invite link',
    subtitle: 'People who tap this link will follow you.',
    labelHint: 'Your name on the invite',
    labelPlaceholder: 'e.g. Mike P.',
  },
  // group scope copy added in Phase 1
};

let cleanupFns = [];

function clearListeners() {
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
}

function on(el, evt, handler) {
  el.addEventListener(evt, handler);
  cleanupFns.push(() => el.removeEventListener(evt, handler));
}

function showState(stateName) {
  document.getElementById('invite-modal-create').classList.toggle('hidden', stateName !== 'create');
  document.getElementById('invite-modal-manage').classList.toggle('hidden', stateName !== 'manage');
}

function renderManageUrl(url) {
  document.getElementById('invite-modal-url').textContent = url;
}

function hideError() {
  const errEl = document.getElementById('invite-modal-label-error');
  errEl.classList.add('hidden');
  errEl.textContent = '';
}

function showError(msg) {
  const errEl = document.getElementById('invite-modal-label-error');
  errEl.classList.remove('hidden');
  errEl.textContent = msg;
}

function closeModal() {
  document.getElementById('invite-modal').classList.add('hidden');
  clearListeners();
}

export function openInviteModal({ scope, userId, activeInvite = null }) {
  const copy = SCOPE_COPY[scope];
  if (!copy) throw new Error(`Unknown scope: ${scope}`);

  document.getElementById('invite-modal-title').textContent = copy.title;
  document.getElementById('invite-modal-subtitle').textContent = copy.subtitle;
  document.getElementById('invite-modal-label-input').placeholder = copy.labelPlaceholder;

  hideError();
  clearListeners();
  document.getElementById('invite-modal').classList.remove('hidden');

  let currentInvite = activeInvite ? { ...activeInvite } : null;

  if (currentInvite) {
    showState('manage');
    renderManageUrl(currentInvite.url);
  } else {
    showState('create');
    document.getElementById('invite-modal-label-input').value = '';
  }

  // Create
  on(document.getElementById('invite-modal-create-btn'), 'click', async () => {
    const raw = document.getElementById('invite-modal-label-input').value;
    const trimmed = (raw || '').trim();
    if (!trimmed) { showError('Please enter a name.'); return; }
    if (trimmed.length > 40) { showError('Name must be at most 40 characters.'); return; }
    hideError();
    try {
      const result = await createPersonalInvite(userId, trimmed);
      currentInvite = { token: result.token, url: result.url, creatorLabel: trimmed };
      showState('manage');
      renderManageUrl(result.url);
    } catch (err) {
      showError(err.message || 'Could not create invite. Try again.');
    }
  });

  on(document.getElementById('invite-modal-cancel-btn'), 'click', () => closeModal());

  // Copy
  on(document.getElementById('invite-modal-copy-btn'), 'click', async () => {
    if (!currentInvite) return;
    try { await navigator.clipboard.writeText(currentInvite.url); } catch { /* clipboard denied */ }
  });

  // Regenerate
  on(document.getElementById('invite-modal-regen-btn'), 'click', async () => {
    if (!currentInvite) return;
    const result = await regeneratePersonalInvite(userId, currentInvite.creatorLabel);
    currentInvite = { token: result.token, url: result.url, creatorLabel: currentInvite.creatorLabel };
    renderManageUrl(result.url);
  });

  // Revoke
  on(document.getElementById('invite-modal-revoke-btn'), 'click', async () => {
    await revokePersonalInvite(userId);
    currentInvite = null;
    showState('create');
    document.getElementById('invite-modal-label-input').value = '';
  });

  // Close
  on(document.getElementById('invite-modal-close-btn'), 'click', () => closeModal());
}
