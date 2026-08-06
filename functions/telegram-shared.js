// functions/telegram-shared.js — bot copy, keyboards, and id-format regexes
// shared between the webhook (/start, telegram.js) and the Mini App auth
// callable (first-open welcome DM, telegram-auth.js), kept here to avoid a
// telegram.js ↔ telegram-auth.js import cycle (telegram.js already imports
// ensureTelegramUser from telegram-auth.js).

// Id-format regexes live in shared/idFormats.js (one copy; the trust-boundary
// rationale is documented there). Re-exported so telegram.js / telegram-auth.js
// keep importing them from this module.
export { GROUP_ID_RE, UID_RE } from './_shared/idFormats.js';

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
/** @param {string | null | undefined} appUrl */
export function openAppKeyboard(appUrl) {
  return appUrl ? { reply_markup: { inline_keyboard: [[{ text: 'Open KnockKnock', web_app: { url: appUrl } }]] } } : {};
}

// Who owns an `inviteIndex/{token}` entry, in the ONE place that knows the two
// shapes it comes in. Five sinks ask this question — graduation and merge
// repoint an entry, the per-account and owned-group expunge sweeps release one
// — and every one of them runs under the Admin SDK, where the rules that scope
// an index write to its owner do not apply. A charset or shape assumption
// transcribed into five places is the defect this repo has already paid for
// three times (see "Why the enumerator rule exists").
//
// A MODERN entry is `{ scope, ownerPath, ownerUid }` (js/db/social.ts:44-54).
// A LEGACY entry is a bare uid STRING — what graduation wrote before it was
// fixed, and still present in any project that ran that code. The string IS the
// owner, so reading `ownerUid` off it yields undefined and would strand every
// legacy token its real owner tries to move or release.
//
// Callers compare BOTH fields: `ownerUid` answers "is this account's?", while
// `ownerPath` answers "does this resolve into the node being destroyed?" — and
// the owned-group sweep needs the second, because it deliberately releases
// tokens OTHER members issued.
/**
 * @param {unknown} entry
 * @returns {{ ownerUid: string | null, ownerPath: string | null }}
 */
export function inviteIndexOwnership(entry) {
  if (typeof entry === 'string') return { ownerUid: entry, ownerPath: null };
  const rec = /** @type {{ ownerUid?: unknown, ownerPath?: unknown } | null} */ (
    entry && typeof entry === 'object' ? entry : null
  );
  return {
    ownerUid: typeof rec?.ownerUid === 'string' ? rec.ownerUid : null,
    ownerPath: typeof rec?.ownerPath === 'string' ? rec.ownerPath : null,
  };
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
/**
 * @param {{ update: (path: string, writes: Record<string, unknown>) => Promise<unknown> }} deps
 * @param {Record<string, unknown>} writes
 */
export async function rootUpdate(deps, writes) {
  // BEFORE anything else: is each key the path it appears to be?
  //
  // A key is NOT parsed as a literal string. The SDK splits it on '/' and
  // DROPS empty segments, so `a//b`, `/a/b` and `a/b/` all name `a/b` — and
  // `users//` names the whole `users` node, not one account. The ancestor
  // check below compared raw strings, so a collapsed key passed it untouched
  // and was then re-targeted by the SDK to a path the check never considered:
  // two functions disagreeing about what path a key is (SEC-4 — the systemic
  // form of the collapse behind the codeIndex and ops-uid items).
  //
  // Such a key is REFUSED rather than silently rewritten to its collapsed
  // form. Rewriting would make this function agree with the SDK — which is all
  // the disagreement strictly requires — but it would still let
  // `users/${uid}` built from an empty uid land as a write to the whole
  // `users` node, with the overlap analysis now nodding along. An RTDB key
  // cannot be empty, so an empty segment is always a caller bug, and the
  // fail-closed answer for a bug in a destructive write-set is to send none of
  // it. (Verified against every caller: the whole functions suite is green
  // with this refusal in place.)
  for (const key of Object.keys(writes)) {
    const path = key.split('/').filter((segment) => segment !== '').join('/');
    if (path === '') {
      throw new Error(`rootUpdate: '${key}' names the database ROOT — refusing, an update there replaces everything`);
    }
    if (path !== key) {
      throw new Error(`rootUpdate: '${key}' has an empty segment — the SDK would write '${path}' instead, which is not the path this key names`);
    }
  }

  // Every key is now its own path, so the raw-string comparisons below are
  // right by construction rather than by luck.
  const keys = Object.keys(writes).sort();
  /** @type {Record<string, unknown>} */
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
