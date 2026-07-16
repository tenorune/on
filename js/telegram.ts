// js/telegram.ts — Telegram Mini App adapter (experimental, TELEGRAM_ENABLED).
// Detection + boot auth. Inside Telegram we ALWAYS auth from the webview's
// signed initData (never the stored local session): zero friction, always
// fresh, immune to webview-storage quirks. See spec 2026-07-02.
import { signInWithCustomToken } from 'firebase/auth';
import { TELEGRAM_ENABLED } from './features.js';
import { auth, callValidateTelegram } from './firebase-config.js';
import { whenRtdbAuthReady } from './auth.js';
import { getUser } from './db.js';
import { NAME_CAP } from '../shared/limits.js';

// Returns the `Telegram.WebApp` object (or null). The seam stays `any` on
// purpose: `window.Telegram` isn't in the DOM lib types, and consumers across the
// Telegram feature (telegramChrome, telegramFirstRun, telegramSettings, …) touch a
// wide slice of the WebApp API — typing it precisely here is a separate effort.
export function tgWebApp() {
  const w = (typeof window !== 'undefined' ? window : undefined) as any;
  return (w && w.Telegram && w.Telegram.WebApp) || null;
}

export function isTelegramContext() {
  return TELEGRAM_ENABLED && !!tgWebApp()?.initData;
}

let _linkState: { linked: boolean } | null = null;

// THE "is this Telegram session linked" predicate — the one place the linked
// definition is spelled (W3-A CL#3). Static within a session: link, unlink,
// and graduation all reload. NOTE: js/notifyChannel.js isLinked's WEB arm
// (prefs?.telegram != null) is a different, prefs-driven signal and part of
// the three-reader notify-channel contract — it deliberately does NOT use this.
export function isTelegramLinked() {
  return _linkState?.linked === true;
}

// The 40-char creatorLabel cap lives in shared/limits.js (rules parity pinned
// by tests/name-cap-invariant.test.js). Trim-then-slice order is deliberate
// here — see the clampName note in shared/limits.js.

// The Telegram user's first name (from the unsigned initDataUnsafe),
// display-ready: trimmed, capped to the DB label limit. Used as the default
// label when auto-creating a personal invite and as the redeemer name.
// Empty string outside Telegram or when the client withholds the user object.
export function telegramFirstName() {
  return (tgWebApp()?.initDataUnsafe?.user?.first_name || '').trim().slice(0, NAME_CAP);
}

// Boot auth for the Telegram context. Returns the same { identity, isNew }
// shape app.js's ensureIdentity produces; recoveryCode is null (a Telegram-
// derived account has no phrase until the user links one).
export async function ensureTelegramIdentity() {
  const { token, linked, created } = (
    await callValidateTelegram(tgWebApp().initData)
  ) as { token: string; linked: boolean; created: boolean };
  await signInWithCustomToken(auth, token);
  await whenRtdbAuthReady();
  _linkState = { linked };
  // currentUser is set by the awaited sign-in above.
  const userId = (auth.currentUser as import('firebase/auth').User).uid;
  const user = await getUser(userId); // presence is bootstrapped server-side
  // `code` rides on the users/{uid} node but isn't in the PresenceNode contract; read via cast.
  const code = (user as { code?: string } | null)?.code ?? '';
  return { identity: { userId, code, recoveryCode: null }, isNew: created === true };
}

// The ONE t.me share-intent builder (W3-A CL#5). Caption-spacing rule folded
// in: desktop clients (e.g. macOS) concatenate the shared url and caption with
// no separator, so the link butts straight against the text; iOS inserts one.
// Non-iOS AND unknown/absent platform (the web share opens in whatever client
// the recipient runs) get a leading newline — never worse than today.
export function buildTelegramShareUrl(url: string, text = '', { platform }: { platform?: string } = {}) {
  const caption = text && platform !== 'ios' ? `\n${text}` : text;
  return `https://t.me/share/url?url=${encodeURIComponent(url)}${caption ? `&text=${encodeURIComponent(caption)}` : ''}`;
}

// Open Telegram's native share sheet for a link (invite links, share code).
// Silent no-op outside Telegram or on old clients without openTelegramLink.
export function openTelegramShare(url: string | undefined, text = '') {
  const wa = tgWebApp();
  if (!wa?.openTelegramLink) return;
  // url forwarded as-is (runtime unchanged); cast for the strict builder param.
  wa.openTelegramLink(buildTelegramShareUrl(url as string, text, { platform: wa.platform }));
}
