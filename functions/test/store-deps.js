import { jest } from '@jest/globals';

// Shared RTDB mock for the functions test suites (replaces the duplicated
// per-file flat mocks — HANDOFF §38 "mock fidelity"). The store stays a FLAT
// object keyed by slash paths so tests keep seeding and asserting on
// `deps.store['a/b/c']` directly, but reads/writes now model the two real
// RTDB behaviors the old mocks could not:
//
//  1. `update('/', {...})` REJECTS a write map where one path is an ancestor
//     of another (and, like the SDK's argument check, writes nothing) — so
//     the production write-maps built for single atomic updates are actually
//     certified conflict-free by the tests, not just manually inspected.
//  2. Writing a node replaces it WHOLESALE (existing deeper flat keys die
//     with it), and reads assemble the subtree: deeper flat keys overlay
//     content embedded in shallower seeds, a `null` at a key acts as a
//     deletion marker, and a node left empty reads as null (RTDB prunes).
//
// The literal `null` marker is kept at the written key so tests can keep
// distinguishing "written null" (`toBeNull`) from "never written"
// (`toBeUndefined`).

const norm = (path) => path.replace(/\/+/g, '/').replace(/^\//, '').replace(/\/$/, '');
const isAncestor = (a, b) => b.startsWith(`${a}/`);

// Write `value` at `path`, replacing the whole node: any existing deeper
// flat key is part of the node being replaced, so it goes away.
function writeAt(store, path, value) {
  for (const k of Object.keys(store)) {
    if (isAncestor(path, k)) delete store[k];
  }
  store[path] = value;
}

// Read the node at `path`, assembled the way real RTDB would see it:
// start from the exact key or the nearest shallower key that embeds this
// subpath, then overlay every deeper flat key (deeper = written later or
// seeded more specifically; `null` deletes that subpath). Empty → null.
function readAt(store, path) {
  let base;
  if (Object.prototype.hasOwnProperty.call(store, path)) {
    base = store[path];
  } else {
    for (let p = path; p.includes('/');) {
      p = p.slice(0, p.lastIndexOf('/'));
      if (Object.prototype.hasOwnProperty.call(store, p)) {
        base = dig(store[p], path.slice(p.length + 1).split('/'));
        break;
      }
    }
  }
  let val = clone(base);
  const overlays = Object.keys(store)
    .filter((k) => isAncestor(path, k))
    .sort((a, b) => a.split('/').length - b.split('/').length);
  for (const k of overlays) {
    const rel = k.slice(path.length + 1).split('/');
    val = setDeep(val, rel, clone(store[k]));
  }
  return prune(val);
}

function dig(value, keys) {
  let cur = value;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

function setDeep(value, keys, leaf) {
  const [head, ...rest] = keys;
  const node = (value != null && typeof value === 'object') ? value : {};
  node[head] = rest.length ? setDeep(node[head], rest, leaf) : leaf;
  return node;
}

// Drop null/undefined leaves and empty objects, the way RTDB prunes them
// out of existence on read. Returns null for an empty result.
function prune(value) {
  if (value == null) return null;
  if (typeof value !== 'object') return value;
  const out = Array.isArray(value) ? [] : {};
  let any = false;
  for (const [k, v] of Object.entries(value)) {
    const p = prune(v);
    if (p !== null) { out[k] = p; any = true; }
  }
  return any ? out : null;
}

const clone = (value) => (value != null && typeof value === 'object')
  ? JSON.parse(JSON.stringify(value))
  : value;

export function makeStoreDeps(store = {}) {
  return {
    store,
    getVal: jest.fn(async (path) => readAt(store, norm(path))),
    set: jest.fn(async (path, value) => { writeAt(store, norm(path), value); }),
    update: jest.fn(async (path, obj) => {
      const keys = Object.keys(obj).map((k) => norm(`${path}/${k}`)).sort();
      // Real RTDB rejects the whole update if any path is an ancestor of
      // another; sorted order puts an ancestor immediately before its
      // first descendant.
      for (let i = 1; i < keys.length; i += 1) {
        if (isAncestor(keys[i - 1], keys[i])) {
          throw new Error(`update failed: path '${keys[i - 1]}' is an ancestor of '${keys[i]}' — RTDB rejects overlapping update paths`);
        }
      }
      for (const [k, v] of Object.entries(obj)) writeAt(store, norm(`${path}/${k}`), v);
    }),
    transaction: jest.fn(async (path, fn) => {
      const p = norm(path);
      const next = fn(readAt(store, p));
      if (next === undefined) return { committed: false };
      writeAt(store, p, next);
      return { committed: true };
    }),
  };
}
