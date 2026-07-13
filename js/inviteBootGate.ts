// js/inviteBootGate.ts — the /?i= boot decision (spec N3). Pure ordered rules
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

// setup=install marks the Safari install-hop (app.js isSetupInstall): a
// DELIBERATELY fresh, identity-less boot mid-install-ceremony. Gate-wide
// exemption (Q8=C) — bouncing it to marketing would strand the install step.
export function hasSetupInstallParam() {
  try { return new URLSearchParams(window.location.search).get('setup') === 'install'; }
  catch { return false; }
}

// The env snapshot decideBootRedirect rules over (built by
// readBootRedirectContext; tests construct it directly).
export type BootRedirectContext = {
  token: string | null;
  telegramContext: boolean;
  stay: boolean;
  setupInstall: boolean;
  hasIdentity: boolean;
  standalone: boolean;
  telegramAndroid: boolean;
  deepLink: string | null;
  inAppBrowser: boolean;
  ios: boolean;
  sharingEnabled: boolean;
};

// Ordered; first match wins. Returns { kind: 'hop' | 'landing', url } or null
// (= proceed with today's boot).
export function decideBootRedirect(
  ctx: BootRedirectContext,
): { kind: 'hop' | 'landing'; url: string } | null {
  if (ctx.telegramContext) return null;               // 1 · Mini App boots itself
  if (ctx.stay) return null;                          // 2 · landing already chose
  if (ctx.setupInstall) return null;                  // 2b · Safari install-hop (Q8=C)
  if (ctx.hasIdentity || ctx.standalone) return null; // 3 · existing identity wins (C3)
  if (!ctx.token) {
    // Phase 3 (Q8=C): root is signed-out-landing / signed-in-app. EVERY fresh
    // tokenless boot goes to /about — detection no longer matters, which is
    // exactly what closes the undetectable-iOS bare blind spot. Funnel cost
    // (one hop + the iOS prompt) is under an explicit on-device evaluation
    // gate; revert = restore the `ctx.inAppBrowser ?` condition on this line.
    return { kind: 'landing', url: '/about' };
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

export function readBootRedirectContext(token: string | null | undefined): BootRedirectContext {
  return {
    token: token || null,
    telegramContext: isTelegramContext(),
    stay: hasStayParam(),
    setupInstall: hasSetupInstallParam(),
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
