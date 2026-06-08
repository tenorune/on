// functions/notifier.js — delivery + per-event handlers. Deps are injected.
import { wantsKnock, wantsCall, wantsAvailability, availabilityTurnedOn, withinCooldown, buildMessage } from './presence-core.js';

const AVAIL_COOLDOWN_MS = 5 * 60 * 1000;

export async function sendToUser(deps, uid, message, data) {
  const tokensMap = await deps.getVal(`userPrefs/${uid}/pushTokens`);
  const tokens = tokensMap ? Object.keys(tokensMap) : [];
  if (tokens.length === 0) return false;
  const { failedTokens } = await deps.send(tokens, message, data);
  if (failedTokens && failedTokens.length) {
    const nulls = {};
    for (const t of failedTokens) nulls[t] = null;
    await deps.update(`userPrefs/${uid}/pushTokens`, nulls);
  }
  // Delivered if at least one token wasn't rejected.
  return (failedTokens?.length || 0) < tokens.length;
}

export async function resolveName(deps, viewerUid, targetUid) {
  const follow = await deps.getVal(`userPrefs/${viewerUid}/following/${targetUid}`);
  if (follow && follow.label) return follow.label;
  const code = await deps.getVal(`users/${targetUid}/code`);
  if (code) return code;
  return 'Someone';
}

export async function resolveGroupMemberName(deps, groupId, uid) {
  const displayName = await deps.getVal(`groups/${groupId}/members/${uid}/displayName`);
  if (displayName) return displayName;
  const code = await deps.getVal(`users/${uid}/code`);
  if (code) return code;
  return 'Someone';
}

export async function handleKnock(deps, recipientId, senderId, record) {
  const prefs = await deps.getVal(`userPrefs/${recipientId}/notify/${senderId}`);
  if (!wantsKnock(prefs)) return;
  const groupId = record && record.contextGroupId;
  if (groupId) {
    const name = await resolveGroupMemberName(deps, groupId, senderId);
    const group = await deps.getVal(`groups/${groupId}/name`);
    await sendToUser(deps, recipientId,
      buildMessage('knock', name, { group: group || undefined }),
      { type: 'knock', targetUid: senderId, contextGroupId: groupId });
    return;
  }
  const name = await resolveName(deps, recipientId, senderId);
  await sendToUser(deps, recipientId, buildMessage('knock', name),
    { type: 'knock', targetUid: senderId });
}

// Notify the OTHER members of a group that `memberUid` is available in it.
// Caller decides the "became available" transition; this just fans out with a
// per-(group, member) cooldown so availability in one group doesn't mute another.
export async function notifyGroupAvailability(deps, groupId, memberUid, now) {
  const lastTs = await deps.getVal(`notifierState/groupAvailability/${groupId}/${memberUid}`);
  if (withinCooldown(lastTs, now, AVAIL_COOLDOWN_MS)) return;
  const name = await resolveGroupMemberName(deps, groupId, memberUid);
  const group = await deps.getVal(`groups/${groupId}/name`);
  const members = await deps.getVal(`groups/${groupId}/members`);
  const memberIds = members ? Object.keys(members) : [];
  let delivered = 0;
  for (const coUid of memberIds) {
    if (coUid === memberUid) continue;
    const prefs = await deps.getVal(`userPrefs/${coUid}/notify/${memberUid}`);
    if (!wantsAvailability(prefs)) continue;
    try {
      if (await sendToUser(deps, coUid,
        buildMessage('availability', name, { group: group || undefined }),
        { type: 'availability', targetUid: memberUid, contextGroupId: groupId })) {
        delivered++;
      }
    } catch { /* one co-member's send failed — keep notifying the rest */ }
  }
  if (delivered > 0) await deps.update(`notifierState/groupAvailability/${groupId}`, { [memberUid]: now });
}

export async function handleCall(deps, callerId, callState) {
  if (!callState || !callState.calleeId) return;
  const calleeId = callState.calleeId;
  const prefs = await deps.getVal(`userPrefs/${calleeId}/notify/${callerId}`);
  if (!wantsCall(prefs)) return;
  const name = await resolveName(deps, calleeId, callerId);
  await sendToUser(deps, calleeId, buildMessage('call', name), { type: 'call', targetUid: callerId });
}

// Triggered on a write to users/{uid}/availableUntil (before/after are that value).
export async function handleAvailability(deps, uid, beforeAU, afterAU) {
  const now = deps.now();
  const status = await deps.getVal(`users/${uid}/status`);
  if (!availabilityTurnedOn(beforeAU, afterAU, status, now)) return;
  const lastTs = await deps.getVal(`notifierState/availability/${uid}`);
  if (withinCooldown(lastTs, now, AVAIL_COOLDOWN_MS)) return;

  const followers = await deps.getVal(`users/${uid}/followers`);
  const followerIds = followers ? Object.keys(followers) : [];
  let delivered = 0;
  for (const fid of followerIds) {
    const prefs = await deps.getVal(`userPrefs/${fid}/notify/${uid}`);
    if (!wantsAvailability(prefs)) continue;
    const name = await resolveName(deps, fid, uid);
    try {
      if (await sendToUser(deps, fid, buildMessage('availability', name), { type: 'availability', targetUid: uid })) {
        delivered++;
      }
    } catch { /* this follower's send failed — keep notifying the rest */ }
  }
  // Only consume the cooldown if a notification actually went out.
  if (delivered > 0) await deps.update('notifierState/availability', { [uid]: now });
}
