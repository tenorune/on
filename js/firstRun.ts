// js/firstRun.ts — surface-agnostic first-run affordances (spec §3, §5).
// Owns the guided-empty-state DOM (following.js only signals emptiness) and
// the one-time landing banners. Used by web AND Telegram.
import { isTelegramContext, isTelegramLinked } from './telegram.js';

type FirstRunHandler = (() => void) | null | undefined;

interface FirstRunHandlers {
  onInvite?: (() => void) | null;
  onLink?: (() => void) | null;
  onGraduateInfo?: (() => void) | null;
}

let _active = false;
let _onInvite: FirstRunHandler = null;
let _onLink: FirstRunHandler = null;
let _onGraduateInfo: FirstRunHandler = null;

export function initFirstRun({ onInvite, onLink = null, onGraduateInfo = null }: FirstRunHandlers = {}) {
  _onInvite = onInvite;
  _onLink = onLink;
  _onGraduateInfo = onGraduateInfo;
  document.getElementById('first-run-invite-btn')
    ?.addEventListener('click', () => _onInvite?.());
  document.getElementById('first-run-link-btn')
    ?.addEventListener('click', () => _onLink?.());
  // The "?" beside the link line explains the graduation flow (injected so
  // firstRun stays free of the graduation module — spec §7).
  document.getElementById('first-run-graduate-help')
    ?.addEventListener('click', () => _onGraduateInfo?.());
}

// True while the guided empty state is mounted. installAffordance defers its
// toast on this (one teaching surface at a time — spec §3).
export function isFirstRunActive() {
  return _active;
}

// True once setListEmpty has run at least once — i.e. the list has rendered and
// the empty/non-empty verdict is known. Before that, isFirstRunActive() reads
// false only because the state is UNRESOLVED, not because the list is non-empty;
// teaching surfaces that defer to first-run (the Telegram onramp promo) must
// hold until this is true, or they flash in the boot window before the guided
// empty state mounts (iOS FTU finding).
export function isFirstRunResolved() {
  return _appliedEmpty !== null;
}

// Last emptiness state actually applied. setListEmpty is called from every
// renderList tick (presence flips, watcher ticks, a 60s interval) but its ~10
// DOM writes + the first-run-change fan-out only matter on a genuine
// empty↔non-empty transition — everything else it reads (isTelegramContext,
// isTelegramLinked) is static within a session (link/unlink/graduation all
// reload). Same-state re-calls are no-ops (W3-A CL#1).
let _appliedEmpty: boolean | null = null;

// Called by following.js's renderList isEmpty branch. No-op per unchanged state.
export function setListEmpty(isEmpty: unknown) {
  const panel = document.getElementById('first-run-panel');
  if (!panel) return;
  const empty = !!isEmpty;
  if (_appliedEmpty === empty) return;
  _appliedEmpty = empty;
  _active = empty;
  panel.classList.toggle('hidden', !empty);
  // Demote the code-entry form to the secondary role while the panel shows —
  // presentation only: same element, ids, and behavior (spec §3).
  document.getElementById('add-person-area')?.classList.toggle('first-run-demoted', empty);
  // Declutter the code drawer during the guided empty state (spec §3): the
  // drawer's "Invite your people" duplicates the on-screen first-run CTA, so
  // hide it on every surface. With only the share code left, the section's
  // "Invite" label and the "Or share this code…" framing (both of which read as
  // an alternative to that button) no longer fit — drop the label and the "Or".
  // All restored once the list is non-empty and the button returns.
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
  const tgLinked = isTelegramContext() && isTelegramLinked();
  if (isTelegramContext()) {
    document.getElementById('drawer-section-account')?.classList.toggle('hidden', empty && !tgLinked);
  }
  // The header chip opens the drawer. In the guided empty state the drawer is
  // stripped to just the share code (its legacy role) — keep "Share code" there.
  // A linked account keeps its account/unlink + notification sections even when
  // empty, so it's never code-only. In every other state the drawer is a
  // grab-bag (invite, link/unlink, notification pill), so name it as such.
  const codeOnly = empty && !tgLinked;
  const chip = document.getElementById('mycode-chip');
  if (chip) chip.textContent = codeOnly ? 'Share code' : 'Levers & knobs';
  // "Link your account" only where linking is possible and not already done.
  const linkLine = document.getElementById('first-run-link-line');
  if (linkLine) {
    const show = empty && isTelegramContext() && !isTelegramLinked();
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
// Kind-keyed landing copy. 'graduated' (web account graduates into a
// full-featured account) and 'linked' (Task 7: the Mini App onramp arrival
// links this Telegram to an existing web account) both stamp then reload;
// the next boot reads and clears this marker.
const LANDING_COPY: Record<string, string> = {
  graduated: 'This account now works in any browser too. Keep your secret phrase safe — it’s your only way back in if you lose Telegram.',
  linked: 'This account now works in Telegram too.',
};

export function stampGraduationNotice() {
  try { sessionStorage.setItem(LANDING_KEY, 'graduated'); } catch { /* storage denied */ }
}
export function stampLinkedNotice() {
  try { sessionStorage.setItem(LANDING_KEY, 'linked'); } catch { /* storage denied */ }
}

// Read-and-clear the marker, returning the copy to surface (or null). The
// caller decides the surface — boot routes it through the shared toast.
export function consumeGraduationNotice() {
  let kind: string | null = null;
  try {
    kind = sessionStorage.getItem(LANDING_KEY);
    sessionStorage.removeItem(LANDING_KEY);
  } catch { return null; }
  return LANDING_COPY[kind as string] || null;
}
