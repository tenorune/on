// functions/notifier.js — delivery + per-event handlers. Deps are injected.
import { wantsKnock, wantsCall, wantsAvailability, availabilityTurnedOn, withinCooldown, buildMessage, effectiveAvailable } from './presence-core.js';

const AVAIL_COOLDOWN_MS = 5 * 60 * 1000;
// Per-(recipient, sender) send cooldowns (R1.5 #179 S3). Each directed event
// (knock/call/invite/follow-request) triggers a Cloud Function → FCM push; with
// no throttle an authed user scripting set+delete loops could flood a victim's
// lock screen. State lives under notifierState/* (rules: server-only read/write).
// All four are short: these events are onValueCreated, so re-WRITING an existing
// node never re-fires — the cooldown only throttles delete→create loops, and a
// genuine re-request after a decline (also a delete→create) must NOT be swallowed.
const KNOCK_COOLDOWN_MS = 30 * 1000;
const CALL_COOLDOWN_MS = 30 * 1000;
const INVITE_COOLDOWN_MS = 30 * 1000;
const FOLLOW_REQ_COOLDOWN_MS = 30 * 1000;

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
  const now = deps.now();
  if (withinCooldown(await deps.getVal(`notifierState/knockCooldown/${recipientId}/${senderId}`), now, KNOCK_COOLDOWN_MS)) return;
  const groupId = record && record.contextGroupId;
  if (groupId) {
    const name = await resolveGroupMemberName(deps, groupId, senderId);
    const group = await deps.getVal(`groups/${groupId}/name`);
    await sendToUser(deps, recipientId,
      buildMessage('knock', name, { group: group || undefined }),
      { type: 'knock', targetUid: senderId, contextGroupId: groupId });
  } else {
    const name = await resolveName(deps, recipientId, senderId);
    await sendToUser(deps, recipientId, buildMessage('knock', name),
      { type: 'knock', targetUid: senderId });
  }
  await deps.update(`notifierState/knockCooldown/${recipientId}`, { [senderId]: now });
}

// A pending invite landed in `pendingInvites/{inviteeUid}/{groupId}`. Notify the
// invitee unconditionally — invites are directed and consensual (sent by someone
// the invitee follows, or a group owner), so there is no per-person opt-in gate
// like knocks/availability. Payload carries type:'invite' and NO contextGroupId:
// the invitee is not a member yet, so the deep link opens the Inbox, not the group.
export async function handleInvite(deps, inviteeUid, groupId, record) {
  if (!record || !record.from) return;
  const now = deps.now();
  if (withinCooldown(await deps.getVal(`notifierState/inviteCooldown/${inviteeUid}/${record.from}`), now, INVITE_COOLDOWN_MS)) return;
  const follow = await deps.getVal(`userPrefs/${inviteeUid}/following/${record.from}`);
  const name = (follow && follow.label) || await resolveGroupMemberName(deps, groupId, record.from);
  const group = await deps.getVal(`groups/${groupId}/name`);
  await sendToUser(deps, inviteeUid,
    buildMessage('invite', name, { group: group || undefined }),
    { type: 'invite', targetUid: record.from, groupId });
  await deps.update(`notifierState/inviteCooldown/${inviteeUid}`, { [record.from]: now });
}

// A follow request landed in `followRequests/{targetUid}/{requesterUid}` (Groups
// §11). Notify the target unconditionally — like invites, this is directed and
// consensual, so there's no per-person opt-in gate. Name: the target's own label
// for the requester when they already follow them, else the requester's display
// name in the shared group the request came from. Payload carries type:'followRequest'
// and NO contextGroupId — the deep link opens the Inbox to approve/decline.
export async function handleFollowRequest(deps, targetUid, requesterUid, record) {
  if (!record || !record.from) return;
  const now = deps.now();
  if (withinCooldown(await deps.getVal(`notifierState/followReqCooldown/${targetUid}/${requesterUid}`), now, FOLLOW_REQ_COOLDOWN_MS)) return;
  const follow = await deps.getVal(`userPrefs/${targetUid}/following/${requesterUid}`);
  const name = (follow && follow.label)
    || await resolveGroupMemberName(deps, record.groupId, requesterUid);
  await sendToUser(deps, targetUid,
    buildMessage('followRequest', name),
    { type: 'followRequest', targetUid: requesterUid });
  await deps.update(`notifierState/followReqCooldown/${targetUid}`, { [requesterUid]: now });
}

// Notify the OTHER members of a group that `memberUid` is available in it.
// Caller decides the "became available" transition; this just fans out with a
// per-(group, member) cooldown so availability in one group doesn't mute another.
export async function notifyGroupAvailability(deps, groupId, memberUid, now, alreadyNotified = null) {
  const lastTs = await deps.getVal(`notifierState/groupAvailability/${groupId}/${memberUid}`);
  if (withinCooldown(lastTs, now, AVAIL_COOLDOWN_MS)) return;
  // Resolve the shared per-event data once (name + group label + roster) before
  // fanning out — these don't vary by recipient, so reading them per co-member
  // was an N+1.
  const [name, group, members] = await Promise.all([
    resolveGroupMemberName(deps, groupId, memberUid),
    deps.getVal(`groups/${groupId}/name`),
    deps.getVal(`groups/${groupId}/members`),
  ]);
  const memberIds = members ? Object.keys(members) : [];
  // Reserve the recipients up front (synchronously) so the shared dedup set is
  // updated deterministically regardless of send ordering, then fan the
  // independent prefs-read + send out in parallel.
  const recipients = [];
  for (const coUid of memberIds) {
    if (coUid === memberUid) continue;
    // Dedup: this person is already getting a push for this availability event
    // (from Direct or an earlier group) — iOS web push won't coalesce by tag.
    if (alreadyNotified && alreadyNotified.has(coUid)) continue;
    recipients.push(coUid);
  }
  const sent = await Promise.all(recipients.map(async (coUid) => {
    const prefs = await deps.getVal(`userPrefs/${coUid}/notify/${memberUid}`);
    if (!wantsAvailability(prefs)) return false;
    if (alreadyNotified) alreadyNotified.add(coUid);
    try {
      return await sendToUser(deps, coUid,
        buildMessage('availability', name, { group: group || undefined }),
        { type: 'availability', targetUid: memberUid, contextGroupId: groupId });
    } catch { return false; /* one co-member's send failed — keep notifying the rest */ }
  }));
  const delivered = sent.filter(Boolean).length;
  if (delivered > 0) await deps.update(`notifierState/groupAvailability/${groupId}`, { [memberUid]: now });
}

// Triggered on a write to groups/{g}/members/{uid}/statusOverride. Notifies when
// the member's EFFECTIVE in-group availability flips off→on. `before == null`
// means the member just joined (first override write) — not a "became available"
// event, so we skip it to avoid a blast on every new member.
export async function handleGroupOverrideChange(deps, groupId, memberUid, before, after) {
  if (before == null) return;
  const now = deps.now();
  // One read of the presence node instead of separate status/availableUntil
  // gets (only consulted when the override is disabled, but cheap to fetch once).
  const presence = await deps.getVal(`users/${memberUid}/presence`);
  const status = presence?.status;
  const primaryAU = presence?.availableUntil;
  const wasOn = effectiveAvailable(before, status, primaryAU, now);
  const isOn = effectiveAvailable(after, status, primaryAU, now);
  if (isOn && !wasOn) await notifyGroupAvailability(deps, groupId, memberUid, now);
}

export async function handleCall(deps, calleeId, callerId) {
  const prefs = await deps.getVal(`userPrefs/${calleeId}/notify/${callerId}`);
  if (!wantsCall(prefs)) return;
  const now = deps.now();
  if (withinCooldown(await deps.getVal(`notifierState/callCooldown/${calleeId}/${callerId}`), now, CALL_COOLDOWN_MS)) return;
  const name = await resolveName(deps, calleeId, callerId);
  await sendToUser(deps, calleeId, buildMessage('call', name), { type: 'call', targetUid: callerId });
  await deps.update(`notifierState/callCooldown/${calleeId}`, { [callerId]: now });
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
  //
  // Direct ownership giving an UNLABELLED message is intentional, not a gap
  // (#215, accept-and-document). This trigger fires on the sender's PRIMARY
  // availability, and the group pass below skips override-ON groups — so every
  // group it could name is override-OFF, i.e. already showing the primary. For
  // a recipient who both follows the sender AND co-members a group, "X is
  // available" and "X is available in {group}" describe the SAME fact; the
  // label adds no information and its "in {group}" reading can misleadingly
  // imply the availability is group-scoped. A group label is only meaningful
  // when the in-group status DIVERGES from the primary (an override-ON group),
  // which is handled by onMemberOverride → notifyGroupAvailability, not here.
  //
  // Known accepted caveat (#215 finding #7): this in-memory `notified` set
  // can't coordinate with the SEPARATE onMemberOverride invocation, so a
  // recipient who is both a Direct follower and an override-ON co-member can
  // still get a rare duplicate (one push per trigger). Accepted as-is for a
  // 50–100-user app rather than adding a cross-invocation notifierState stamp.
  const notified = new Set();

  // Direct followers — own per-uid cooldown. Followers are marked notified even
  // when that cooldown suppresses the send, so the group pass below never doubles
  // them within the window.
  const [directCooledTs, followers] = await Promise.all([
    deps.getVal(`notifierState/availability/${uid}`),
    deps.getVal(`users/${uid}/followers`),
  ]);
  const directCooled = withinCooldown(directCooledTs, now, AVAIL_COOLDOWN_MS);
  const followerIds = (followers ? Object.keys(followers) : []).filter((fid) => fid !== uid);
  // Resolve the sender's shared fallback name once (code → 'Someone'); only the
  // per-viewer following label varies. This collapses the per-follower re-read
  // of users/{uid}/presence/code that resolveName() did inside the old loop.
  const senderFallback = followerIds.length
    ? ((await deps.getVal(`users/${uid}/presence/code`)) || 'Someone')
    : 'Someone';
  // Fan the independent per-follower prefs-read + send out in parallel. Each
  // opted-in follower is marked notified (so the group pass never doubles them),
  // even when the Direct cooldown suppresses the actual send.
  const results = await Promise.all(followerIds.map(async (fid) => {
    const prefs = await deps.getVal(`userPrefs/${fid}/notify/${uid}`);
    if (!wantsAvailability(prefs)) return { opted: false };
    if (directCooled) return { fid, opted: true, sent: false };
    const follow = await deps.getVal(`userPrefs/${fid}/following/${uid}`);
    const name = (follow && follow.label) || senderFallback;
    try {
      // Intentionally unlabelled — no { group }. See the "One push per
      // recipient" note above (#215): for a primary-availability event the
      // Direct message is the truest one, and a group label here would only
      // risk implying scope.
      const sent = await sendToUser(deps, fid, buildMessage('availability', name), { type: 'availability', targetUid: uid });
      return { fid, opted: true, sent };
    } catch { return { fid, opted: true, sent: false }; /* keep notifying the rest */ }
  }));
  let directDelivered = 0;
  for (const r of results) {
    if (r.opted) notified.add(r.fid);
    if (r.sent) directDelivered++;
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
