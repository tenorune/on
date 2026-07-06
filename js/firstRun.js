// js/firstRun.js — surface-agnostic first-run affordances (spec §3, §5).
// Owns the guided-empty-state DOM (following.js only signals emptiness) and
// the one-time landing banners. Used by web AND Telegram.
import { isTelegramContext, telegramLinkState } from './telegram.js';

let _active = false;
let _onInvite = null;
let _onLink = null;

export function initFirstRun({ onInvite, onLink = null } = {}) {
  _onInvite = onInvite;
  _onLink = onLink;
  document.getElementById('first-run-invite-btn')
    ?.addEventListener('click', () => _onInvite?.());
  document.getElementById('first-run-link-btn')
    ?.addEventListener('click', () => _onLink?.());
}

// True while the guided empty state is mounted. installAffordance defers its
// toast on this (one teaching surface at a time — spec §3).
export function isFirstRunActive() {
  return _active;
}

// Called by following.js's renderList isEmpty branch. Idempotent per state.
export function setListEmpty(isEmpty) {
  const panel = document.getElementById('first-run-panel');
  if (!panel) return;
  _active = !!isEmpty;
  panel.classList.toggle('hidden', !isEmpty);
  // Demote the code-entry form to the secondary role while the panel shows —
  // presentation only: same element, ids, and behavior (spec §3).
  document.getElementById('add-person-area')?.classList.toggle('first-run-demoted', !!isEmpty);
  const addBtn = document.getElementById('add-person-btn');
  if (addBtn) addBtn.textContent = isEmpty ? 'Add by code' : 'Add a person';
  // Declutter the code drawer during the guided empty state (spec §3): the
  // drawer's "Invite your people" duplicates the on-screen first-run CTA, so
  // hide it on every surface. With only the share code left, the section's
  // "Invite" label and the "Or share this code…" framing (both of which read as
  // an alternative to that button) no longer fit — drop the label and the "Or".
  // All restored once the list is non-empty and the button returns.
  const empty = !!isEmpty;
  document.getElementById('drawer-invite-btn')?.classList.toggle('hidden', empty);
  document.getElementById('drawer-invite-label')?.classList.toggle('hidden', empty);
  const inviteHint = document.getElementById('drawer-invite-hint');
  if (inviteHint) {
    inviteHint.textContent = empty
      ? 'Share this code so others can follow your status.'
      : 'Or share this code so others can follow your status.';
  }
  // The Telegram-only account section is noise before an unlinked user has
  // anyone — hide it in the guided empty state. But a LINKED account still needs
  // its unlink control reachable, so keep the section for them even when empty.
  // Gated on Telegram so web (where the section is never mounted) is untouched.
  if (isTelegramContext()) {
    const linked = telegramLinkState()?.linked === true;
    document.getElementById('drawer-section-account')?.classList.toggle('hidden', empty && !linked);
  }
  // "Link your account" only where linking is possible and not already done.
  const linkLine = document.getElementById('first-run-link-line');
  if (linkLine) {
    const show = !!isEmpty && isTelegramContext() && telegramLinkState()?.linked !== true;
    linkLine.classList.toggle('hidden', !show);
  }
  document.dispatchEvent(new CustomEvent('first-run-change'));
}

// ── One-time landing notice (spec §5, §7) ───────────────────────────────────
// The marker survives the graduation location.reload() in sessionStorage.
// DELIBERATELY not account-scoped and NOT in cacheOwner's wipe list: it is a
// transient cross-account handoff (the reload lands as a DIFFERENT uid). If the
// webview drops sessionStorage across the reload, the notice silently doesn't
// show (accepted degradation).
const LANDING_KEY = 'kk-landing';
// Only graduation stamps a landing now: the post-link/post-unlink banners were
// removed on-device (an inline-toast style used nowhere else). The bespoke
// landing-notice banner it once rendered was likewise dropped (spec §7 flag) —
// the copy is surfaced through the shared toast at boot instead (see app.js).
const LANDING_COPY = {
  graduated: 'This account now works in any browser too.',
};

export function stampLanding(kind) {
  try { sessionStorage.setItem(LANDING_KEY, kind); } catch { /* storage denied */ }
}

// Read-and-clear the landing marker, returning the copy to surface (or null).
// The caller decides the surface — boot routes it through the shared toast so
// graduation reuses an existing pattern rather than a one-off banner.
export function consumeLandingNotice() {
  let kind = null;
  try {
    kind = sessionStorage.getItem(LANDING_KEY);
    sessionStorage.removeItem(LANDING_KEY);
  } catch { return null; }
  return LANDING_COPY[kind] || null;
}
