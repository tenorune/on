// functions/notifier.js — delivery + per-event handlers. Deps are injected.
import { wantsKnock, wantsCall, wantsAvailability, availabilityTurnedOn, withinCooldown, buildMessage, effectiveAvailable } from './presence-core.js';

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
  const code = await deps.getVal(`users/${targetUid}/presence/code`);
  if (code) return code;
  return 'Someone';
}

export async function resolveGroupMemberName(deps, groupId, uid) {
  const displayName = await deps.getVal(`groups/${groupId}/members/${uid}/displayName`);
  if (displayName) return displayName;
  const code = await deps.getVal(`users/${uid}/presence/code`);
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

// A pending invite landed in `pendingInvites/{inviteeUid}/{groupId}`. Notify the
// invitee unconditionally — invites are directed and consensual (sent by someone
// the invitee follows, or a group owner), so there is no per-person opt-in gate
// like knocks/availability. Payload carries type:'invite' and NO contextGroupId:
// the invitee is not a member yet, so the deep link opens the Inbox, not the group.
export async function handleInvite(deps, inviteeUid, groupId, record) {
  if (!record || !record.from) return;
  const follow = await deps.getVal(`userPrefs/${inviteeUid}/following/${record.from}`);
  const name = (follow && follow.label) || await resolveGroupMemberName(deps, groupId, record.from);
  const group = await deps.getVal(`groups/${groupId}/name`);
  await sendToUser(deps, inviteeUid,
    buildMessage('invite', name, { group: group || undefined }),
    { type: 'invite', targetUid: record.from, groupId });
}

// A follow request landed in `followRequests/{targetUid}/{requesterUid}` (Groups
// §11). Notify the target unconditionally — like invites, this is directed and
// consensual, so there's no per-person opt-in gate. Name: the target's own label
// for the requester when they already follow them, else the requester's display
// name in the shared group the request came from. Payload carries type:'followRequest'
// and NO contextGroupId — the deep link opens the Inbox to approve/decline.
export async function handleFollowRequest(deps, targetUid, requesterUid, record) {
  if (!record || !record.from) return;
  const follow = await deps.getVal(`userPrefs/${targetUid}/following/${requesterUid}`);
  const name = (follow && follow.label)
    || await resolveGroupMemberName(deps, record.groupId, requesterUid);
  await sendToUser(deps, targetUid,
    buildMessage('followRequest', name),
    { type: 'followRequest', targetUid: requesterUid });
}

// Notify the OTHER members of a group that `memberUid` is available in it.
// Caller decides the "became available" transition; this just fans out with a
// per-(group, member) cooldown so availability in one group doesn't mute another.
export async function notifyGroupAvailability(deps, groupId, memberUid, now, alreadyNotified = null) {
  const lastTs = await deps.getVal(`notifierState/groupAvailability/${groupId}/${memberUid}`);
  if (withinCooldown(lastTs, now, AVAIL_COOLDOWN_MS)) return;
  const name = await resolveGroupMemberName(deps, groupId, memberUid);
  const group = await deps.getVal(`groups/${groupId}/name`);
  const members = await deps.getVal(`groups/${groupId}/members`);
  const memberIds = members ? Object.keys(members) : [];
  let delivered = 0;
  for (const coUid of memberIds) {
    if (coUid === memberUid) continue;
    // Dedup: this person is already getting a push for this availability event
    // (from Direct or an earlier group) — iOS web push won't coalesce by tag.
    if (alreadyNotified && alreadyNotified.has(coUid)) continue;
    const prefs = await deps.getVal(`userPrefs/${coUid}/notify/${memberUid}`);
    if (!wantsAvailability(prefs)) continue;
    if (alreadyNotified) alreadyNotified.add(coUid);
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

// Triggered on a write to groups/{g}/members/{uid}/statusOverride. Notifies when
// the member's EFFECTIVE in-group availability flips off→on. `before == null`
// means the member just joined (first override write) — not a "became available"
// event, so we skip it to avoid a blast on every new member.
export async function handleGroupOverrideChange(deps, groupId, memberUid, before, after) {
  if (before == null) return;
  const now = deps.now();
  const status = await deps.getVal(`users/${memberUid}/presence/status`);
  const primaryAU = await deps.getVal(`users/${memberUid}/presence/availableUntil`);
  const wasOn = effectiveAvailable(before, status, primaryAU, now);
  const isOn = effectiveAvailable(after, status, primaryAU, now);
  if (isOn && !wasOn) await notifyGroupAvailability(deps, groupId, memberUid, now);
}

export async function handleCall(deps, calleeId, callerId) {
  const prefs = await deps.getVal(`userPrefs/${calleeId}/notify/${callerId}`);
  if (!wantsCall(prefs)) return;
  const name = await resolveName(deps, calleeId, callerId);
  await sendToUser(deps, calleeId, buildMessage('call', name), { type: 'call', targetUid: callerId });
}

// Triggered on a write to users/{uid}/presence/availableUntil (before/after are that value).
export async function handleAvailability(deps, uid, beforeAU, afterAU) {
  const now = deps.now();
  const status = await deps.getVal(`users/${uid}/presence/status`);
  if (!availabilityTurnedOn(beforeAU, afterAU, status, now)) return;

  // One push per recipient for this availability event. iOS web push doesn't
  // coalesce by notification tag, so a follower who is also a co-member of
  // several override-off groups would otherwise get a separate push from each.
  // Direct "owns" a follower (generic "X is available" → Direct); a group-only
  // co-member gets the first override-off group's "X is available in {group}".
  const notified = new Set();

  // Direct followers — own per-uid cooldown. Followers are marked notified even
  // when that cooldown suppresses the send, so the group pass below never doubles
  // them within the window.
  const directCooled = withinCooldown(await deps.getVal(`notifierState/availability/${uid}`), now, AVAIL_COOLDOWN_MS);
  const followers = await deps.getVal(`users/${uid}/followers`);
  let directDelivered = 0;
  for (const fid of followers ? Object.keys(followers) : []) {
    if (fid === uid) continue;
    const prefs = await deps.getVal(`userPrefs/${fid}/notify/${uid}`);
    if (!wantsAvailability(prefs)) continue;
    notified.add(fid);
    if (directCooled) continue;
    const name = await resolveName(deps, fid, uid);
    try {
      if (await sendToUser(deps, fid, buildMessage('availability', name), { type: 'availability', targetUid: uid })) {
        directDelivered++;
      }
    } catch { /* this follower's send failed — keep notifying the rest */ }
  }
  if (directDelivered > 0) await deps.update('notifierState/availability', { [uid]: now });

  // Group co-members — only for groups where this member's override is OFF, so the
  // group is showing their primary. Override-ON groups are driven by onMemberOverride.
  // The shared `notified` set dedups across Direct + every group.
  const groups = await deps.getVal(`users/${uid}/groups`);
  for (const groupId of groups ? Object.keys(groups) : []) {
    const override = await deps.getVal(`groups/${groupId}/members/${uid}/statusOverride`);
    if (override && override.enabled === true) continue;
    await notifyGroupAvailability(deps, groupId, uid, now, notified);
  }
}
