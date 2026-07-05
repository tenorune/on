// js/telegramChrome.js — Telegram webview chrome integration (spec §6).
// Back button, vertical-swipe disable, closing confirmation during calls,
// and chrome color re-sync. Everything version-guarded and inert outside
// Telegram. Haptics deliberately out of scope.
import { tgWebApp } from './telegram.js';
import { isCardDrawerOpen, closeCardDrawer } from './cardDrawer.js';
import { isNotifyPopoverOpen, dismissNotifyPopover } from './notifyBell.js';
import { closeInviteModal } from './inviteModal.js';
import { closeInboxModal } from './inbox.js';
import { navigateToDirect, getCurrentContext } from './groupNav.js';
import { getCallModeCalleeId, getIncomingCallFrom } from './following.js';

const visible = (doc, id) => {
  const el = doc.getElementById(id);
  return !!el && !el.classList.contains('hidden');
};

// Pure, ordered checklist over EXISTING close paths. Returns the action for
// the top-most closeable surface, or null (button hidden; Telegram default).
//  - tg-invite-screen: pre-consent — back should leave the app, not skip it.
//  - recovery-modal: guards an unsaved phrase with its own history trap;
//    a back affordance that discards it would be worse than none.
export function resolveBackAction(doc = document) {
  if (visible(doc, 'restore-screen')) return () => doc.getElementById('restore-cancel-btn')?.click();
  if (visible(doc, 'tg-invite-screen')) return null;
  if (visible(doc, 'recovery-modal')) return null;
  if (visible(doc, 'invite-modal')) return () => closeInviteModal();
  if (visible(doc, 'create-group-modal')) return () => doc.getElementById('create-group-cancel-btn')?.click();
  if (visible(doc, 'inbox-modal')) return () => closeInboxModal();
  if (visible(doc, 'invite-failure-overlay')) return () => doc.getElementById('invite-failure-continue')?.click();
  if (isNotifyPopoverOpen()) return () => dismissNotifyPopover();
  if (isCardDrawerOpen()) return () => closeCardDrawer();
  if (doc.getElementById('add-person-form')?.classList.contains('open')) {
    return () => doc.getElementById('add-cancel-btn')?.click();
  }
  if (doc.getElementById('code-drawer')?.classList.contains('open')) {
    return () => doc.getElementById('mycode-chip')?.click(); // real toggle path
  }
  if (getCurrentContext().context === 'group') return () => navigateToDirect();
  return null;
}

let _backAction = null;

function inCall() {
  return !!(getCallModeCalleeId() || getIncomingCallFrom());
}

function updateChromeState() {
  const wa = tgWebApp();
  if (!wa) return;
  // Back button hidden during calls: accidental hangup is worse than no back
  // button — leaving a call stays an explicit in-app action (spec §6).
  _backAction = inCall() ? null : resolveBackAction();
  try {
    if (wa.BackButton) (_backAction ? wa.BackButton.show() : wa.BackButton.hide());
    if (wa.enableClosingConfirmation && wa.disableClosingConfirmation) {
      (inCall() ? wa.enableClosingConfirmation() : wa.disableClosingConfirmation());
    }
  } catch { /* chrome sugar must never break the app */ }
}

function syncChromeColor() {
  const wa = tgWebApp();
  if (!wa) return;
  try {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (bg) {
      wa.setHeaderColor?.(bg);
      wa.setBackgroundColor?.(bg);
    }
  } catch { /* ignore */ }
}

function debounce(fn, ms = 80) {
  let t = null;
  return () => { clearTimeout(t); t = setTimeout(fn, ms); };
}

export function initTelegramChrome() {
  const wa = tgWebApp();
  if (!wa) return;
  try {
    wa.ready();
    wa.expand();
    // Global: list overscroll collapses the webview too, not just canvas
    // strokes; the header stays the platform-normal minimize affordance.
    if (wa.isVersionAtLeast?.('7.7')) wa.disableVerticalSwipes?.();
    wa.BackButton?.onClick?.(() => { _backAction?.(); });
    syncChromeColor();
    // One debounced observer drives back button + closing confirmation
    // (overlay opens/closes, call-mode classes) and the chrome color
    // (documentElement style writes) — same pattern the hint engine's
    // pause detection proved out.
    const onMutate = debounce(() => { updateChromeState(); syncChromeColor(); });
    new MutationObserver(onMutate).observe(document.documentElement, {
      attributes: true, attributeFilter: ['class', 'style', 'open'], subtree: true, childList: true,
    });
    updateChromeState();
  } catch { /* chrome sugar must never block boot */ }
}
