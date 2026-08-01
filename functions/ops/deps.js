// functions/ops/deps.js — admin-SDK wiring. Mirrors migrate-presence.js's auth
// and region handling. The ONLY untested ops module: keep it free of logic.
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';

// The Admin SDK's maximum page size for auth.listUsers().
const AUTH_LIST_USERS_PAGE_SIZE = 1000;

/**
 * @param {{ projectId: string, saJson: string, databaseURL: string }} config
 * @returns {{
 *   deps: {
 *     getVal: (path: string) => Promise<any>,
 *     set: (path: string, value: unknown) => Promise<void>,
 *     update: (path: string, writes: Record<string, unknown>) => Promise<void>,
 *     transaction: (path: string, fn: (current: any) => unknown) => Promise<{ committed: boolean }>,
 *     now: () => number,
 *   },
 *   io: {
 *     listCanvasKeys: () => Promise<string[]>,
 *     listAuthUsers: () => Promise<import('./types.js').AuthUserRecord[]>,
 *     now: () => number,
 *   },
 *   auth: import('firebase-admin/auth').Auth,
 * }}
 */
export function makeOpsDeps({ projectId, saJson, databaseURL }) {
  const credential = cert(JSON.parse(saJson));
  initializeApp({ credential, databaseURL, projectId });
  const db = getDatabase();
  const auth = getAuth();

  const deps = {
    /** @param {string} path */
    getVal: async (path) => (await db.ref(path).get()).val(),
    /** @param {string} path @param {unknown} value */
    set: async (path, value) => db.ref(path).set(value),
    /** @param {string} path @param {Record<string, unknown>} writes */
    update: async (path, writes) => db.ref(path).update(writes),
    /** @param {string} path @param {(current: any) => unknown} fn */
    transaction: async (path, fn) => {
      const res = await db.ref(path).transaction(fn);
      return { committed: res.committed };
    },
    now: () => Date.now(),
  };

  const io = {
    // Shallow REST read: the Admin SDK has no shallow query, and loading
    // `canvases` normally would pull every stroke body.
    listCanvasKeys: async () => {
      const token = await credential.getAccessToken();
      const url = `${databaseURL}/canvases.json?shallow=true&access_token=${token.access_token}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`shallow canvases read failed: ${res.status}`);
      return Object.keys((await res.json()) || {});
    },
    listAuthUsers: async () => {
      /** @type {import('./types.js').AuthUserRecord[]} */
      const out = [];
      let pageToken;
      do {
        const page = await auth.listUsers(AUTH_LIST_USERS_PAGE_SIZE, pageToken);
        for (const u of page.users) {
          out.push({ uid: u.uid, email: u.email || null, createdAt: Date.parse(u.metadata.creationTime) });
        }
        pageToken = page.pageToken;
      } while (pageToken);
      return out;
    },
    now: () => Date.now(),
  };

  return { deps, io, auth };
}
