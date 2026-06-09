// functions/index.js — RTDB-triggered presence notifiers.
import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getMessaging } from 'firebase-admin/messaging';
import { onValueCreated, onValueWritten } from 'firebase-functions/v2/database';
import { setGlobalOptions } from 'firebase-functions/v2';
import { handleKnock, handleCall, handleAvailability, handleGroupOverrideChange, handleInvite } from './notifier.js';

// Pin all functions to the RTDB's region. A 2nd-gen RTDB trigger MUST run in the
// same region as the database instance. Region is per-project config: the Firebase
// CLI auto-loads functions/.env.<projectId> at deploy (based on --project), so each
// environment sets FUNCTIONS_REGION to match its own RTDB. Defaults to the dev
// region (europe-west1). See functions/.env.example.
setGlobalOptions({ region: process.env.FUNCTIONS_REGION || 'europe-west1' });

initializeApp();

function makeDeps() {
  const db = getDatabase();
  return {
    now: () => Date.now(),
    getVal: async (path) => (await db.ref(path).get()).val(),
    update: async (path, obj) => { await db.ref(path).update(obj); },
    send: async (tokens, message, data) => {
      const res = await getMessaging().sendEachForMulticast({
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

export const onKnock = onValueCreated('/users/{recipientId}/knocks/{senderId}', (event) => {
  return handleKnock(makeDeps(), event.params.recipientId, event.params.senderId, event.data.val());
});

export const onCall = onValueWritten('/users/{callerId}/callState', (event) => {
  const after = event.data.after.val();
  const before = event.data.before.val();
  // Only on a newly-started call (callState appears or changes callee).
  if (!after || !after.calleeId) return null;
  if (before && before.calleeId === after.calleeId) return null;
  return handleCall(makeDeps(), event.params.callerId, after);
});

// Narrowed to the availability field so we're not invoked on every knock /
// callState / lastSeen write to the user node. onValueWritten covers create
// (going available from null), update (re-up), and delete (going offline);
// the handler reads the sibling `status` to confirm.
export const onAvailability = onValueWritten('/users/{uid}/availableUntil', (event) => {
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
