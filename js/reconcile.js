// js/reconcile.js
// Keyed child reconciliation for the list renderers (nav row, group roster,
// Direct contact list). Previously each renderer did `innerHTML = ''` + full
// rebuild on every data tick, destroying transient DOM state (focus,
// animations, open card-drawers, knock float ordering) and re-attaching every
// listener. This converges a container's children to a desired ordered key
// list instead: nodes persist for the lifetime of their key.
//
// Contract:
// - The CALLER owns ordering; `keys` is the full desired ordered child list.
// - Keys are coerced to strings on entry (e.g. numeric keys work correctly).
// - Duplicate keys — in the DOM or in `keys` — keep the first occurrence.
// - create(key) builds a node once per key lifetime — attach event handlers
//   here, and make them read live state at event time (the node outlives the
//   render that created it, so render-time closures go stale).
// - update(node, key) runs on EVERY reconcile, for new and surviving nodes —
//   in-place paint only (text/classes/styles); never handlers or structure.
//   Conditional state must be cleared as well as set. update must not touch
//   container structure — structural changes belong on the key list itself.
// - onRemove(node), optional, runs before a node is removed (used to close a
//   card-drawer living inside a removed row).
// - create/update/onRemove must not re-enter reconcileChildren on the same
//   container — guarded with a throw (but a different container is fine).
// - Children without a data-reconcile-key are removed (renderers own their
//   containers exclusively); duplicate keys keep the first node.

const _inFlight = new WeakSet();

export function reconcileChildren(container, keys, { create, update, onRemove }) {
  // Coerce all keys to strings once at entry so type-mismatches are impossible.
  keys = keys.map(String);

  if (_inFlight.has(container)) {
    throw new Error('reconcileChildren: re-entrant reconcile on the same container');
  }
  _inFlight.add(container);

  try {
    const want = new Set(keys);
    const byKey = new Map();
    for (const child of [...container.children]) {
      const k = child.dataset.reconcileKey;
      if (k !== undefined && want.has(k) && !byKey.has(k)) {
        byKey.set(k, child);
      } else {
        if (onRemove) { try { onRemove(child); } catch { /* hook threw */ } }
        child.remove();
      }
    }
    const seen = new Set();
    let cursor = null; // last correctly-positioned node
    for (const key of keys) {
      if (seen.has(key)) continue;
      seen.add(key);
      let node = byKey.get(key);
      if (!node) {
        node = create(key);
        if (!node) throw new Error(`reconcileChildren: create(${key}) returned no node`);
        node.dataset.reconcileKey = key;
      }
      update(node, key);
      const expected = cursor ? cursor.nextSibling : container.firstChild;
      if (node !== expected) container.insertBefore(node, expected);
      cursor = node;
    }
  } finally {
    _inFlight.delete(container);
  }
}
