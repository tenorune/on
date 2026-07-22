// js/statusStore.ts — one subscribable source of truth for the user's OWN
// effective status per context (Direct + each group). Modeled on presenceHub.ts:
// ref-counted underlying watches, a last-value cache, async replay to late
// subscribers, and a _forTests reset. The own primary presence comes through
// presenceHub (one multiplexed watchPresence); each group's own override comes
// through watchOwnMemberOverride. effectiveStatus (js/status.ts) merges them.
//
// Roadmap Task 2.2 added the base merged-snapshot API — initStatusStore,
// subscribeOwnStatus, pushOptimistic, _resetStatusStoreForTests. Task 2.3 adds
// the RAW own-override surface (setWatchedGroups / subscribeOwnOverride /
// getOwnOverride) that groupNav/groupContext consume: enumeration-driven watch
// management and a synchronously-replayed raw cache, sharing one underlying
// watchOwnMemberOverride per group with the merged-snapshot consumers.
import { subscribePresence } from './presenceHub.js';
import { watchOwnMemberOverride } from './db.js';
import { effectiveStatus } from './status.js';
import type { EffectiveStatus, StatusInput, OverrideInput } from './status.js';

// The merged snapshot every consumer paints. `source` records which input won
// the merge (override iff enabled, else primary) — the migration's raw surface
// and the boot fan-out both key off it.
export type StatusSnapshot = EffectiveStatus & { source: 'primary' | 'override' };

type SnapshotCb = (snap: StatusSnapshot) => void;
// Raw-override subscribers (groupNav/groupContext) read override fields directly.
type OverrideCb = (override: OverrideInput | null) => void;

// Direct context (groupId null) has no override — key its consumer set under a
// sentinel so one Map holds Direct + every per-group subscriber.
const DIRECT = Symbol('direct');
type GroupKey = string | typeof DIRECT;
const keyOf = (groupId: string | null): GroupKey => (groupId === null ? DIRECT : groupId);

let _myUserId: string | null = null;

// Own primary presence — ONE underlying presenceHub subscription, ref-counted
// across every status consumer (Direct + all groups).
let _primaryUnsub: (() => void) | null = null;
let _primaryCache: StatusInput | null = null;
let _primaryTicked = false;

// Per-group own override — one watchOwnMemberOverride per group with ≥1 consumer.
const _overrideUnsubs = new Map<string, () => void>();
const _overrideCache = new Map<string, OverrideInput | null>();
const _overrideTicked = new Set<string>();

// Merged-snapshot subscribers, keyed by group (or DIRECT).
const _consumers = new Map<GroupKey, Set<SnapshotCb>>();

// Raw-override subscribers, and the enumeration-driven watched set. Together with
// _consumers these are the THREE things that keep a group's underlying
// watchOwnMemberOverride alive: an override watch exists for a group iff it is in
// _watched, OR has ≥1 raw override consumer, OR has ≥1 merged-snapshot consumer.
const _overrideConsumers = new Map<string, Set<OverrideCb>>();
const _watched = new Set<string>();

export function initStatusStore(myUserId: string): void {
  _resetStatusStoreForTests();
  _myUserId = myUserId;
}

function computeSnapshot(groupId: string | null): StatusSnapshot {
  const override = groupId === null ? null : (_overrideCache.get(groupId) ?? null);
  const eff = effectiveStatus(_primaryCache, override);
  const source: 'primary' | 'override' = override && override.enabled === true ? 'override' : 'primary';
  return { ...eff, source };
}

// A snapshot is only meaningful once its inputs have delivered a real value: the
// primary always, plus (for a group) that group's override. Mirrors the ticked
// guard in presenceHub/ownStatus — never fabricate a null snapshot.
function isComputable(groupId: string | null): boolean {
  if (!_primaryTicked) return false;
  return groupId === null || _overrideTicked.has(groupId);
}

function fanOut(groupId: string | null): void {
  if (!isComputable(groupId)) return;
  const set = _consumers.get(keyOf(groupId));
  if (!set) return;
  const snap = computeSnapshot(groupId);
  // Copy before iterating + re-check membership: a consumer that unsubscribes a
  // peer (or itself) mid-fan-out must not skip the survivors (presenceHub:43-44).
  for (const cb of [...set]) {
    if (!set.has(cb)) continue;
    try { cb(snap); } catch { /* one consumer threw — keep going */ }
  }
}

function ensurePrimaryWatch(): void {
  if (_primaryUnsub || _myUserId === null) return;
  _primaryUnsub = subscribePresence(_myUserId, (data) => {
    _primaryCache = data;
    _primaryTicked = true;
    // Every context's snapshot depends on the primary — re-emit for all.
    for (const key of _consumers.keys()) fanOut(key === DIRECT ? null : key);
  });
}

// Synchronous fan-out of the raw cached override to its consumers. Unlike the
// merged-snapshot replay (async, to avoid re-entering a caller's render), the raw
// surface feeds click handlers/paint that read it now — a server tick or an
// optimistic push repaints synchronously.
function fanOutOverride(groupId: string): void {
  if (!_overrideTicked.has(groupId)) return;
  const set = _overrideConsumers.get(groupId);
  if (!set) return;
  const value = _overrideCache.get(groupId) ?? null;
  for (const cb of [...set]) {
    if (!set.has(cb)) continue;
    try { cb(value); } catch { /* one consumer threw — keep going */ }
  }
}

function ensureOverrideWatch(groupId: string): void {
  if (_overrideUnsubs.has(groupId) || _myUserId === null) return;
  _overrideUnsubs.set(groupId, watchOwnMemberOverride(groupId, _myUserId, (override) => {
    _overrideCache.set(groupId, override);
    _overrideTicked.add(groupId);
    fanOut(groupId);          // merged-snapshot consumers
    fanOutOverride(groupId);  // raw-override consumers
  }));
}

// A group's underlying override watch is wanted while ANY of the three sources
// keep it: enumeration (_watched), a raw consumer, or a merged-snapshot consumer.
function overrideWanted(groupId: string): boolean {
  if (_watched.has(groupId)) return true;
  const raw = _overrideConsumers.get(groupId);
  if (raw && raw.size > 0) return true;
  const snap = _consumers.get(groupId);
  return !!(snap && snap.size > 0);
}

function teardownOverrideIfIdle(groupId: string): void {
  if (overrideWanted(groupId)) return;
  const unsub = _overrideUnsubs.get(groupId);
  if (unsub) unsub();
  _overrideUnsubs.delete(groupId);
  _overrideCache.delete(groupId);
  _overrideTicked.delete(groupId);
}

function teardownPrimaryIfIdle(): void {
  for (const set of _consumers.values()) if (set.size > 0) return; // any consumer keeps it alive
  if (_primaryUnsub) _primaryUnsub();
  _primaryUnsub = null;
  _primaryCache = null;
  _primaryTicked = false;
}

export function subscribeOwnStatus(groupId: string | null, cb: SnapshotCb): () => void {
  const key = keyOf(groupId);
  let set = _consumers.get(key);
  if (!set) { set = new Set(); _consumers.set(key, set); }
  set.add(cb);
  ensurePrimaryWatch();
  if (groupId !== null) ensureOverrideWatch(groupId);
  // Replay the cached snapshot to a late subscriber — async, so we never re-enter
  // the caller's render synchronously (presenceHub contract). Only once the
  // inputs have ticked.
  if (isComputable(groupId)) {
    const snap = computeSnapshot(groupId);
    Promise.resolve().then(() => {
      const cur = _consumers.get(key);
      if (cur && cur.has(cb)) { try { cb(snap); } catch { /* replay threw */ } }
    });
  }
  return () => {
    const cur = _consumers.get(key);
    if (!cur) return;
    cur.delete(cb);
    if (cur.size === 0) _consumers.delete(key);
    if (groupId !== null) teardownOverrideIfIdle(groupId);
    teardownPrimaryIfIdle();
  };
}

// Enumeration-driven watch management: the caller (groupNav) passes the set of
// currently-enumerated groups. Watches are created for newly-watched groups and
// torn down for dropped ones that no consumer still keeps alive.
export function setWatchedGroups(groupIds: string[]): void {
  const next = new Set(groupIds);
  for (const gid of [..._watched]) {
    if (!next.has(gid)) {
      _watched.delete(gid);           // drop before the idle check reads it
      teardownOverrideIfIdle(gid);
    }
  }
  for (const gid of next) {
    if (!_watched.has(gid)) {
      _watched.add(gid);
      ensureOverrideWatch(gid);
    }
  }
}

// Subscribe to a group's RAW override. Replays the cached value SYNCHRONOUSLY —
// but only once the underlying watch (or an optimistic seed) has ticked, so a
// late subscriber never receives a fabricated null.
export function subscribeOwnOverride(groupId: string, cb: OverrideCb): () => void {
  let set = _overrideConsumers.get(groupId);
  if (!set) { set = new Set(); _overrideConsumers.set(groupId, set); }
  set.add(cb);
  ensureOverrideWatch(groupId);
  if (_overrideTicked.has(groupId)) {
    const value = _overrideCache.get(groupId) ?? null;
    try { cb(value); } catch { /* replay threw */ }
  }
  return () => {
    const cur = _overrideConsumers.get(groupId);
    if (!cur) return;
    cur.delete(cb);
    if (cur.size === 0) _overrideConsumers.delete(groupId);
    teardownOverrideIfIdle(groupId);
  };
}

// Synchronous read of the optimistic-merged cache, for click handlers reading
// override fields at click time.
export function getOwnOverride(groupId: string): OverrideInput | null {
  return _overrideCache.get(groupId) ?? null;
}

export function pushOptimistic(groupId: string | null, partial: Partial<OverrideInput>): void {
  // Direct has no override to merge into — no-op (the null arm stays per the
  // roadmap pin; a Direct optimistic path may arrive in a later task).
  if (groupId === null) return;
  const merged: OverrideInput = { ...(_overrideCache.get(groupId) ?? {}), ...partial };
  _overrideCache.set(groupId, merged);
  // An optimistic write is a legitimate first value (the create-group seed runs
  // before any server tick), so mark ticked and fan out synchronously — the
  // optimistic paint must land before toggleStatusOverride's write round-trips.
  _overrideTicked.add(groupId);
  fanOut(groupId);          // merged-snapshot consumers
  fanOutOverride(groupId);  // raw-override consumers
}

export function _resetStatusStoreForTests(): void {
  if (_primaryUnsub) _primaryUnsub();
  _primaryUnsub = null;
  _primaryCache = null;
  _primaryTicked = false;
  for (const unsub of _overrideUnsubs.values()) unsub();
  _overrideUnsubs.clear();
  _overrideCache.clear();
  _overrideTicked.clear();
  _overrideConsumers.clear();
  _watched.clear();
  _consumers.clear();
  _myUserId = null;
}
