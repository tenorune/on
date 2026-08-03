// functions/ops/integrity.js — pure snapshot → findings. REPORT ONLY: every
// repair is a bespoke write, so this module never proposes or applies one.
//
// The `available-without-until` check is the same invariant
// functions/audit-available-null.js audits (that standalone script stays as
// is); folding it in gives one place to look.
//
// The canvas-key split comes from ops/project.js rather than being re-typed
// here (followups M3) — same reason the availability predicate is imported
// rather than re-derived: this module decides what an operator reads before
// pressing a destructive button, and a second copy of a shape is how two
// copies start disagreeing.
import { canvasUids } from './project.js';

const STALE_CALL_MS = 10 * 60 * 1000;

/**
 * @param {import('./types.js').Snapshot} snapshot
 * @param {{ staleCallMs?: number }} [opts]
 * @returns {import('./types.js').Finding[]}
 */
export function runChecks(snapshot, opts = {}) {
  const staleCallMs = opts.staleCallMs ?? STALE_CALL_MS;
  /** @type {import('./types.js').Finding[]} */
  const out = [];
  /** @type {(severity: 'error'|'warn'|'info', check: string, uid: string|null, path: string|null, detail: string) => void} */
  const add = (severity, check, uid, path, detail) => out.push({ severity, check, uid, path, detail });

  const users = snapshot.users || {};
  const prefs = snapshot.userPrefs || {};
  const groups = snapshot.groups || {};
  /** @type {(uid: string) => boolean} */
  const exists = (uid) => Boolean(users[uid]);

  // --- follow graph ---
  for (const [uid, user] of Object.entries(users)) {
    for (const follower of Object.keys(user?.followers || {})) {
      if (!exists(follower)) {
        add('warn', 'follow-dangling', uid, `users/${uid}/followers/${follower}`, `follower ${follower} has no user record`);
      } else if (!prefs[follower]?.following?.[uid]) {
        add('warn', 'follow-one-sided', uid, `users/${uid}/followers/${follower}`, `${follower} is listed as a follower but does not follow ${uid}`);
      }
      if (user?.followerNames && user.followerNames[follower] === undefined) {
        add('info', 'follower-name-missing', uid, `users/${uid}/followerNames/${follower}`, 'follower has no published name');
      }
    }
    for (const name of Object.keys(user?.followerNames || {})) {
      if (!user?.followers?.[name]) {
        add('warn', 'follower-name-orphan', uid, `users/${uid}/followerNames/${name}`, 'followerName with no matching follower');
      }
    }
  }
  for (const [uid, pref] of Object.entries(prefs)) {
    for (const followee of Object.keys(pref?.following || {})) {
      if (!exists(followee)) {
        add('warn', 'follow-dangling', uid, `userPrefs/${uid}/following/${followee}`, `followee ${followee} has no user record`);
      } else if (!users[followee]?.followers?.[uid]) {
        add('warn', 'follow-one-sided', uid, `userPrefs/${uid}/following/${followee}`, `${uid} follows ${followee} but is not in their followers`);
      }
    }
  }

  // --- indexes ---
  for (const [code, uid] of Object.entries(snapshot.codeIndex || {})) {
    if (!exists(String(uid))) {
      add('warn', 'code-index-dangling', String(uid), `codeIndex/${code}`, 'index entry resolves to a uid with no user record');
    } else if (users[String(uid)]?.presence?.code !== code) {
      add('warn', 'code-index-stale', String(uid), `codeIndex/${code}`, 'index entry survives a code rotation');
    }
  }
  for (const [uid, user] of Object.entries(users)) {
    const code = user?.presence?.code;
    if (code && snapshot.codeIndex?.[code] !== uid) {
      add('error', 'code-index-missing', uid, `codeIndex/${code}`, 'canonical presence code has no index entry pointing back');
    }
    for (const token of Object.keys(user?.invites || {})) {
      if (snapshot.inviteIndex?.[token]?.ownerUid !== uid) {
        add('warn', 'invite-index-missing', uid, `inviteIndex/${token}`, 'personal invite token has no matching index entry');
      }
    }
  }
  for (const [token, rec] of Object.entries(snapshot.inviteIndex || {})) {
    const owner = rec?.ownerUid;
    if (!owner || !exists(String(owner))) {
      add('warn', 'invite-index-dangling', owner ? String(owner) : null, `inviteIndex/${token}`, 'index entry resolves to a uid with no user record');
    }
  }

  // --- groups ---
  for (const [uid, user] of Object.entries(users)) {
    for (const gid of Object.keys(user?.groups || {})) {
      if (!groups[gid]) {
        add('warn', 'group-missing', uid, `users/${uid}/groups/${gid}`, 'enumeration entry for a group that no longer exists');
      } else if (!groups[gid]?.members?.[uid]) {
        add('warn', 'group-not-a-member', uid, `groups/${gid}/members/${uid}`, 'enumerated group but no membership record');
      }
    }
  }
  for (const [gid, group] of Object.entries(groups)) {
    const members = Object.keys(group?.members || {});
    if (!members.length) add('warn', 'group-empty', null, `groups/${gid}`, 'group has no members');
    if (group?.ownerId && !members.includes(String(group.ownerId))) {
      add('error', 'group-owner-not-member', String(group.ownerId), `groups/${gid}/ownerId`, 'ownerId is not in the member list');
    }
    for (const uid of members) {
      if (!exists(uid)) {
        add('warn', 'group-member-dangling', uid, `groups/${gid}/members/${uid}`, 'member has no user record');
      } else if (!users[uid]?.groups?.[gid]) {
        // This is the exact breakage repair-user-groups.js was written to fix.
        add('error', 'group-enumeration-missing', uid, `users/${uid}/groups/${gid}`, 'member with no group enumeration entry — the group is invisible in their nav');
      }
      const override = group.members[uid]?.statusOverride;
      if (override?.status === 'available' && typeof override.availableUntil !== 'number') {
        add('error', 'available-without-until', uid, `groups/${gid}/members/${uid}/statusOverride`, 'available with no concrete availableUntil');
      }
    }
    if (!snapshot.groupIdIndex?.[gid]) {
      add('info', 'group-id-index-missing', null, `groupIdIndex/${gid}`, 'group has no id-index entry');
    }
  }
  for (const gid of Object.keys(snapshot.groupIdIndex || {})) {
    if (!groups[gid]) add('warn', 'group-id-index-dangling', null, `groupIdIndex/${gid}`, 'id-index entry for a group that no longer exists');
  }
  for (const [invitee, byGroup] of Object.entries(snapshot.pendingInvites || {})) {
    for (const gid of Object.keys(byGroup || {})) {
      if (!snapshot.pendingInvitesByGroup?.[gid]?.[invitee]) {
        add('warn', 'pending-invite-asymmetric', invitee, `pendingInvitesByGroup/${gid}/${invitee}`, 'pendingInvites entry with no by-group mirror');
      }
    }
  }
  for (const [gid, invitees] of Object.entries(snapshot.pendingInvitesByGroup || {})) {
    for (const invitee of Object.keys(invitees || {})) {
      if (!snapshot.pendingInvites?.[invitee]?.[gid]) {
        add('warn', 'pending-invite-asymmetric', invitee, `pendingInvites/${invitee}/${gid}`, 'by-group entry with no pendingInvites mirror');
      }
    }
  }

  // --- telegram ---
  for (const [uid, link] of Object.entries(snapshot.telegramByUid || {})) {
    const tgId = link?.tgId != null ? String(link.tgId) : null;
    if (!tgId || snapshot.telegramUsers?.[tgId]?.uid !== uid) {
      add('error', 'telegram-mapping-asymmetric', uid, `telegramByUid/${uid}`, 'reverse index with no matching telegramUsers mapping');
    }
    if (!exists(uid)) {
      add('warn', 'telegram-mapping-dangling', uid, `telegramByUid/${uid}`, 'telegram link for a uid with no user record');
    }
    const prefsTgId = prefs[uid]?.telegram?.tgId;
    if (prefsTgId != null && String(prefsTgId) !== tgId) {
      add('error', 'telegram-prefs-disagree', uid, `userPrefs/${uid}/telegram/tgId`, 'prefs tgId disagrees with the reverse index');
    }
  }
  for (const [tgId, mapping] of Object.entries(snapshot.telegramUsers || {})) {
    const uid = mapping?.uid ? String(mapping.uid) : null;
    if (!uid || !exists(uid)) {
      add('warn', 'telegram-mapping-dangling', uid, `telegramUsers/${tgId}`, 'mapping resolves to a uid with no user record');
    }
  }
  for (const [uid, pref] of Object.entries(prefs)) {
    if (pref?.notifyChannel === 'telegram' && !snapshot.telegramByUid?.[uid]) {
      add('error', 'telegram-channel-unroutable', uid, `userPrefs/${uid}/notifyChannel`, 'notifyChannel is telegram but there is no mapping — notifications go nowhere');
    }
  }

  // --- residue ---
  for (const [recipient, senders] of Object.entries(snapshot.knocks || {})) {
    if (!exists(recipient)) {
      add('warn', 'knock-dangling', recipient, `knocks/${recipient}`, 'knock inbox for a uid with no user record');
      continue;
    }
    for (const sender of Object.keys(senders || {})) {
      if (!exists(sender)) {
        // expungeDerivedAccount documents this as deliberately not cleaned.
        add('warn', 'knock-dangling', recipient, `knocks/${recipient}/${sender}`, 'knock from a sender with no user record');
      }
    }
  }
  for (const [uid, call] of Object.entries(snapshot.calls || {})) {
    if (typeof call?.ts === 'number' && snapshot.takenAt - call.ts > staleCallMs) {
      add('warn', 'call-stale', uid, `calls/${uid}`, 'call record older than the stale-call window');
    }
  }
  for (const [gid, cells] of Object.entries(snapshot.locationCells || {})) {
    for (const uid of Object.keys(cells || {})) {
      if (!groups[gid]?.members?.[uid]) {
        add('warn', 'location-cell-non-member', uid, `locationCells/${gid}/${uid}`, 'location cell for a non-member of the group');
      }
    }
  }
  for (const uid of Object.keys(snapshot.locations || {})) {
    if (!exists(uid)) add('warn', 'location-dangling', uid, `locations/${uid}`, 'location point for a uid with no user record');
  }
  for (const uid of Object.keys(snapshot.pushTokens || {})) {
    if (!exists(uid)) add('warn', 'push-tokens-dangling', uid, `pushTokens/${uid}`, 'push tokens for a uid with no user record');
  }
  for (const key of snapshot.canvasKeys || []) {
    for (const uid of canvasUids(key)) {
      if (!exists(uid)) add('warn', 'canvas-dangling', uid, `canvases/${key}`, 'canvas naming a uid with no user record');
    }
  }

  // --- availability invariant (presence side) ---
  for (const [uid, user] of Object.entries(users)) {
    const p = user?.presence;
    if (p?.status === 'available' && typeof p.availableUntil !== 'number') {
      add('error', 'available-without-until', uid, `users/${uid}/presence`, 'available with no concrete availableUntil');
    }
  }

  // --- auth ↔ rtdb ---
  const authUids = new Set((snapshot.authUsers || []).map((u) => u.uid));
  for (const rec of snapshot.authUsers || []) {
    if (!exists(rec.uid)) {
      add('info', 'auth-orphan', rec.uid, null, `Auth record with no RTDB user${rec.email?.endsWith('@telegram.invalid') ? ' (telegram-derived)' : ''}`);
    }
  }
  for (const uid of Object.keys(users)) {
    if (!authUids.has(uid)) add('info', 'auth-missing', uid, null, 'RTDB user with no Auth record');
  }

  const rank = { error: 0, warn: 1, info: 2 };
  out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.check.localeCompare(b.check));
  return out;
}
