// js/notifyBell.js
// Shared per-person notification bell + 3-switch popover.
// Consumed by following.js (Direct) and groupContext.js (group roster).
import { getNotifyPrefs, setNotifyPref } from './prefs.js';

type NotifyType = 'knock' | 'call' | 'availability';
const TYPES: { type: NotifyType; label: string }[] = [
  { type: 'knock', label: 'Knocks' },
  { type: 'call', label: 'Calls' },
  { type: 'availability', label: 'Available' },
];

const BELL_SVG = '<svg viewBox="0 0 122.88 122.83" fill="currentColor" aria-hidden="true" focusable="false"><path d="M73.81,7.47A43.14,43.14,0,0,1,92.69,19.35a42.33,42.33,0,0,1,10.76,21.36l0,.28c.21,1.21.36,2.36.45,3.44.11,1.26.17,2.53.17,3.8h0V58.36c0,2.81,0,5.67.2,8.54a32.41,32.41,0,0,0,4.34,14.62A36.6,36.6,0,0,0,120,92.83a6.34,6.34,0,0,1,2.65,3.65,6.52,6.52,0,0,1-.08,3.56,6.62,6.62,0,0,1-1.91,3,6.33,6.33,0,0,1-4.25,1.57H82.27l0,.08h0c-4.14,24.2-37.61,24.13-41.65-.08H6.45A6.33,6.33,0,0,1,2,102.92a6.6,6.6,0,0,1-1.81-6.5A6.33,6.33,0,0,1,3,92.71c5.66-3.83,9.62-8,12.12-12.76s3.65-10.44,3.65-17.28V48.23c0-1.16.06-2.42.18-3.77s.29-2.52.51-3.76A42.89,42.89,0,0,1,49.39,7.41C54-2.47,69.2-2.49,73.81,7.47ZM87.71,24A36.34,36.34,0,0,0,70.38,13.57,3.42,3.42,0,0,1,68,11.22c-1.71-5.87-11-6-12.72-.05a3.43,3.43,0,0,1-2.48,2.38A36.1,36.1,0,0,0,26.15,41.9q-.28,1.58-.42,3.15c-.09,1-.13,2-.13,3.18V62.67c0,7.91-1.38,14.56-4.45,20.43-2.94,5.62-7.36,10.39-13.54,14.72H115.27A42.38,42.38,0,0,1,102.8,85,39.18,39.18,0,0,1,97.5,67.4c-.22-2.88-.21-6-.2-9V48.23h0c0-1.1,0-2.17-.13-3.22s-.21-2-.36-2.85l-.06-.27a35.62,35.62,0,0,0-9-17.9Z"/></svg>';

let _openPopover: HTMLElement | null = null;
let _outsideHandler: ((ev: MouseEvent) => void) | null = null;
let _repositionHandler: (() => void) | null = null;

function closeOpenPopover() {
  if (_openPopover) { _openPopover.remove(); _openPopover = null; }
  if (_outsideHandler) { document.removeEventListener('click', _outsideHandler); _outsideHandler = null; }
  if (_repositionHandler) {
    window.removeEventListener('scroll', _repositionHandler, true);
    window.removeEventListener('resize', _repositionHandler);
    _repositionHandler = null;
  }
}

export function dismissNotifyPopover() { closeOpenPopover(); }

// True while a bell popover is on screen. Callers (e.g. the group roster) treat
// it as a modal: a tap on a row while it's open just dismisses the popover and
// must not knock or arm long-press adoption.
export function isNotifyPopoverOpen() {
  return _openPopover != null && document.contains(_openPopover);
}

// Anchor the popover just under the bell with its right edge aligned, in
// viewport coordinates. The popover is rendered at <body> (a portal) so no
// card/slice overflow, transform, or stacking context can clip it — the cause
// of it vanishing when nested inside the drawer slice.
function positionPopover(popover: HTMLElement, bell: HTMLElement) {
  const r = bell.getBoundingClientRect();
  popover.style.top = `${Math.round(r.bottom + 4)}px`;
  popover.style.right = `${Math.round(Math.max(8, window.innerWidth - r.right))}px`;
  popover.style.left = 'auto';
}

// When the surrounding card drawer closes (Escape/scroll/outside-tap), tear
// down any popover we opened inside it so module state doesn't go stale.
document.addEventListener('card-drawer-close', () => closeOpenPopover());

function paintBell(bell: HTMLElement, targetUid: string, typeKeys: NotifyType[]) {
  const p = getNotifyPrefs(targetUid);
  bell.classList.toggle('active', typeKeys.some((t) => p[t]));
}

export function createNotifyBell(targetUid: string, { types, onNeedPermission }: { types?: string[]; onNeedPermission?: () => void } = {}) {
  const shown = (types && types.length) ? TYPES.filter((t) => types.includes(t.type)) : TYPES;
  const typeKeys = shown.map((t) => t.type);

  const bell = document.createElement('button');
  bell.className = 'notify-bell';
  bell.type = 'button';
  bell.setAttribute('aria-label', 'Notification settings');
  bell.innerHTML = BELL_SVG;
  paintBell(bell, targetUid, typeKeys);

  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    // If the stored popover is no longer in the DOM (e.g. parent reset), clear state first.
    if (_openPopover && !document.contains(_openPopover)) { _openPopover = null; }

    if (_openPopover && _openPopover.dataset.target === targetUid) { closeOpenPopover(); return; }
    closeOpenPopover();

    // Single-type bell: the bell IS the toggle — no popover.
    if (shown.length === 1) {
      const type = shown[0].type;
      const next = !(getNotifyPrefs(targetUid)[type]);
      setNotifyPref(targetUid, type, next);
      paintBell(bell, targetUid, typeKeys);
      if (next && typeof onNeedPermission === 'function') onNeedPermission();
      return;
    }

    const popover = document.createElement('div');
    popover.className = 'notify-popover';
    popover.dataset.target = targetUid;
    const prefs = getNotifyPrefs(targetUid);
    for (const { type, label } of shown) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'notify-switch';
      row.setAttribute('role', 'switch');
      row.setAttribute('aria-checked', String(prefs[type]));
      row.dataset.type = type;
      row.textContent = label;
      row.classList.toggle('on', prefs[type]);
      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const next = !(getNotifyPrefs(targetUid)[type]);
        setNotifyPref(targetUid, type, next);
        row.setAttribute('aria-checked', String(next));
        row.classList.toggle('on', next);
        paintBell(bell, targetUid, typeKeys);
        if (next && typeof onNeedPermission === 'function') onNeedPermission();
      });
      popover.appendChild(row);
    }
    document.body.appendChild(popover);
    positionPopover(popover, bell);
    _openPopover = popover;

    // Outside-tap dismiss (mirrors groupContext settings handler).
    _outsideHandler = (ev) => {
      const t = ev.target as Node;
      if (popover.contains(t) || bell.contains(t)) return;
      closeOpenPopover();
    };
    document.addEventListener('click', _outsideHandler);

    // The popover is fixed-positioned and doesn't follow the bell on scroll or
    // resize — dismiss it rather than let it drift away from its anchor.
    _repositionHandler = () => closeOpenPopover();
    window.addEventListener('scroll', _repositionHandler, true);
    window.addEventListener('resize', _repositionHandler);
  });

  document.addEventListener('notify-prefs-synced', () => paintBell(bell, targetUid, typeKeys));
  return bell;
}
