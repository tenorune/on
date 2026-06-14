// functions/index.js — RTDB-triggered presence notifiers.
import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getMessaging } from 'firebase-admin/messaging';
import { onValueCreated, onValueWritten } from 'firebase-functions/v2/database';
import { setGlobalOptions } from 'firebase-functions/v2';
import { handleKnock, handleCall, handleAvailability, handleGroupOverrideChange, handleInvite, handleFollowRequest } from './notifier.js';
import { onCall as httpsOnCall } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { validateRecoveryHandler } from './auth.js';

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

function makeDeps() {
  return {
    now: () => Date.now(),
    getVal: async (path) => (await db.ref(path).get()).val(),
    update: async (path, obj) => { await db.ref(path).update(obj); },
    send: async (tokens, message, data) => {
      const res = await messaging.sendEachForMulticast({
        tokens,
        // Data-only message (no `notification` block): the service worker fully
        // controls display via showNotification, so a focused client can suppress
        // the toast (foreground de-dupe). A `notification` block would make the
        // browser auto-display and defeat that. The SW reads these flat keys.
        data: {
          title: message.title || '',
          body: message.body || '',
          ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
        },
      });
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
  };
}

export const onKnock = onValueCreated('/knocks/{recipientId}/{senderId}', (event) => {
  return handleKnock(makeDeps(), event.params.recipientId, event.params.senderId, event.data.val());
});

export const onCall = onValueWritten('/calls/{uid}', (event) => {
  const after = event.data.after.val();
  const before = event.data.before.val();
  // Only notify the callee on a fresh unanswered ring (calls/{callee}.from set).
  if (!after || !after.from || after.answered) return null;
  if (before && before.from === after.from) return null;
  return handleCall(makeDeps(), event.params.uid, after.from);
});

// Narrowed to presence/availableUntil so we're not invoked on every write to
// other presence fields (status, statusColor, paletteKey, code, lastSeen).
// onValueWritten covers create (going available from null), update (re-up), and
// delete (going offline); the handler reads the sibling `status` to confirm.
export const onAvailability = onValueWritten('/users/{uid}/presence/availableUntil', (event) => {
  return handleAvailability(makeDeps(), event.params.uid, event.data.before.val(), event.data.after.val());
});

// A group member's per-group override changed. handleGroupOverrideChange computes
// whether their EFFECTIVE in-group availability flipped off→on (reading their primary
// for the override-off case) and notifies opted-in co-members. Same RTDB region as
// the others (setGlobalOptions above).
export const onMemberOverride = onValueWritten('/groups/{groupId}/members/{memberUid}/statusOverride', (event) => {
  return handleGroupOverrideChange(
    makeDeps(),
    event.params.groupId,
    event.params.memberUid,
    event.data.before.val(),
    event.data.after.val(),
  );
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
    allowAttempt: (uid) => allowRecoveryAttempt(getDatabase(), uid),
    mintToken: (uid) => getAuth().createCustomToken(uid),
  }));
