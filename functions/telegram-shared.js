// functions/telegram-shared.js — bot copy, keyboards, and id-format regexes
// shared between the webhook (/start, telegram.js) and the Mini App auth
// callable (first-open welcome DM, telegram-auth.js), kept here to avoid a
// telegram.js ↔ telegram-auth.js import cycle (telegram.js already imports
// ensureTelegramUser from telegram-auth.js).

// Group ids are 8 chars of A-Z0-9 (client generateGroupId; database.rules.json
// pins the same format on client knock writes). callback_query.data is
// attacker-controllable, and the bot's writes are Admin-SDK writes that bypass
// the rules — so gid segments must re-check the format server-side. ONE copy
// for all of functions/.
export const GROUP_ID_RE = /^[A-Z0-9]{8}$/;

// App uids are SHA-256 hex truncated to 32 chars (js/identity.js
// deriveUserIdFromRecoveryCode; telegram-auth.js deriveTelegramUid) — the same
// trust boundary as GROUP_ID_RE: callback args become Admin-SDK path segments.
export const UID_RE = /^[0-9a-f]{32}$/;

// First-contact welcome (spec §2). Sent by /start to a stranger AND reused
// verbatim as the one-time welcome DM on first Mini App open, so an invited user
// who arrived via a deep link and never typed /start still gets a bot chat —
// their persistent re-entry point (Menu Button + the Open button below).
export const WELCOME_STRANGER_TEXT =
  "Welcome to KnockKnock — for when you're around and open to company.\n\n"
  + 'Everything starts in the app — tap below.\n\n'
  + "Once you're set up, you can also knock and set your status right from this chat — /help shows how.";

// Inline keyboard with a single "Open KnockKnock" Mini App button. Empty (no
// reply_markup) when the app URL is unconfigured, so the message still sends.
export function openAppKeyboard(appUrl) {
  return appUrl ? { reply_markup: { inline_keyboard: [[{ text: 'Open KnockKnock', web_app: { url: appUrl } }]] } } : {};
}

// The ONE way functions/ issues a multi-path root update. Real RTDB rejects
// an update('/', {...}) where any key path is an ancestor of another — a
// contract every hand-built write-map here relies on. rootUpdate makes it
// explicit: a null descendant under a null ancestor is REDUNDANT (the
// wholesale delete already covers it) and is dropped, so e.g. a residue
// path under an account subtree that is itself being deleted can't blow up
// the whole update; any other overlap is a real conflict (the deep write
// and the node write race for the same data) and throws before anything
// is sent to the database.
export async function rootUpdate(deps, writes) {
  const keys = Object.keys(writes).sort();
  const kept = {};
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    // Sorted order puts every ancestor of `key` before it; two written
    // ancestors of the same key would already have flagged each other, so
    // the first hit is THE written ancestor.
    let ancestor = null;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (key.startsWith(`${keys[j]}/`)) { ancestor = keys[j]; break; }
    }
    if (ancestor === null) { kept[key] = writes[key]; continue; }
    if (writes[ancestor] === null && writes[key] === null) continue; // redundant delete
    throw new Error(`rootUpdate: '${key}' overlaps ancestor '${ancestor}' — RTDB rejects overlapping update paths`);
  }
  if (Object.keys(kept).length) await deps.update('/', kept);
}
