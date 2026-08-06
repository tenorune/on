// functions/ops/snapshot.js — the ONLY ops module that reads. Everything
// downstream is a pure function of the object this returns.
//
// `canvases` is deliberately absent from SNAPSHOT_PATHS: canvases/{pair}/strokes
// is the only unbounded node in the database, so canvas KEYS arrive through the
// injected listCanvasKeys() (a shallow REST read) and stroke bodies are never
// loaded at all.

/** Every root this panel reads through getVal, in read order. */
export const SNAPSHOT_PATHS = [
  'users',
  'userPrefs',
  'groups',
  'telegramUsers',
  'telegramByUid',
  'pushTokens',
  'locations',
  'locationCells',
  'knocks',
  'calls',
  'followRequests',
  'followGrants',
  'pendingInvites',
  'pendingInvitesByGroup',
  'revocations',
  'codeIndex',
  'inviteIndex',
  'groupIdIndex',
];

/**
 * @param {{ getVal: (path: string) => Promise<any> }} deps
 * @param {{
 *   listCanvasKeys: () => Promise<string[]>,
 *   listAuthUsers: () => Promise<import('./types.js').AuthUserRecord[]>,
 *   now: () => number,
 * }} io
 * @returns {Promise<import('./types.js').Snapshot>}
 */
export async function readSnapshot(deps, io) {
  const [values, canvasKeys, authUsers] = await Promise.all([
    Promise.all(SNAPSHOT_PATHS.map((path) => deps.getVal(path))),
    io.listCanvasKeys(),
    io.listAuthUsers(),
  ]);

  /** @type {Record<string, any>} */
  const out = {};
  SNAPSHOT_PATHS.forEach((path, i) => { out[path] = values[i] || {}; });
  out.canvasKeys = canvasKeys;
  out.authUsers = authUsers;
  out.takenAt = io.now();
  return /** @type {import('./types.js').Snapshot} */ (out);
}
