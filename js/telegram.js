// js/telegram.js — Telegram Mini App adapter (experimental, TELEGRAM_ENABLED).
// Detection + boot auth. Inside Telegram we ALWAYS auth from the webview's
// signed initData (never the stored local session): zero friction, always
// fresh, immune to webview-storage quirks. See spec 2026-07-02.
import { signInWithCustomToken } from 'firebase/auth';
import { TELEGRAM_ENABLED } from './features.js';
import { auth, callValidateTelegram } from './firebase-config.js';
import { whenRtdbAuthReady } from './auth.js';
import { getUser } from './db.js';

export function tgWebApp() {
  return (typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp) || null;
}

export function isTelegramContext() {
  return TELEGRAM_ENABLED && !!tgWebApp()?.initData;
}

let _linkState = null;
// { linked } from the last ensureTelegramIdentity() — telegramSettings reads it.
export function telegramLinkState() {
  return _linkState;
}

// THE "is this Telegram session linked" predicate — the one place the linked
// definition is spelled (W3-A CL#3). Static within a session: link, unlink,
// and graduation all reload. NOTE: js/notifyChannel.js isLinked's WEB arm
// (prefs?.telegram != null) is a different, prefs-driven signal and part of
// the three-reader notify-channel contract — it deliberately does NOT use this.
export function isTelegramLinked() {
  return _linkState?.linked === true;
}

// The Telegram user's first name (from the unsigned initDataUnsafe). Used as the
// default label when auto-creating a personal invite for a one-tap share.
// Empty string outside Telegram or when the client withholds the user object.
export function telegramFirstName() {
  return tgWebApp()?.initDataUnsafe?.user?.first_name || '';
}

// Boot auth for the Telegram context. Returns the same { identity, isNew }
// shape app.js's ensureIdentity produces; recoveryCode is null (a Telegram-
// derived account has no phrase until the user links one).
export async function ensureTelegramIdentity() {
  const { token, linked, created } = await callValidateTelegram(tgWebApp().initData);
  await signInWithCustomToken(auth, token);
  await whenRtdbAuthReady();
  _linkState = { linked };
  const userId = auth.currentUser.uid;
  const user = await getUser(userId); // presence is bootstrapped server-side
  return { identity: { userId, code: user?.code ?? '', recoveryCode: null }, isNew: created === true };
}

// The ONE t.me share-intent builder (W3-A CL#5). Caption-spacing rule folded
// in: desktop clients (e.g. macOS) concatenate the shared url and caption with
// no separator, so the link butts straight against the text; iOS inserts one.
// Non-iOS AND unknown/absent platform (the web share opens in whatever client
// the recipient runs) get a leading newline — never worse than today.
export function buildTelegramShareUrl(url, text = '', { platform } = {}) {
  const caption = text && platform !== 'ios' ? `\n${text}` : text;
  return `https://t.me/share/url?url=${encodeURIComponent(url)}${caption ? `&text=${encodeURIComponent(caption)}` : ''}`;
}

// Open Telegram's native share sheet for a link (invite links, share code).
// Silent no-op outside Telegram or on old clients without openTelegramLink.
export function openTelegramShare(url, text = '') {
  const wa = tgWebApp();
  if (!wa?.openTelegramLink) return;
  wa.openTelegramLink(buildTelegramShareUrl(url, text, { platform: wa.platform }));
}
