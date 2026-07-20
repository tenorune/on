// js/locationHub.ts
// Multiplexes location watches the way presenceHub.ts multiplexes presence:
// one underlying onValue per node, fanned out to every consumer. Consumers
// subscribe to a DISTANCE (own point + peer point combined via haversine),
// not to raw nodes — so the own-location watch is shared by every row on
// screen, and no renderer ever holds raw peer coordinates beyond the combine.
import { watchLocation, watchLocationCell } from './db.js';
import { haversineMeters } from '../shared/geo.js';

type LocCb = (loc: LocationNode | null) => void;
interface NodeEntry {
  unsub: (() => void) | null;
  consumers: Set<LocCb>;
  last: LocationNode | null;
  hasValue: boolean;
}

const _nodes = new Map<string, NodeEntry>(); // key: `loc:${uid}` | `cell:${gid}/${uid}`

function subscribeNode(key: string, start: (cb: LocCb) => () => void, cb: LocCb): () => void {
  let e = _nodes.get(key);
  const isNew = !e;
  if (isNew) {
    e = { unsub: null, consumers: new Set(), last: null, hasValue: false };
    _nodes.set(key, e);
  }
  e!.consumers.add(cb);
  if (isNew) {
    e!.unsub = start((data) => {
      e!.last = data;
      e!.hasValue = true;
      for (const c of [...e!.consumers]) { try { c(data); } catch { /* one consumer threw */ } }
    });
  } else if (e!.hasValue) {
    const v = e!.last;
    Promise.resolve().then(() => {
      const cur = _nodes.get(key);
      if (cur && cur.consumers.has(cb)) cb(v);
    });
  }
  return () => {
    const cur = _nodes.get(key);
    if (!cur) return;
    cur.consumers.delete(cb);
    if (cur.consumers.size === 0) {
      if (cur.unsub) cur.unsub();
      _nodes.delete(key);
    }
  };
}

function combine(
  subA: (cb: LocCb) => () => void,
  subB: (cb: LocCb) => () => void,
  cb: (meters: number | null) => void,
): () => void {
  let a: LocationNode | null = null;
  let b: LocationNode | null = null;
  // Emit only on a CHANGED result: the own node feeds every pair, so one own
  // publish otherwise wakes every row on screen into an identical repaint
  // (audit F4). undefined = nothing emitted yet, so the first result — even
  // null — always delivers.
  let last: number | null | undefined;
  const emit = () => {
    let next: number | null = null;
    if (a && b && typeof a.lat === 'number' && typeof a.lng === 'number'
      && typeof b.lat === 'number' && typeof b.lng === 'number') {
      next = haversineMeters(a.lat, a.lng, b.lat, b.lng);
    }
    if (next === last) return;
    last = next;
    cb(next);
  };
  const unA = subA((v) => { a = v; emit(); });
  const unB = subB((v) => { b = v; emit(); });
  return () => { unA(); unB(); };
}

export function subscribeDistance(myUid: string, peerUid: string, cb: (meters: number | null) => void) {
  return combine(
    (c) => subscribeNode(`loc:${myUid}`, (h) => watchLocation(myUid, h), c),
    (c) => subscribeNode(`loc:${peerUid}`, (h) => watchLocation(peerUid, h), c),
    cb,
  );
}

export function subscribeCellDistance(gid: string, myUid: string, peerUid: string, cb: (meters: number | null) => void) {
  return combine(
    (c) => subscribeNode(`cell:${gid}/${myUid}`, (h) => watchLocationCell(gid, myUid, h), c),
    (c) => subscribeNode(`cell:${gid}/${peerUid}`, (h) => watchLocationCell(gid, peerUid, h), c),
    cb,
  );
}

export function _activeLocationWatchCount() { return _nodes.size; }

export function _resetLocationHub() {
  for (const e of _nodes.values()) { if (e.unsub) e.unsub(); }
  _nodes.clear();
}
