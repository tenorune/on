// functions/index.js — RTDB-triggered presence notifiers.
import { randomBytes } from 'crypto';
import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getMessaging } from 'firebase-admin/messaging';
import { onValueCreated, onValueWritten } from 'firebase-functions/v2/database';
import { setGlobalOptions } from 'firebase-functions/v2';
import { handleKnock, handleCall, handleAvailability, handleGroupOverrideChange, handleInvite, handleFollowRequest, availabilityRelevantOverrideChange } from './notifier.js';
import { onCall as httpsOnCall, onRequest } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { validateRecoveryHandler } from './auth.js';
import { handleMemberRemoved } from './group-cleanup.js';
import { resolveInvitePreviewHandler } from './invites.js';
import { joinGroupHandler } from './group-join.js';
import { handleCallCleanup, handleCallSweep, CALL_TTL_MS } from './call-cleanup.js';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { validateTelegramHandler, linkTelegramHandler, unlinkTelegramHandler, graduateTelegramHandler, mintTelegramLinkTokenHandler, redeemTelegramLinkTokenHandler } from './telegram-auth.js';
import { buildNotificationKeyboard, handleUpdate, webhookAuthorized, botCommandsPayload } from './telegram.js';

// Pin all functions to the RTDB's region. A 2nd-gen RTDB trigger MUST run in the
// same region as the database instance. Region is per-project config: the Firebase
// CLI auto-loads functions/.env.<projectId> at deploy (based on --project), so each
// environment sets FUNCTIONS_REGION to match its own RTDB. Defaults to the dev
// region (europe-west1). See functions/.env.example.
setGlobalOptions({ region: process.env.FUNCTIONS_REGION || 'europe-west1' });

initializeApp();

// Resolve the admin SDK singletons once at module load (initializeApp has run),
// rather than per trigger invocation inside makeDeps.
const db = getDatabase();
const messaging = getMessaging();

// Raw Bot API call. Returns the result object, or null on any failure (logged).
// Node 18+ global fetch; no SDK dependency.
/** @param {string} method @param {object} payload */
async function tgApi(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!body || !body.ok) {
    console.error(`[telegram] ${method} failed: HTTP ${res.status} ${JSON.stringify(body?.description || body)}`);
    return null;
  }
  return body.result;
}

// The one sendMessage lambda: the auth callable's welcome DM and the webhook's
// replies go through the same call shape (tgApi reads the env token lazily).
const tgSendMessage = (/** @type {string} */ chatId, /** @type {string} */ text, extra = {}) => tgApi('sendMessage', { chat_id: chatId, text, ...extra });

// The RTDB adapter quintet every handler family shares — ONE definition of
// how paths map onto the Admin SDK, spread into the notifier deps, the
// Telegram-auth deps, and the webhook deps below.
function makeDbDeps() {
  return {
    now: () => Date.now(),
    getVal: async (/** @type {string} */ path) => (await db.ref(path).get()).val(),
    set: async (/** @type {string} */ path, /** @type {unknown} */ value) => { await db.ref(path).set(value); },
    update: async (/** @type {string} */ path, /** @type {Record<string, unknown>} */ obj) => { await db.ref(path).update(obj); },
    transaction: async (/** @type {string} */ path, /** @type {(current: any) => unknown} */ fn) => {
      const res = await db.ref(path).transaction(fn);
      return { committed: res.committed };
    },
  };
}

function makeDeps() {
  return {
    ...makeDbDeps(),
    send: async (/** @type {string[]} */ tokens, /** @type {{ title: string, body: string }} */ message, /** @type {Record<string, string> | undefined} */ data) => {
      const res = await messaging.sendEachForMulticast({
        tokens,
        // Data-only message (no `notification` block): the service worker fully
        // controls display via showNotification, so a focused client can suppress
        // the toast (foreground de-dupe). A `notification` block would make the
        // browser auto-display and defeat that. The SW reads these flat keys.
        data: {
          title: message.title || '',
          body: message.body || '',
          // Cast: every handler passes data; the deps signature keeps it
          // optional only because sendToUser's own param is optional.
          ...Object.fromEntries(Object.entries(/** @type {Record<string, string>} */ (data)).map(([k, v]) => [k, String(v)])),
        },
      });
      /** @type {string[]} */
      const failedTokens = [];
      res.responses.forEach((r, i) => {
        if (!r.success) {
          console.error(`[notify] FCM error token[${i}]: ${r.error?.code || ''} ${r.error?.message || ''}`);
          if (/registration-token-not-registered|invalid-registration-token/.test(r.error?.code || '')) {
            failedTokens.push(tokens[i]);
          }
        }
      });
      return { failedTokens };
    },
    // Present only when the bot is configured; sendToUser treats absence as
    // "FCM only". message.title carries the whole notification text (body is '').
    sendTelegram: process.env.TELEGRAM_BOT_TOKEN
      ? async (/** @type {unknown} */ chatId, /** @type {{ title: string, body: string }} */ message, /** @type {Record<string, string> | undefined} */ data) => {
          const keyboard = buildNotificationKeyboard(data, process.env.TELEGRAM_APP_URL || '');
          const result = await tgApi('sendMessage', {
            chat_id: chatId,
            text: message.title || '',
            ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
          });
          return !!result;
        }
      : null,
  };
}

export const onKnock = onValueCreated('/knocks/{recipientId}/{senderId}', (event) => {
  return handleKnock(makeDeps(), event.params.recipientId, event.params.senderId, event.data.val());
});

export const onCall = onValueWritten('/calls/{uid}', (event) => {
  const after = event.data.after.val();
  const before = event.data.before.val();
  // A mailbox was DELETED → reap the counterpart if it still references this
  // user, so the peer isn't stranded on the canvas unable to clear their own
  // node (the rules deny that once ours is gone). See call-cleanup.js.
  if (!after && before) return handleCallCleanup(makeDeps(), event.params.uid, before);
  // Only notify the callee on a fresh unanswered ring (calls/{callee}.from set).
  if (!after || !after.from || after.answered) return null;
  if (before && before.from === after.from) return null;
  return handleCall(makeDeps(), event.params.uid, after.from);
});

// Hourly sweep of stale call mailboxes. Catches the case onCall's deletion
// reaper can't: BOTH clients died mid-call without a clean hangup, so neither
// node was ever deleted and no deletion event fires. Nulls any mailbox older
// than CALL_TTL_MS (or malformed); each null then trips onCall to fan out its
// counterpart. See call-cleanup.js.
export const sweepStaleCalls = onSchedule('every 60 minutes', async () => {
  const swept = await handleCallSweep(makeDbDeps(), CALL_TTL_MS);
  if (swept.length) console.log(`[calls] swept ${swept.length} stale mailbox(es)`);
});

// Narrowed to presence/availableUntil so we're not invoked on every write to
// other presence fields (status, statusColor, paletteKey, code, lastSeen).
// onValueWritten covers create (going available from null), update (re-up), and
// delete (going offline); the handler reads the sibling `status` to confirm.
export const onAvailability = onValueWritten('/users/{uid}/presence/availableUntil', (event) => {
  return handleAvailability(makeDeps(), event.params.uid, event.data.before.val(), event.data.after.val());
});

// A group membership node was written — ONE trigger for the whole member
// node. RTDB triggers match any write at or below their path, so the previous
// split (an override-leaf trigger + a member-node trigger) doubled every
// statusOverride write into a second, no-op invocation (audit F7).
//  - deletion (leave / kick / teardown): revoke the departed member's coarse
//    location cell so it can't outlive membership (handleMemberRemoved no-ops
//    on create/update);
//  - statusOverride transition: notify opted-in co-members. Gated on a real
//    override change so displayName/join writes and appearance-only override
//    edits skip the notify path (and its presence read) — matching the old
//    leaf trigger, which also fired on member deletion (the leaf vanishes
//    with the node), preserved here.
export const onMemberWritten = onValueWritten('/groups/{groupId}/members/{memberUid}', async (event) => {
  const before = event.data.before.val();
  const after = event.data.after.val();
  const { groupId, memberUid } = event.params;
  await handleMemberRemoved(makeDbDeps(), groupId, memberUid, before, after);
  const beforeOv = (before && before.statusOverride) || null;
  const afterOv = (after && after.statusOverride) || null;
  if (availabilityRelevantOverrideChange(beforeOv, afterOv)) {
    await handleGroupOverrideChange(makeDeps(), groupId, memberUid, beforeOv, afterOv);
  }
});

// A pending group invite was created in the invitee's mailbox. onValueCreated
// (not Written) so a resend-overwrite of the same {groupId} key doesn't re-fire;
// a re-invite after decline (key deleted, then recreated) does.
export const onInvite = onValueCreated('/pendingInvites/{inviteeUid}/{groupId}', (event) => {
  return handleInvite(makeDeps(), event.params.inviteeUid, event.params.groupId, event.data.val());
});

// A follow request was created in the target's mailbox. onValueCreated (not
// Written) so a re-request overwrite of the same {requesterUid} key doesn't
// re-fire; a re-request after a decline (key deleted, then recreated) does.
export const onFollowRequest = onValueCreated('/followRequests/{targetUid}/{requesterUid}', (event) => {
  return handleFollowRequest(makeDeps(), event.params.targetUid, event.params.requesterUid, event.data.val());
});

// Shared, instance-independent rate limiter for validateRecovery (#179 S5a).
// Fixed-window counters in RTDB under the server-only notifierState/* subtree
// (rules deny all client read/write). Per-uid caps brute-forcing one account;
// the global counter is a backstop against mass guessing. Keyed by the derived
// uid (not IP) so X-Forwarded-For spoofing can't reset the window.
const RECOVERY_PER_UID_LIMIT = 10;
const RECOVERY_GLOBAL_LIMIT = 60;
const RECOVERY_WINDOW_MS = 60 * 1000;

/**
 * @param {import('firebase-admin/database').Reference} ref
 * @param {number} limit
 * @param {number} now
 * @param {number} windowMs
 */
async function bumpFixedWindow(ref, limit, now, windowMs) {
  let allowed = true;
  await ref.transaction((cur) => {
    if (!cur || now - cur.windowStart >= windowMs) { allowed = true; return { windowStart: now, count: 1 }; }
    if (cur.count >= limit) { allowed = false; return cur; } // over cap — no change
    allowed = true;
    return { windowStart: cur.windowStart, count: cur.count + 1 };
  });
  return allowed;
}

/**
 * @param {import('firebase-admin/database').Database} db
 * @param {string} uid
 */
async function allowRecoveryAttempt(db, uid) {
  const now = Date.now();
  if (!(await bumpFixedWindow(db.ref(`notifierState/recoveryRate/perUid/${uid}`), RECOVERY_PER_UID_LIMIT, now, RECOVERY_WINDOW_MS))) return false;
  return bumpFixedWindow(db.ref('notifierState/recoveryRate/global'), RECOVERY_GLOBAL_LIMIT, now, RECOVERY_WINDOW_MS);
}

// Unauthenticated callable: the user isn't signed in yet. Mints a Firebase
// custom token for uid = sha256(recoveryCode) so the client can sign in. Runs in
// the same region as the rest (setGlobalOptions above). See auth.js / R1 spec.
export const validateRecovery = httpsOnCall((request) =>
  validateRecoveryHandler(request, {
    allowAttempt: (/** @type {string} */ uid) => allowRecoveryAttempt(getDatabase(), uid),
    mintToken: (/** @type {string} */ uid) => getAuth().createCustomToken(uid),
  }));

// Unauthenticated callable: the welcome screen names the inviter/group before the
// new user has a session, but invite nodes are gated by `auth != null`. Resolves
// the preview via the Admin SDK (bypasses rules), returning only preview-safe
// fields. Invite tokens are 128-bit, so enumeration is infeasible. See invites.js.
export const resolveInvitePreview = httpsOnCall((request) =>
  resolveInvitePreviewHandler(request, {
    getVal: (/** @type {string} */ path) => db.ref(path).get().then((snap) => snap.val()),
  }));

// Authenticated callable: server-authoritative group join (Fix 2, option A).
// Validates a real entitlement (invite token or pending invite) before writing
// the member node via Admin SDK, closing the #288 self-join surface once the
// members .write rule is tightened (see database.rules.json). See group-join.js.
export const joinGroup = httpsOnCall((request) =>
  joinGroupHandler(request, {
    now: () => Date.now(),
    getVal: (/** @type {string} */ path) => db.ref(path).get().then((snap) => snap.val()),
    set: (/** @type {string} */ path, /** @type {unknown} */ value) => db.ref(path).set(value),
    transaction: async (/** @type {string} */ path, /** @type {(c: any) => unknown} */ fn) => {
      const res = await db.ref(path).transaction(fn);
      return { committed: res.committed };
    },
  }));

// ── Telegram (experimental; inert unless TELEGRAM_BOT_TOKEN is set in the
// functions env — see functions/.env.example and docs/telegram-setup.md) ──────
function makeTelegramAuthDeps() {
  return {
    ...makeDbDeps(),
    botToken: process.env.TELEGRAM_BOT_TOKEN || null,
    // Server secret keying the Telegram-derived uid so it's not computable from
    // the public tgId (F1 #287). Must be set alongside the bot token.
    uidSecret: process.env.TELEGRAM_UID_SECRET || null,
    appUrl: process.env.TELEGRAM_APP_URL || '',
    mintToken: (/** @type {string} */ uid) => getAuth().createCustomToken(uid),
    randomToken: () => randomBytes(16).toString('base64url'),
    allowAttempt: (/** @type {string} */ uid) => allowRecoveryAttempt(getDatabase(), uid),
    setAuthEmail: setTelegramAuthEmail,
    // First-open welcome DM (validateTelegramHandler). Null when the bot isn't
    // configured, so the handler skips it; mirrors the webhook's tg.sendMessage.
    sendMessage: process.env.TELEGRAM_BOT_TOKEN ? tgSendMessage : null,
  };
}

// Create-or-update: the Auth record doesn't exist until the client's first
// signInWithCustomToken, so pre-create it; later re-bootstraps hit update.
/** @param {string} uid @param {string} email */
async function setTelegramAuthEmail(uid, email) {
  const auth = getAuth();
  try {
    await auth.updateUser(uid, { email });
  } catch (e) {
    if (/** @type {any} */ (e)?.code === 'auth/user-not-found') await auth.createUser({ uid, email });
    else throw e;
  }
}

export const validateTelegram = httpsOnCall((request) => validateTelegramHandler(request, makeTelegramAuthDeps()));
export const linkTelegram = httpsOnCall((request) => linkTelegramHandler(request, makeTelegramAuthDeps()));
export const unlinkTelegram = httpsOnCall((request) => unlinkTelegramHandler(request, makeTelegramAuthDeps()));
// Graduation (spec §7): migrate an unlinked derived account to its phrase uid.
export const graduateTelegram = httpsOnCall((request) => graduateTelegramHandler(request, makeTelegramAuthDeps()));
export const mintTelegramLinkToken = httpsOnCall((request) => mintTelegramLinkTokenHandler(request, makeTelegramAuthDeps()));
export const redeemTelegramLinkToken = httpsOnCall((request) => redeemTelegramLinkTokenHandler(request, makeTelegramAuthDeps()));

// Telegram bot webhook. Always 200s on authorized requests (Telegram retries
// non-200s aggressively); errors are logged inside handleUpdate. Inert unless
// TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET are configured.
export const telegramWebhook = onRequest(async (req, res) => {
  if (!process.env.TELEGRAM_BOT_TOKEN
      || !webhookAuthorized(req.get('x-telegram-bot-api-secret-token'), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    res.status(403).send('forbidden');
    return;
  }
  const replyPayload = await handleUpdate({
    ...makeDbDeps(),
    // The /start bootstrap derives the uid via ensureTelegramUser too (F1 #287).
    uidSecret: process.env.TELEGRAM_UID_SECRET || null,
    appUrl: process.env.TELEGRAM_APP_URL || '',
    setAuthEmail: setTelegramAuthEmail,
    tg: {
      sendMessage: tgSendMessage,
      answerCallbackQuery: (/** @type {string} */ id, /** @type {string} */ text) => tgApi('answerCallbackQuery', { callback_query_id: id, text }),
      editMessageText: (/** @type {string} */ chatId, /** @type {number} */ messageId, /** @type {string} */ text, extra = {}) =>
        tgApi('editMessageText', { chat_id: chatId, message_id: messageId, text, ...extra }),
    },
  }, req.body);
  // F#5 webhook-reply: a command's terminal reply rides the webhook response
  // (one Bot API method per update, fire-and-forget) instead of a separate
  // sendMessage HTTPS call. Nested objects must be JSON-serialized in a
  // webhook reply (Bot API convention), hence the reply_markup stringify.
  if (replyPayload) {
    /** @type {Record<string, any>} */
    const method = { method: 'sendMessage', ...replyPayload };
    if (method.reply_markup) method.reply_markup = JSON.stringify(method.reply_markup);
    res.status(200).json(method);
    return;
  }
  res.status(200).send('ok');
});

// Deploy-time menu registration (B#11 / Spec 2 Task 6): pushes the Telegram
// "/" command menu from COMMANDS — the same source of truth that derives
// HELP_TEXT — via the Bot API's setMyCommands. Replaces the old manual
// BotFather "/setcommands" paste (docs/telegram-setup.md), which could drift
// from /help. Run once per deploy, at the A5 redeploy step. Guarded the same
// way as telegramWebhook (token configured + shared-secret header) since it's
// a mutating, unauthenticated-by-default HTTP endpoint; the deploy step must
// pass the x-telegram-bot-api-secret-token header (see docs/telegram-setup.md).
export const setBotCommands = onRequest(async (req, res) => {
  if (!process.env.TELEGRAM_BOT_TOKEN) { res.status(503).send('bot not configured'); return; }
  if (!webhookAuthorized(req.get('x-telegram-bot-api-secret-token'), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    res.status(403).send('forbidden');
    return;
  }
  await tgApi('setMyCommands', { commands: botCommandsPayload() });
  res.status(200).send('ok');
});
