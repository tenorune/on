// functions/notifier.js — delivery + per-event handlers. Deps are injected.
import { wantsKnock, wantsCall, wantsAvailability, becameAvailable, withinCooldown, buildMessage } from './presence-core.js';

const AVAIL_COOLDOWN_MS = 5 * 60 * 1000;

export async function sendToUser(deps, uid, message, data) {
  const tokensMap = await deps.getVal(`userPrefs/${uid}/pushTokens`);
  const tokens = tokensMap ? Object.keys(tokensMap) : [];
  if (tokens.length === 0) return;
  const { failedTokens } = await deps.send(tokens, message, data);
  if (failedTokens && failedTokens.length) {
    const nulls = {};
    for (const t of failedTokens) nulls[t] = null;
    await deps.update(`userPrefs/${uid}/pushTokens`, nulls);
  }
}

export async function resolveName(deps, viewerUid, targetUid) {
  const follow = await deps.getVal(`userPrefs/${viewerUid}/following/${targetUid}`);
  if (follow && follow.label) return follow.label;
  const code = await deps.getVal(`users/${targetUid}/code`);
  if (code) return code;
  return 'Someone';
}

export async function handleKnock(deps, recipientId, senderId, record) {
  const prefs = await deps.getVal(`userPrefs/${recipientId}/notify/${senderId}`);
  if (!wantsKnock(prefs)) return;
  const name = await resolveName(deps, recipientId, senderId);
  const data = { type: 'knock', targetUid: senderId };
  if (record && record.contextGroupId) data.contextGroupId = record.contextGroupId;
  await sendToUser(deps, recipientId, buildMessage('knock', name), data);
}

export async function handleCall(deps, callerId, callState) {
  if (!callState || !callState.calleeId) return;
  const calleeId = callState.calleeId;
  const prefs = await deps.getVal(`userPrefs/${calleeId}/notify/${callerId}`);
  if (!wantsCall(prefs)) return;
  const name = await resolveName(deps, calleeId, callerId);
  await sendToUser(deps, calleeId, buildMessage('call', name), { type: 'call', targetUid: callerId });
}

export async function handleAvailability(deps, uid, beforeNode, afterNode) {
  const now = deps.now();
  if (!becameAvailable(beforeNode, afterNode, now)) return;
  const lastTs = await deps.getVal(`notifierState/availability/${uid}`);
  if (withinCooldown(lastTs, now, AVAIL_COOLDOWN_MS)) return;
  await deps.update('notifierState/availability', { [uid]: now });

  const followers = await deps.getVal(`users/${uid}/followers`);
  const followerIds = followers ? Object.keys(followers) : [];
  for (const fid of followerIds) {
    const prefs = await deps.getVal(`userPrefs/${fid}/notify/${uid}`);
    if (!wantsAvailability(prefs)) continue;
    const name = await resolveName(deps, fid, uid);
    await sendToUser(deps, fid, buildMessage('availability', name), { type: 'availability', targetUid: uid });
  }
}
