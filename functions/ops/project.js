// functions/ops/project.js — pure snapshot → display shapes. No I/O.
import { classifyProvenance } from './provenance.js';
import { agoLabel, humanDuration, statusLabelling } from './format.js';
// The SERVER availability predicate, pinned against the client's by
// tests/presencePredicateParity.test.js. Imported rather than re-derived: a
// third predicate is how three of them start disagreeing, and this one decides
// what an operator sees before pressing a destructive button.
import { primaryAvailable } from '../presence-core.js';

/**
 * Take a canvas key apart. Keys are SORTED uid pairs joined by `_`
 * (ops/merge.js's canvasKeyFor builds them, and the round trip is pinned in
 * ops-project.test.js), so the two uids come back in that same order.
 *
 * The ONE place this happens (followups M3): the split used to be written here
 * and again inline in ops/integrity.js. Neither copy was wrong, and integrity
 * is report-only so a wrong split there misreports rather than mis-deletes —
 * but one concept transcribed into several places is what produced three
 * separate defects on this build, and a source assertion in the tests now fails
 * if another ops module re-types it.
 * @param {string} key
 * @returns {string[]}
 */
export function canvasUids(key) {
  return key.split('_');
}

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
    const [a, b] = canvasUids(key);
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
export function buildRows(snapshot, secret, now = Date.now()) {
  const authByUid = new Map(snapshot.authUsers.map((u) => [u.uid, u]));
  const rows = Object.keys(snapshot.users || {}).map((uid) => {
    const presence = snapshot.users[uid]?.presence || {};
    const { followers, following } = contactSets(snapshot, uid);
    // The AUTH record's creation time, not the account data's. Nothing in RTDB
    // carries a per-account created stamp, and an expunge leaves the Auth
    // record standing, so a re-bootstrapped account reads days old here while
    // its data is seconds old. The panel's column is labelled "auth created"
    // for that reason — do not relabel it back (M15).
    const createdAt = authByUid.get(uid)?.createdAt ?? null;
    const lastSeen = typeof presence.lastSeen === 'number' ? presence.lastSeen : null;
    const status = presence.status ?? null;
    const availableUntil = typeof presence.availableUntil === 'number' ? presence.availableUntil : null;
    const available = primaryAvailable(presence, now);
    return {
      uid,
      code: presence.code ?? null,
      provenance: classifyProvenance(uid, snapshot, secret),
      createdAt,
      createdAtLabel: agoLabel(createdAt, now),
      lastSeen,
      lastSeenLabel: agoLabel(lastSeen, now),
      status,
      availableUntil,
      // Whether the account is available RIGHT NOW, which `status` alone never
      // answered: availability is timed, and nothing rewrites the stored string
      // when the window closes. Uses the pinned server predicate rather than a
      // third copy — see the test's note.
      available,
      ...statusLabelling(status, availableUntil, available, now),
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
export function buildDetail(snapshot, uid, secret, now = Date.now()) {
  if (!snapshot.users?.[uid]) return null;
  const row = buildRows(snapshot, secret, now).find((r) => r.uid === uid);
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
  const pointFixAge = point ? age(snapshot.takenAt, point.updatedAt) : null;
  const cells = Object.keys(snapshot.locationCells || {})
    .filter((gid) => snapshot.locationCells[gid]?.[uid])
    .map((gid) => {
      const fixAge = age(snapshot.takenAt, snapshot.locationCells[gid][uid].updatedAt);
      return { gid, fixAge, fixAgeLabel: fixAge == null ? null : humanDuration(fixAge) };
    });

  const link = snapshot.telegramByUid?.[uid];
  const tgId = link?.tgId != null ? String(link.tgId) : null;

  return {
    ...row,
    followers,
    following,
    mutuals,
    groups,
    canvases: canvasPeers(snapshot.canvasKeys, uid),
    pushTokens: Object.entries(snapshot.pushTokens?.[uid] || {}).map(([token, t]) => {
      const lastSeen = typeof t?.lastSeen === 'number' ? t.lastSeen : null;
      return { token, lastSeen, lastSeenLabel: agoLabel(lastSeen, now), ua: t?.ua ?? null };
    }),
    telegram: tgId ? {
      tgId,
      chatId: link.chatId ?? null,
      mappingLinkedAt: snapshot.telegramUsers?.[tgId]?.linkedAt ?? null,
      prefsLinkedAt: snapshot.userPrefs?.[uid]?.telegram?.linkedAt ?? null,
    } : null,
    location: {
      hasPoint: Boolean(point),
      fixAge: pointFixAge,
      fixAgeLabel: pointFixAge == null ? null : humanDuration(pointFixAge),
      cells,
    },
  };
}

/** @param {number} takenAt @param {unknown} updatedAt */
function age(takenAt, updatedAt) {
  return typeof updatedAt === 'number' ? takenAt - updatedAt : null;
}
