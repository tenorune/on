// js/inviteModal.js
// Shared invite-link modal component. Parameterized by scope.
// Wires both scope='personal' (Phase 0) and scope='group' (Phase 1).

import {
  createPersonalInvite, regeneratePersonalInvite, revokePersonalInvite,
  createGroupInvite, regenerateGroupInvite, revokeGroupInvite,
} from './invites.js';
import { readPendingInviteesForGroup } from './db.js';
import { renderInvitePicker, hasDisplayableInvitees } from './invitePicker.js';
import { flashRegenerated } from './regenFlash.js';
import { isTelegramContext } from './telegram.js';
import { shareInviteLink, telegramSharingEnabled, shareInviteToTelegramWeb, buildTelegramInviteLink, shareCaption } from './inviteFlow.js';
import { copyWithFeedback } from './utils.js';

interface ScopeCopy { title: string; subtitle: string; labelHint?: string; labelPlaceholder?: string; needsLabel: boolean; }
interface CurrentInvite { token?: string; url?: string; scope?: string; creatorLabel?: string; groupId?: string | null; groupName?: string; }
type Mutual = { userId: string; label?: string };

const SCOPE_COPY: Record<string, ScopeCopy> = {
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

let cleanupFns: Array<() => void> = [];

function clearListeners() {
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
}

function on(el: EventTarget, evt: string, handler: (e: Event) => void) {
  el.addEventListener(evt, handler);
  cleanupFns.push(() => el.removeEventListener(evt, handler));
}

function showState(stateName: string) {
  document.getElementById('invite-modal-create')!.classList.toggle('hidden', stateName !== 'create');
  document.getElementById('invite-modal-manage')!.classList.toggle('hidden', stateName !== 'manage');
}

// Show the unchanging URL base (e.g. "https://app/?i=") above the field and only
// the changing token ("hash") inside it, so a regenerate is obviously a change.
function renderManageUrl(invite: CurrentInvite) {
  const url = invite.url || '';
  const token = invite.token || '';
  const prefixEl = document.getElementById('invite-modal-url-prefix');
  if (prefixEl) prefixEl.textContent = token && url.endsWith(token) ? url.slice(0, url.length - token.length) : url;
  const urlEl = document.getElementById('invite-modal-url');
  if (urlEl) urlEl.textContent = token || url;
}

function hideError() {
  const errEl = document.getElementById('invite-modal-label-error');
  if (!errEl) return;
  errEl.classList.add('hidden');
  errEl.textContent = '';
}

function showError(msg: string) {
  const errEl = document.getElementById('invite-modal-label-error');
  if (!errEl) return;
  errEl.classList.remove('hidden');
  errEl.textContent = msg;
}

export function closeInviteModal() {
  document.getElementById('invite-modal')!.classList.add('hidden');
  clearListeners();
}
const closeModal = closeInviteModal;

export async function openInviteModal({ scope, userId, activeInvite = null, groupId = null, groupName = null, followers = {}, mutuals = [], currentMemberUids = new Set<string>() }: {
  scope: string;
  userId: string;
  activeInvite?: CurrentInvite | null;
  groupId?: string | null;
  groupName?: string | null;
  followers?: Record<string, string>;
  mutuals?: Mutual[];
  currentMemberUids?: Set<string>;
}) {
  const copy = SCOPE_COPY[scope];
  if (!copy) throw new Error(`Unknown scope: ${scope}`);
  if (scope === 'group' && (!groupId || !groupName)) {
    throw new Error('Group scope requires groupId and groupName.');
  }

  const title = copy.title.replace('{groupName}', groupName || '');
  const subtitle = copy.subtitle.replace('{groupName}', groupName || '');
  document.getElementById('invite-modal-title')!.textContent = title;
  document.getElementById('invite-modal-subtitle')!.textContent = subtitle;

  // Show the label input only for scopes that need it.
  const labelHintEl = document.getElementById('invite-modal-label-hint');
  const labelInputEl = document.getElementById('invite-modal-label-input') as HTMLInputElement | null;
  if (copy.needsLabel) {
    if (labelHintEl) { labelHintEl.textContent = copy.labelHint!; labelHintEl.classList.remove('hidden'); }
    if (labelInputEl) { labelInputEl.classList.remove('hidden'); labelInputEl.placeholder = copy.labelPlaceholder!; }
  } else {
    if (labelHintEl) labelHintEl.classList.add('hidden');
    if (labelInputEl) labelInputEl.classList.add('hidden');
  }

  // Telegram group scope shares the deep link via a single "Share on Telegram"
  // button in place of the web-URL create/manage UI. Web (and personal) keep
  // the existing link flow.
  const tgGroupShare = scope === 'group' && isTelegramContext();

  // Section 2 (in-app picker) — group scope, and only when someone is actually
  // eligible to invite (an empty picker is dead UI). Same predicate as the
  // TG skip-to-share shortcut below; decided synchronously from caller-passed
  // data so there's no post-paint flash. Populate (async) AFTER the modal is
  // shown, at the end of this function.
  const displayableInvitees = scope === 'group'
    && hasDisplayableInvitees({ followers, mutuals, currentMemberUids, inviterUid: userId });
  const pickerEl = document.getElementById('invite-modal-picker');
  if (pickerEl) {
    pickerEl.classList.toggle('hidden', !displayableInvitees);
  }

  hideError();
  clearListeners();

  let currentInvite: CurrentInvite | null = activeInvite ? { ...activeInvite } : null;

  const tgShareEl = document.getElementById('invite-modal-tg-share');
  if (tgGroupShare) {
    // Hide both create + manage (showState('none')); show the share button and
    // clear the "this link" subtitle (no link is surfaced here). Tapping shares
    // the t.me deep link, minting the group invite on demand (idempotent).
    showState('none');
    if (tgShareEl) tgShareEl.classList.remove('hidden');
    document.getElementById('invite-modal-subtitle')!.textContent = '';
    on(document.getElementById('invite-modal-tg-share-btn')!, 'click', async () => {
      try {
        const { token, url } = await createGroupInvite(userId, groupId!);
        shareInviteLink({ token, url }, shareCaption('group', groupName!));
      } catch (err) {
        showError((err as { message?: string }).message || "Couldn't create invite. Try again.");
      }
    });
  } else {
    if (tgShareEl) tgShareEl.classList.add('hidden');
    if (currentInvite) {
      showState('manage');
      renderManageUrl(currentInvite);
    } else {
      showState('create');
      if (labelInputEl) labelInputEl.value = '';
    }
  }

  // Create handler — branch by scope. hideError() runs before the await so a
  // stale error from a previous attempt doesn't linger across the round-trip.
  on(document.getElementById('invite-modal-create-btn')!, 'click', async () => {
    try {
      let result;
      if (scope === 'personal') {
        const raw = labelInputEl!.value;
        const trimmed = (raw || '').trim();
        if (!trimmed) { showError('Please enter a name.'); return; }
        if (trimmed.length > 40) { showError('Name must be at most 40 characters.'); return; }
        hideError();
        result = await createPersonalInvite(userId, trimmed);
        currentInvite = { token: result.token, url: result.url, scope, creatorLabel: trimmed };
      } else {
        hideError();
        result = await createGroupInvite(userId, groupId!);
        currentInvite = { token: result.token, url: result.url, scope, groupId, groupName: groupName ?? undefined };
      }
      showState('manage');
      renderManageUrl(currentInvite);
    } catch (err) {
      showError((err as { message?: string }).message || "Couldn't create invite. Try again.");
    }
  });

  // Copy — unchanged from Phase 0
  on(document.getElementById('invite-modal-copy-btn')!, 'click', async () => {
    if (!currentInvite) return;
    await copyWithFeedback(document.getElementById('invite-modal-copy-btn')!, currentInvite.url!);
  });

  // Share affordance next to Copy. In Telegram: the native share sheet. On web,
  // when a Mini App deep link is configured (spec §4 "designed-for"), a
  // "Share to Telegram" that opens the t.me share intent in a new tab; a blocked
  // popup falls back to copying the deep link. Copy still covers the web URL.
  const shareBtn = document.getElementById('invite-modal-share-btn');
  const webTgShare = !isTelegramContext() && telegramSharingEnabled();
  if (shareBtn && (isTelegramContext() || webTgShare)) {
    shareBtn.classList.remove('hidden');
    if (webTgShare) shareBtn.textContent = 'Share to Telegram';
    on(shareBtn, 'click', async () => {
      if (!currentInvite) return;
      const text = shareCaption(scope, groupName ?? undefined);
      if (isTelegramContext()) { shareInviteLink(currentInvite, text); return; }
      if (!shareInviteToTelegramWeb(currentInvite, text)) {
        const deepLink = buildTelegramInviteLink(currentInvite.token);
        if (deepLink) await copyWithFeedback(shareBtn!, deepLink, { done: 'Link copied!', idle: 'Share to Telegram' });
      }
    });
  }

  // Regenerate — branch by scope
  on(document.getElementById('invite-modal-regen-btn')!, 'click', async () => {
    if (!currentInvite) return;
    try {
      const result = scope === 'personal'
        ? await regeneratePersonalInvite(userId, currentInvite.creatorLabel)
        : await regenerateGroupInvite(userId, groupId!);
      currentInvite = { ...currentInvite, token: result.token, url: result.url };
      renderManageUrl(currentInvite);
      flashRegenerated(
        document.getElementById('invite-modal-url'),
        document.getElementById('invite-modal-regen-btn'),
      );
      document.getElementById('invite-modal-copy-btn')!.textContent = 'Copy';
    } catch (err) {
      showError((err as { message?: string }).message || "Couldn't regenerate invite. Try again.");
      // On error the badge swap didn't run, so drop the tapped ↻'s focus here
      // (otherwise it looks "stuck selected" until you tap elsewhere).
      (document.getElementById('invite-modal-regen-btn') as HTMLElement).blur();
    }
  });

  // Revoke — branch by scope
  on(document.getElementById('invite-modal-revoke-btn')!, 'click', async () => {
    try {
      if (scope === 'personal') await revokePersonalInvite(userId);
      else await revokeGroupInvite(userId, groupId!);
      currentInvite = null;
      showState('create');
      if (labelInputEl) labelInputEl.value = '';
    } catch (err) {
      showError((err as { message?: string }).message || "Couldn't revoke invite. Try again.");
    }
  });

  // Dismiss on tap-outside (overlay click, but not card click).
  const overlay = document.getElementById('invite-modal');
  on(overlay!, 'click', (e) => {
    if (e.target === overlay) closeModal();
  });
  // Escape-to-dismiss for keyboard users — the modal has aria-modal="true",
  // which traps focus, so without this there is no keyboard path out.
  on(document, 'keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape') closeModal();
  });

  // TG-group shortcut: if there's no one displayable to invite (Section 2 would
  // render empty), skip the modal entirely and share the deep link directly —
  // there's nothing useful to show. On createGroupInvite failure, fall through
  // to open the modal so the user can retry via its Share button (which
  // surfaces its own errors).
  if (tgGroupShare && !displayableInvitees) {
    try {
      const { token, url } = await createGroupInvite(userId, groupId!);
      shareInviteLink({ token, url }, shareCaption('group', groupName!));
      return; // never paint the modal
    } catch {
      // on failure, fall through to open the modal so the user can retry via
      // its Share button (which surfaces its own errors)
    }
  }

  // Show the modal synchronously — BEFORE the async picker populate — so on the
  // group-create path it appears together with the new group context instead of
  // a blank frame followed by a late pop-in once readPendingInviteesForGroup
  // resolves (the transition jank this flow used to show).
  document.getElementById('invite-modal')!.classList.remove('hidden');

  // Populate the in-app picker after the modal is already up. Skipped when the
  // section is hidden — rows are built solely from followers/mutuals, so with
  // no displayable invitees there is nothing to render (or fetch).
  if (displayableInvitees) {
    const pendingInvitees = await readPendingInviteesForGroup(groupId!);
    renderInvitePicker({
      inviterUid: userId,
      groupId: groupId!,
      followers,
      mutuals,
      currentMemberUids,
      pendingInviteeUids: new Set(pendingInvitees),
    });
  }
}
