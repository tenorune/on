// js/followRequests.js
// Requester side of "request to follow a group co-member" (Groups §11).
// - requestToFollow: writes a consent request into the target's mailbox.
// - isFollowRequestEligible / createRequestFollowButton: the roster ⋮-drawer affordance.
// - initFollowGrants: watches the requester's grant mailbox and completes the follow.
//
// "Requested" is tracked per-device in localStorage only (MVP), so the button doesn't
// revert between asking and approval. A declined request leaves a stale local entry
// (the requester is never told of declines) until the follow completes, the user
// cancels (the requested-state button is a cancel toggle), or storage clears —
// accepted for localStorage-only scope.

import {
  writeFollowRequest, deleteFollowRequest, watchFollowGrants, deleteFollowGrant,
  setFollowingEntry, registerAsFollower,
} from './db.js';
import { getFollowing } from './prefs.js';
import { showToast } from './groups.js';
import { showConfirmModal } from './promptModal.js';

const REQUESTED_KEY = 'statusapp_follow_requested';

// Read straight from localStorage every time so the state can't leak across the
// (single) module instance — and so it always reflects the current device state.
function readRequested(): Set<string> {
  try { return new Set<string>(JSON.parse(localStorage.getItem(REQUESTED_KEY) || '[]')); }
  catch { return new Set<string>(); }
}
function writeRequested(set: Set<string>) {
  try { localStorage.setItem(REQUESTED_KEY, JSON.stringify([...set])); } catch { /* quota */ }
}
function markRequested(uid: string) { const s = readRequested(); s.add(uid); writeRequested(s); }
function clearRequested(uid: string) { const s = readRequested(); if (s.delete(uid)) writeRequested(s); }

export function isRequested(targetUid: string) {
  return readRequested().has(targetUid);
}

// Offer the affordance only for co-members you don't already follow. (The roster
// already filters self out, so self is not re-checked here.)
export function isFollowRequestEligible(targetUid: string) {
  return !getFollowing().some((f) => f.userId === targetUid);
}

export async function requestToFollow(myUid: string, targetUid: string, groupId: string) {
  await writeFollowRequest(myUid, targetUid, groupId);
  markRequested(targetUid);
}

// Withdraw a pending request: delete it from the target's mailbox and clear the
// local marker. Deleting an already-gone entry (target declined meanwhile) is a
// no-op remove, so cancel doubles as the user's way out of a stale "Requested"
// state — after which they can request again.
export async function cancelFollowRequest(myUid: string, targetUid: string) {
  await deleteFollowRequest(targetUid, myUid);
  clearRequested(targetUid);
}

// Circled-plus icon, colored like the notify bell: muted when unrequested,
// white once requested (see .request-follow-btn CSS). stroke=currentColor so
// the CSS color does the state work; the .rf-plus glyph is hidden by CSS in
// requested mode, leaving an empty white circle (= tap to cancel).
const CIRCLED_PLUS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"/><path class="rf-plus" d="M12 8v8M8 12h8"/></svg>';

// The roster ⋮-drawer action: a circled-plus toggle. Muted = tap to request;
// white (.requested) = tap to cancel the pending request. Each direction
// confirms with a toast naming the member. Stops its own pointer/click events
// so a tap never reaches the roster row's knock handler or long-press adoption.
export function createRequestFollowButton(myUid: string, targetUid: string, groupId: string, displayName: string) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'request-follow-btn';
  btn.innerHTML = CIRCLED_PLUS_SVG;

  function paint() {
    const asked = isRequested(targetUid);
    btn.classList.toggle('requested', asked);
    const label = asked ? 'Cancel follow request' : 'Request to follow';
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }
  paint();

  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (btn.disabled) return; // in-flight guard
    btn.disabled = true;
    try {
      if (isRequested(targetUid)) {
        // Same confirm treatment as sending (below): the requested-state
        // button is the only cancel affordance and just as easy to fat-finger.
        // 'Keep request' instead of a bare 'Cancel' so the two buttons can't
        // read as the same action.
        const cancelled = await showConfirmModal({
          title: `Cancel your request to follow ${displayName}?`,
          confirmLabel: 'Cancel request',
          cancelLabel: 'Keep request',
          busyLabel: 'Cancelling…',
          onConfirm: () => cancelFollowRequest(myUid, targetUid),
        });
        if (cancelled) showToast(`You cancelled your request to follow ${displayName}.`);
      } else if (isFollowRequestEligible(targetUid)) {
        // Eligibility re-checked at click time: the button may have been
        // rendered against a not-yet-synced following cache (fresh-device boot
        // straight into a group). The 'following-synced' roster re-render
        // removes stale buttons, but never send a request to someone already
        // followed even if one is clicked first.
        // Confirm before sending: the roster affordance is a small icon in a
        // drawer, easy to hit by accident. The write runs as the modal's
        // onConfirm so a failure surfaces inline there (retry or cancel)
        // instead of vanishing into a silent catch.
        const sent = await showConfirmModal({
          title: `Send a request to follow ${displayName}?`,
          confirmLabel: 'Send request',
          confirmVariant: 'affirmative',
          busyLabel: 'Sending…',
          onConfirm: () => requestToFollow(myUid, targetUid, groupId),
        });
        if (sent) showToast(`You requested to follow ${displayName}.`);
      }
    } catch {
      // Write failed — no toast; repaint below shows the true (unchanged) state
      // and the still-enabled button is the retry path.
    }
    btn.disabled = false;
    paint();
  });

  return btn;
}

// Boot-time watcher (app.js) on the requester's own grant mailbox. When the target
// approves, they write a grant carrying their share code; here we complete the
// one-directional follow (requester → target) exactly as add-person does — their
// code into my following list + me into their followers list — then delete the grant
// and clear the local "Requested" marker. Idempotent if I already follow them.
// Durable: a grant left by an offline-at-approval requester is consumed on next load.
// Re-entrancy: our own deleteFollowGrant echoes back as a fresh onValue tick that can
// land mid-flight; the per-target in-flight set keeps that tick (or any concurrent
// one) from re-processing a grant we're already completing.
interface GrantRecord { code?: string; name?: string }
const _inflight = new Set<string>();
export function initFollowGrants(myUid: string, myCode: string) {
  return watchFollowGrants(myUid, async (grants) => {
    for (const [targetUid, grant] of Object.entries((grants || {}) as Record<string, GrantRecord>)) {
      if (!grant || !grant.code) continue;
      if (_inflight.has(targetUid)) continue;
      _inflight.add(targetUid);
      try {
        // grant.name is the approver's roster display name — the name this
        // user requested by — so the new Direct card opens named, not coded.
        await setFollowingEntry(myUid, targetUid, grant.code, grant.name || '');
        await registerAsFollower(targetUid, myUid, myCode);
        await deleteFollowGrant(myUid, targetUid);
        clearRequested(targetUid);
      } catch {
        // Leave the grant in place; retried on the next tick / next load.
      } finally {
        _inflight.delete(targetUid);
      }
    }
  });
}
