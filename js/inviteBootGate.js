// js/inviteBootGate.js — the /?i= boot decision (spec N3). Pure ordered rules
// (decideBootRedirect) + a thin env reader (readBootRedirectContext) so the
// gate is unit-testable without a boot harness. Wired at the top of app.js
// main(), BEFORE any Firebase work — the whole point is that no account can
// be minted before this gate runs. Phases 2/3 extend the tokenless branch
// here (spec §4).
import { isTelegramContext } from './telegram.js';
import { loadIdentity } from './identity.js';
import { isStandalone, isInAppBrowser, isIos, isTelegramInAppBrowser } from './installGuidance.js';
import { telegramSharingEnabled, buildTelegramInviteLink } from './inviteFlow.js';

// stay=1 = "the landing already offered the choice; don't bounce back" (C2).
export function hasStayParam() {
  try { return new URLSearchParams(window.location.search).get('stay') === '1'; }
  catch { return false; }
}

// Ordered; first match wins. Returns { kind: 'hop' | 'landing', url } or null
// (= proceed with today's boot).
export function decideBootRedirect(ctx) {
  if (ctx.telegramContext) return null;               // 1 · Mini App boots itself
  if (ctx.stay) return null;                          // 2 · landing already chose
  if (ctx.hasIdentity || ctx.standalone) return null; // 3 · existing identity wins (C3)
  if (!ctx.token) {
    // Phase 2 (Q5=B / F8): a bare arrival trapped in a DETECTED webview gets the
    // standing /about page — both doors, no token to carry, no auto-hop (bare
    // Telegram-Android gets the choice; Q4=A was answered for invites).
    // iOS-undetected bare boots don't redirect until phase 3 (Q8=C).
    return ctx.inAppBrowser ? { kind: 'landing', url: '/about' } : null;
  }
  if (ctx.telegramAndroid && ctx.deepLink) {
    return { kind: 'hop', url: ctx.deepLink };        // 4 · Q4=A zero-tap rescue
  }
  if (ctx.inAppBrowser) {
    return { kind: 'landing', url: '/invite?i=' + ctx.token }; // 5 · any webview (holistic)
  }
  if (ctx.ios && ctx.sharingEnabled) {
    // 6 · undetectable-iOS net — the only reason to drag iOS Safari through
    // the landing is the invisible Telegram webview, so Telegram-off spares it.
    return { kind: 'landing', url: '/invite?i=' + ctx.token };
  }
  return null;                                        // 7 · today's flow
}

export function readBootRedirectContext(token) {
  return {
    token: token || null,
    telegramContext: isTelegramContext(),
    stay: hasStayParam(),
    hasIdentity: !!loadIdentity(),
    standalone: isStandalone(),
    telegramAndroid: isTelegramInAppBrowser(),
    // buildTelegramInviteLink returns the full …?startapp=TOKEN URL, or null
    // when TELEGRAM_APP_LINK is unconfigured (→ rule 4 falls through to 5).
    deepLink: token ? buildTelegramInviteLink(token) : null,
    inAppBrowser: isInAppBrowser(),
    ios: isIos(),
    sharingEnabled: telegramSharingEnabled(),
  };
}
