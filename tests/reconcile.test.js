// tests/reconcile.test.js
const { reconcileChildren } = require('../js/reconcile.js');

let container;
beforeEach(() => {
  document.body.innerHTML = '<ul id="c"></ul>';
  container = document.getElementById('c');
});

function makeOpts(overrides = {}) {
  return {
    create: jest.fn((key) => {
      const li = document.createElement('li');
      li.textContent = `node-${key}`;
      return li;
    }),
    update: jest.fn(),
    ...overrides,
  };
}

test('creates nodes for new keys in order, stamps data-reconcile-key', () => {
  const opts = makeOpts();
  reconcileChildren(container, ['a', 'b', 'c'], opts);
  const kids = [...container.children];
  expect(kids.map((n) => n.dataset.reconcileKey)).toEqual(['a', 'b', 'c']);
  expect(opts.create).toHaveBeenCalledTimes(3);
  expect(opts.update).toHaveBeenCalledTimes(3); // update runs for new nodes too
});

test('preserves node identity across reconciles; create runs once per key', () => {
  const opts = makeOpts();
  reconcileChildren(container, ['a', 'b'], opts);
  const a1 = container.children[0];
  reconcileChildren(container, ['a', 'b'], opts);
  expect(container.children[0]).toBe(a1);
  expect(opts.create).toHaveBeenCalledTimes(2); // not 4
  expect(opts.update).toHaveBeenCalledTimes(4); // every reconcile updates
});

test('a create-attached handler fires once per click after many reconciles', () => {
  const clicks = jest.fn();
  const opts = makeOpts({
    create: (key) => {
      const li = document.createElement('li');
      li.addEventListener('click', clicks);
      return li;
    },
  });
  reconcileChildren(container, ['a'], opts);
  reconcileChildren(container, ['a'], opts);
  reconcileChildren(container, ['a'], opts);
  container.children[0].click();
  expect(clicks).toHaveBeenCalledTimes(1);
});

test('removes nodes whose key is gone, calling onRemove first', () => {
  const removed = [];
  const opts = makeOpts({ onRemove: (n) => removed.push(n.dataset.reconcileKey) });
  reconcileChildren(container, ['a', 'b', 'c'], opts);
  reconcileChildren(container, ['a', 'c'], opts);
  expect([...container.children].map((n) => n.dataset.reconcileKey)).toEqual(['a', 'c']);
  expect(removed).toEqual(['b']);
});

test('reorders existing nodes to match keys without recreating', () => {
  const opts = makeOpts();
  reconcileChildren(container, ['a', 'b', 'c'], opts);
  const [a, b, c] = [...container.children];
  reconcileChildren(container, ['c', 'a', 'b'], opts);
  expect([...container.children]).toEqual([c, a, b]);
  expect(opts.create).toHaveBeenCalledTimes(3);
});

test('disjoint key sets fully replace (old removed via onRemove, new created)', () => {
  const removed = [];
  const opts = makeOpts({ onRemove: (n) => removed.push(n.dataset.reconcileKey) });
  reconcileChildren(container, ['a', 'b'], opts);
  reconcileChildren(container, ['x', 'y'], opts);
  expect([...container.children].map((n) => n.dataset.reconcileKey)).toEqual(['x', 'y']);
  expect(removed.sort()).toEqual(['a', 'b']);
});

test('unkeyed foreign children are removed', () => {
  const stray = document.createElement('li');
  container.appendChild(stray);
  reconcileChildren(container, ['a'], makeOpts());
  expect([...container.children].map((n) => n.dataset.reconcileKey)).toEqual(['a']);
});

test('empty keys clears the container through onRemove', () => {
  const removed = [];
  const opts = makeOpts({ onRemove: (n) => removed.push(n.dataset.reconcileKey) });
  reconcileChildren(container, ['a', 'b'], opts);
  reconcileChildren(container, [], opts);
  expect(container.children.length).toBe(0);
  expect(removed.sort()).toEqual(['a', 'b']);
});

test('numeric keys preserve node identity across reconciles (coerced to strings)', () => {
  const opts = makeOpts();
  reconcileChildren(container, [1, 2], opts);
  const first = container.children[0];
  reconcileChildren(container, [1, 2], opts);
  expect(container.children[0]).toBe(first);
  expect(opts.create).toHaveBeenCalledTimes(2);
});

test('a duplicate key within one keys list keeps the first occurrence only', () => {
  const opts = makeOpts();
  reconcileChildren(container, ['a', 'a', 'b'], opts);
  expect([...container.children].map((n) => n.dataset.reconcileKey)).toEqual(['a', 'b']);
  // Idempotent on the next tick:
  reconcileChildren(container, ['a', 'a', 'b'], opts);
  expect([...container.children].map((n) => n.dataset.reconcileKey)).toEqual(['a', 'b']);
});

test('re-entrant reconcile on the same container throws', () => {
  const opts = makeOpts({
    update: () => {
      reconcileChildren(container, ['x'], makeOpts());
    },
  });
  expect(() => reconcileChildren(container, ['a'], opts)).toThrow(/re-entrant/);
  // finally-cleanup: the container is reusable after the throw
  expect(() => reconcileChildren(container, ['a'], makeOpts())).not.toThrow();
});

test('a different container may reconcile from within update (no false positive)', () => {
  document.body.innerHTML += '<ul id="c2"></ul>';
  const c2 = document.getElementById('c2');
  const opts = makeOpts({
    update: () => { reconcileChildren(c2, ['x'], makeOpts()); },
  });
  expect(() => reconcileChildren(container, ['a'], opts)).not.toThrow();
  expect(c2.children.length).toBe(1);
});

test('create returning nothing throws with the offending key in the message', () => {
  const opts = makeOpts({ create: () => null });
  expect(() => reconcileChildren(container, ['badkey'], opts)).toThrow(/create\(badkey\)/);
});

test('moving the first node to the end preserves identity', () => {
  const opts = makeOpts();
  reconcileChildren(container, ['a', 'b', 'c'], opts);
  const a = container.children[0];
  reconcileChildren(container, ['b', 'c', 'a'], opts);
  expect([...container.children].map((n) => n.dataset.reconcileKey)).toEqual(['b', 'c', 'a']);
  expect(container.lastChild).toBe(a);
  expect(opts.create).toHaveBeenCalledTimes(3);
});
