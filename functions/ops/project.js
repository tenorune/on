// functions/ops/project.js — pure snapshot → display shapes. No I/O.
import { classifyProvenance } from './provenance.js';

/**
 * Canvas keys are SORTED uid pairs, so a uid can appear on either side.
 * @param {string[]} canvasKeys
 * @param {string} uid
 * @returns {Array<{ peer: string, key: string }>}
 */
export function canvasPeers(canvasKeys, uid) {
  /** @type {Array<{ peer: string, key: string }>} */
  const out = [];
  for (const key of canvasKeys) {
    const [a, b] = key.split('_');
    if (a === uid) out.push({ peer: b, key });
    else if (b === uid) out.push({ peer: a, key });
  }
  return out;
}

/** @param {import('./types.js').Snapshot} snapshot @param {string} uid */
function contactSets(snapshot, uid) {
  const followers = Object.keys(snapshot.users?.[uid]?.followers || {});
  const following = Object.keys(snapshot.userPrefs?.[uid]?.following || {});
  const mutuals = followers.filter((f) => following.includes(f));
  return { followers, following, mutuals };
}

/**
 * @param {import('./types.js').Snapshot} snapshot
 * @param {string | null | undefined} secret
 * @returns {import('./types.js').Row[]}
 */
export function buildRows(snapshot, secret) {
  const authByUid = new Map(snapshot.authUsers.map((u) => [u.uid, u]));
  const rows = Object.keys(snapshot.users || {}).map((uid) => {
    const presence = snapshot.users[uid]?.presence || {};
    const { followers, following } = contactSets(snapshot, uid);
    return {
      uid,
      code: presence.code ?? null,
      provenance: classifyProvenance(uid, snapshot, secret),
      createdAt: authByUid.get(uid)?.createdAt ?? null,
      lastSeen: typeof presence.lastSeen === 'number' ? presence.lastSeen : null,
      status: presence.status ?? null,
      availableUntil: typeof presence.availableUntil === 'number' ? presence.availableUntil : null,
      contacts: new Set([...followers, ...following]).size,
      groupCount: Object.keys(snapshot.users[uid]?.groups || {}).length,
      canvasCount: canvasPeers(snapshot.canvasKeys, uid).length,
      pushTokenCount: Object.keys(snapshot.pushTokens?.[uid] || {}).length,
      notifyChannel: snapshot.userPrefs?.[uid]?.notifyChannel ?? null,
      locationOptIn: Boolean(snapshot.locations?.[uid]),
    };
  });
  // Most recently active first; never-seen accounts sort last rather than
  // leading the table on a null.
  rows.sort((a, b) => (b.lastSeen ?? -Infinity) - (a.lastSeen ?? -Infinity));
  return rows;
}

/**
 * @param {import('./types.js').Snapshot} snapshot
 * @param {string} uid
 * @param {string | null | undefined} secret
 * @returns {import('./types.js').Detail | null}
 */
export function buildDetail(snapshot, uid, secret) {
  if (!snapshot.users?.[uid]) return null;
  const row = buildRows(snapshot, secret).find((r) => r.uid === uid);
  if (!row) return null;
  const { followers, following, mutuals } = contactSets(snapshot, uid);

  const groups = Object.keys(snapshot.users[uid]?.groups || {}).map((gid) => {
    const group = snapshot.groups?.[gid] || {};
    const member = group.members?.[uid] || {};
    return {
      gid,
      name: group.name ?? null,
      displayName: member.displayName ?? null,
      role: member.role ?? null,
      isOwner: group.ownerId === uid,
      hasStatusOverride: Boolean(member.statusOverride),
    };
  });

  const point = snapshot.locations?.[uid];
  const cells = Object.keys(snapshot.locationCells || {})
    .filter((gid) => snapshot.locationCells[gid]?.[uid])
    .map((gid) => ({
      gid,
      fixAge: age(snapshot.takenAt, snapshot.locationCells[gid][uid].updatedAt),
    }));

  const link = snapshot.telegramByUid?.[uid];
  const tgId = link?.tgId != null ? String(link.tgId) : null;

  return {
    ...row,
    followers,
    following,
    mutuals,
    groups,
    canvases: canvasPeers(snapshot.canvasKeys, uid),
    pushTokens: Object.entries(snapshot.pushTokens?.[uid] || {}).map(([token, t]) => ({
      token,
      lastSeen: typeof t?.lastSeen === 'number' ? t.lastSeen : null,
      ua: t?.ua ?? null,
    })),
    telegram: tgId ? {
      tgId,
      chatId: link.chatId ?? null,
      mappingLinkedAt: snapshot.telegramUsers?.[tgId]?.linkedAt ?? null,
      prefsLinkedAt: snapshot.userPrefs?.[uid]?.telegram?.linkedAt ?? null,
    } : null,
    location: {
      hasPoint: Boolean(point),
      fixAge: point ? age(snapshot.takenAt, point.updatedAt) : null,
      cells,
    },
  };
}

/** @param {number} takenAt @param {unknown} updatedAt */
function age(takenAt, updatedAt) {
  return typeof updatedAt === 'number' ? takenAt - updatedAt : null;
}
