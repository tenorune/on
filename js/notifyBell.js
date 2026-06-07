// js/notifyBell.js
// Shared per-person notification bell + 3-switch popover.
// Consumed by following.js (Direct) and groupContext.js (group roster).
import { getNotifyPrefs, setNotifyPref } from './prefs.js';

const TYPES = [
  { type: 'knock', label: 'Knocks' },
  { type: 'call', label: 'Calls' },
  { type: 'availability', label: 'Available' },
];

let _openPopover = null;
let _outsideHandler = null;

function closeOpenPopover() {
  if (_openPopover) { _openPopover.remove(); _openPopover = null; }
  if (_outsideHandler) { document.removeEventListener('click', _outsideHandler); _outsideHandler = null; }
}

function paintBell(bell, targetUid, typeKeys) {
  const p = getNotifyPrefs(targetUid);
  bell.classList.toggle('active', typeKeys.some((t) => p[t]));
}

export function createNotifyBell(targetUid, { types, onNeedPermission } = {}) {
  const shown = (types && types.length) ? TYPES.filter((t) => types.includes(t.type)) : TYPES;
  const typeKeys = shown.map((t) => t.type);

  const bell = document.createElement('button');
  bell.className = 'notify-bell';
  bell.type = 'button';
  bell.setAttribute('aria-label', 'Notification settings');
  bell.textContent = '\u{1F514}'; // 🔔
  paintBell(bell, targetUid, typeKeys);

  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    // If the stored popover is no longer in the DOM (e.g. parent reset), clear state first.
    if (_openPopover && !document.contains(_openPopover)) { _openPopover = null; }
    if (_openPopover && _openPopover.dataset.target === targetUid) { closeOpenPopover(); return; }
    closeOpenPopover();

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
    bell.insertAdjacentElement('afterend', popover);
    _openPopover = popover;

    // Outside-tap dismiss (mirrors groupContext settings handler).
    _outsideHandler = (ev) => {
      if (popover.contains(ev.target) || bell.contains(ev.target)) return;
      closeOpenPopover();
    };
    document.addEventListener('click', _outsideHandler);
  });

  document.addEventListener('notify-prefs-synced', () => paintBell(bell, targetUid, typeKeys));
  return bell;
}
