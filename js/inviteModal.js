// js/inviteModal.js
// Shared invite-link modal component. Parameterized by scope.
// Wires both scope='personal' (Phase 0) and scope='group' (Phase 1).

import {
  createPersonalInvite, regeneratePersonalInvite, revokePersonalInvite,
  createGroupInvite, regenerateGroupInvite, revokeGroupInvite,
} from './invites.js';
import { readPendingInviteesForGroup } from './db.js';
import { renderInvitePicker } from './invitePicker.js';

const SCOPE_COPY = {
  personal: {
    title: 'Your invite link',
    subtitle: 'People who tap this link will follow you.',
    labelHint: 'Your name on the invite',
    labelPlaceholder: 'e.g. Alex K.',
    needsLabel: true,
  },
  group: {
    title: 'Invite to {groupName}',
    subtitle: 'People who tap this link will join {groupName}.',
    needsLabel: false,
  },
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
  if (!errEl) return;
  errEl.classList.add('hidden');
  errEl.textContent = '';
}

function showError(msg) {
  const errEl = document.getElementById('invite-modal-label-error');
  if (!errEl) return;
  errEl.classList.remove('hidden');
  errEl.textContent = msg;
}

function closeModal() {
  document.getElementById('invite-modal').classList.add('hidden');
  clearListeners();
}

export async function openInviteModal({ scope, userId, activeInvite = null, groupId = null, groupName = null, followers = {}, mutuals = [], currentMemberUids = new Set() }) {
  const copy = SCOPE_COPY[scope];
  if (!copy) throw new Error(`Unknown scope: ${scope}`);
  if (scope === 'group' && (!groupId || !groupName)) {
    throw new Error('Group scope requires groupId and groupName.');
  }

  const title = copy.title.replace('{groupName}', groupName || '');
  const subtitle = copy.subtitle.replace('{groupName}', groupName || '');
  document.getElementById('invite-modal-title').textContent = title;
  document.getElementById('invite-modal-subtitle').textContent = subtitle;

  // Show the label input only for scopes that need it.
  const labelHintEl = document.getElementById('invite-modal-label-hint');
  const labelInputEl = document.getElementById('invite-modal-label-input');
  if (copy.needsLabel) {
    if (labelHintEl) { labelHintEl.textContent = copy.labelHint; labelHintEl.classList.remove('hidden'); }
    if (labelInputEl) { labelInputEl.classList.remove('hidden'); labelInputEl.placeholder = copy.labelPlaceholder; }
  } else {
    if (labelHintEl) labelHintEl.classList.add('hidden');
    if (labelInputEl) labelInputEl.classList.add('hidden');
  }

  // Section 2 (in-app picker) — group scope only.
  const pickerEl = document.getElementById('invite-modal-picker');
  if (pickerEl) {
    pickerEl.classList.toggle('hidden', scope !== 'group');
  }

  // Section 2 — populate the picker for group scope only.
  if (scope === 'group') {
    const pendingInvitees = await readPendingInviteesForGroup(groupId);
    renderInvitePicker({
      inviterUid: userId,
      groupId,
      followers,
      mutuals,
      currentMemberUids,
      pendingInviteeUids: new Set(pendingInvitees),
    });
  }

  hideError();
  clearListeners();
  document.getElementById('invite-modal').classList.remove('hidden');

  let currentInvite = activeInvite ? { ...activeInvite } : null;

  if (currentInvite) {
    showState('manage');
    renderManageUrl(currentInvite.url);
  } else {
    showState('create');
    if (labelInputEl) labelInputEl.value = '';
  }

  // Create handler — branch by scope. hideError() runs before the await so a
  // stale error from a previous attempt doesn't linger across the round-trip.
  on(document.getElementById('invite-modal-create-btn'), 'click', async () => {
    try {
      let result;
      if (scope === 'personal') {
        const raw = labelInputEl.value;
        const trimmed = (raw || '').trim();
        if (!trimmed) { showError('Please enter a name.'); return; }
        if (trimmed.length > 40) { showError('Name must be at most 40 characters.'); return; }
        hideError();
        result = await createPersonalInvite(userId, trimmed);
        currentInvite = { token: result.token, url: result.url, scope, creatorLabel: trimmed };
      } else {
        hideError();
        result = await createGroupInvite(userId, groupId);
        currentInvite = { token: result.token, url: result.url, scope, groupId, groupName };
      }
      showState('manage');
      renderManageUrl(result.url);
    } catch (err) {
      showError(err.message || 'Could not create invite. Try again.');
    }
  });

  // Copy — unchanged from Phase 0
  on(document.getElementById('invite-modal-copy-btn'), 'click', async () => {
    if (!currentInvite) return;
    const btn = document.getElementById('invite-modal-copy-btn');
    try {
      await navigator.clipboard.writeText(currentInvite.url);
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    } catch { /* clipboard denied */ }
  });

  // Regenerate — branch by scope
  on(document.getElementById('invite-modal-regen-btn'), 'click', async () => {
    if (!currentInvite) return;
    try {
      const result = scope === 'personal'
        ? await regeneratePersonalInvite(userId, currentInvite.creatorLabel)
        : await regenerateGroupInvite(userId, groupId);
      currentInvite = { ...currentInvite, token: result.token, url: result.url };
      renderManageUrl(result.url);
      document.getElementById('invite-modal-copy-btn').textContent = 'Copy';
    } catch (err) {
      showError(err.message || 'Could not regenerate invite. Try again.');
    }
  });

  // Revoke — branch by scope
  on(document.getElementById('invite-modal-revoke-btn'), 'click', async () => {
    try {
      if (scope === 'personal') await revokePersonalInvite(userId);
      else await revokeGroupInvite(userId, groupId);
      currentInvite = null;
      showState('create');
      if (labelInputEl) labelInputEl.value = '';
    } catch (err) {
      showError(err.message || 'Could not revoke invite. Try again.');
    }
  });

  // Dismiss on tap-outside (overlay click, but not card click).
  const overlay = document.getElementById('invite-modal');
  on(overlay, 'click', (e) => {
    if (e.target === overlay) closeModal();
  });
  // Escape-to-dismiss for keyboard users — the modal has aria-modal="true",
  // which traps focus, so without this there is no keyboard path out.
  on(document, 'keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}
