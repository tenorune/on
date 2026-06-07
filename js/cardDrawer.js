// js/cardDrawer.js
// Shared per-card tool drawer. Collapses a user card's right-side action
// buttons behind a vertical ellipsis; tapping opens a slide-in slice.
// Consumed by following.js (and later groupContext.js) when a card has >=2
// right-side actions. Singleton: only one drawer open at a time.

let _open = null; // { slice, ellipsis, cleanup } | null

export function isCardDrawerOpen() {
  return _open !== null;
}

export function closeCardDrawer() {
  if (!_open) return;
  const { slice, cleanup } = _open;
  cleanup();
  slice.remove();
  _open = null;
  document.dispatchEvent(new CustomEvent('card-drawer-close'));
}

function openDrawer(ellipsis, actions) {
  const slice = document.createElement('div');
  slice.className = 'card-drawer';
  // Isolate every interaction inside the slice from card-level gesture
  // handlers (knock/call/long-press live on the parent li).
  slice.addEventListener('click', (e) => e.stopPropagation());
  slice.addEventListener('pointerdown', (e) => e.stopPropagation());

  for (const { el } of actions) {
    slice.appendChild(el);
  }

  ellipsis.insertAdjacentElement('afterend', slice);
  // Trigger the slide-in transition on the next frame.
  requestAnimationFrame(() => slice.classList.add('open'));

  _open = { slice, ellipsis, cleanup: () => {} };
  document.dispatchEvent(new CustomEvent('card-drawer-open'));
}

export function createCardDrawer(actions) {
  // actions: Array<{ el: HTMLElement, closesDrawer?: boolean }>
  const ellipsis = document.createElement('button');
  ellipsis.type = 'button';
  ellipsis.className = 'card-drawer-toggle';
  ellipsis.setAttribute('aria-label', 'More actions');
  ellipsis.textContent = '⋮'; // unicode vertical ellipsis U+22EE

  for (const { el, closesDrawer } of actions) {
    if (closesDrawer) el.addEventListener('click', () => closeCardDrawer());
  }

  ellipsis.addEventListener('click', (e) => {
    e.stopPropagation();
    const isMine = _open && _open.ellipsis === ellipsis;
    closeCardDrawer();
    if (!isMine) openDrawer(ellipsis, actions);
  });

  return ellipsis;
}
