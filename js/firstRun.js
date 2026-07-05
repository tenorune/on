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
  // "Link your account" only where linking is possible and not already done.
  const linkLine = document.getElementById('first-run-link-line');
  if (linkLine) {
    const show = !!isEmpty && isTelegramContext() && telegramLinkState()?.linked !== true;
    linkLine.classList.toggle('hidden', !show);
  }
  document.dispatchEvent(new CustomEvent('first-run-change'));
}
