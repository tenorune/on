// js/cardDrawer.js
// Shared per-card tool drawer. Collapses a user card's right-side action
// buttons behind a vertical ellipsis; tapping opens a slide-in slice.
// Consumed by following.js (and later groupContext.js) when a card has >=2
// right-side actions. Singleton: only one drawer open at a time.

interface ActionItem { el: HTMLElement; closesDrawer?: boolean; }
interface OpenDrawer { slice: HTMLElement; clip: HTMLElement; ellipsis: HTMLElement; cleanup: () => void; }

let _open: OpenDrawer | null = null; // { slice, clip, ellipsis, cleanup } | null

export function isCardDrawerOpen() {
  return _open !== null;
}

export function closeCardDrawer() {
  if (!_open) return;
  const { clip, cleanup } = _open;
  cleanup();
  clip.remove();
  _open = null;
  document.dispatchEvent(new CustomEvent('card-drawer-close'));
}

function openDrawer(ellipsis: HTMLElement, actions: ActionItem[]) {
  const slice = document.createElement('div');
  slice.className = 'card-drawer';
  // Isolate every interaction inside the slice from card-level gesture
  // handlers (knock/call/long-press live on the parent li).
  slice.addEventListener('click', (e) => e.stopPropagation());
  slice.addEventListener('pointerdown', (e) => e.stopPropagation());

  for (const { el } of actions) {
    slice.appendChild(el);
  }

  // Wrap the slice in a clip layer that spans the card. The slice slides in from
  // the card's own right edge (clipped by the wrapper) rather than from off the
  // screen. The wrapper is transparent and click-through; only the slice is
  // interactive. Clipping here (not on the card) leaves the card's call-mode
  // glow — an outward box-shadow on the row — unclipped.
  const clip = document.createElement('div');
  clip.className = 'card-drawer-clip';
  clip.appendChild(slice);

  ellipsis.insertAdjacentElement('afterend', clip);
  // Trigger the slide-in transition on the next frame.
  requestAnimationFrame(() => slice.classList.add('open'));

  const onOutside = (e: Event) => {
    const target = e.target as Element;
    if (slice.contains(target) || ellipsis.contains(target)) return;
    // The bell popover is portaled to <body> (outside the slice). Taps inside it
    // must not close the drawer — the popover manages its own dismissal.
    if (target.closest && target.closest('.notify-popover')) return;
    // A tap on a *different* card's toggle must reach that toggle's own click
    // handler (it manages the singleton itself by closing us then opening). Only
    // close here; do not consume, or the other drawer would never open.
    if (target.closest && target.closest('.card-drawer-toggle')) {
      closeCardDrawer();
      return;
    }
    // Consume the dismiss tap: while the drawer is open, an outside tap only
    // closes it — it must not also trigger card interactions (knock/call) or
    // open another card's drawer.
    e.stopPropagation();
    closeCardDrawer();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeCardDrawer(); };
  const onScroll = closeCardDrawer;

  const cleanup = () => {
    document.removeEventListener('click', onOutside, true);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('scroll', onScroll, true);
  };

  _open = { slice, clip, ellipsis, cleanup };
  document.dispatchEvent(new CustomEvent('card-drawer-open'));

  // Register AFTER dispatch so the synchronous opening click cannot immediately
  // re-close: the listener does not exist yet when that click fires. Capture
  // phase (true) so taps are seen before any stopPropagation inside the slice;
  // scroll is captured because scroll events don't bubble.
  document.addEventListener('click', onOutside, true);
  document.addEventListener('keydown', onKey);
  document.addEventListener('scroll', onScroll, true);
}

export function createCardDrawer(actions: ActionItem[]) {
  // actions: Array<{ el: HTMLElement, closesDrawer?: boolean }>
  const ellipsis = document.createElement('button');
  ellipsis.type = 'button';
  ellipsis.className = 'card-drawer-toggle';
  ellipsis.setAttribute('aria-label', 'More actions');
  ellipsis.textContent = '⋮'; // unicode vertical ellipsis U+22EE

  for (const { el, closesDrawer } of actions) {
    if (closesDrawer) el.addEventListener('click', () => closeCardDrawer());
  }

  // The card's swipe-to-call gesture is armed on a li-level pointerdown; stop
  // pointerdown here so tapping the toggle never arms it (mirrors the slice).
  ellipsis.addEventListener('pointerdown', (e) => e.stopPropagation());

  ellipsis.addEventListener('click', (e) => {
    e.stopPropagation();
    const isMine = _open && _open.ellipsis === ellipsis;
    closeCardDrawer();
    if (!isMine) openDrawer(ellipsis, actions);
  });

  return ellipsis;
}
