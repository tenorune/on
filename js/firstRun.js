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

// ── One-time landing banners (spec §5) ──────────────────────────────────────
// The marker survives the link/unlink location.reload() in sessionStorage.
// DELIBERATELY not account-scoped and NOT in cacheOwner's wipe list: it is a
// transient cross-account handoff. If the webview drops sessionStorage across
// the reload, the banner silently doesn't show (accepted degradation).
const LANDING_KEY = 'kk-landing';
// The post-link and post-unlink banners were removed (an inline-toast style used
// nowhere else, judged unnecessary on-device). The mechanism is retained only for
// the designed-but-unbuilt graduation landing (spec §7); link/unlink stamp nothing.
const LANDING_COPY = {
  graduated: 'This account now works in any browser too.',
};

export function stampLanding(kind) {
  try { sessionStorage.setItem(LANDING_KEY, kind); } catch { /* storage denied */ }
}

export function showLandingNotice() {
  let kind = null;
  try {
    kind = sessionStorage.getItem(LANDING_KEY);
    sessionStorage.removeItem(LANDING_KEY);
  } catch { return; }
  const text = LANDING_COPY[kind];
  if (!text) return;
  const main = document.getElementById('main-list');
  if (!main || document.getElementById('landing-notice')) return;
  const el = document.createElement('div');
  el.id = 'landing-notice';
  el.className = 'landing-notice';
  const span = document.createElement('span');
  span.textContent = text;
  const btn = document.createElement('button');
  btn.id = 'landing-notice-dismiss';
  btn.className = 'ghost-btn';
  btn.type = 'button';
  btn.textContent = 'OK';
  btn.addEventListener('click', () => el.remove());
  el.append(span, btn);
  main.insertBefore(el, main.firstChild); // above the guided empty state
}
