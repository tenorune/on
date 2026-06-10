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
// - create(key) builds a node once per key lifetime — attach event handlers
//   here, and make them read live state at event time (the node outlives the
//   render that created it, so render-time closures go stale).
// - update(node, key) runs on EVERY reconcile, for new and surviving nodes —
//   in-place paint only (text/classes/styles); never handlers or structure.
//   Conditional state must be cleared as well as set.
// - onRemove(node), optional, runs before a node is removed (used to close a
//   card-drawer living inside a removed row).
// - Children without a data-reconcile-key are removed (renderers own their
//   containers exclusively); duplicate keys keep the first node.

export function reconcileChildren(container, keys, { create, update, onRemove }) {
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
  let cursor = null; // last correctly-positioned node
  for (const key of keys) {
    let node = byKey.get(key);
    if (!node) {
      node = create(key);
      node.dataset.reconcileKey = key;
    }
    update(node, key);
    const expected = cursor ? cursor.nextSibling : container.firstChild;
    if (node !== expected) container.insertBefore(node, expected);
    cursor = node;
  }
}
