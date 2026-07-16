// js/me.js
import { setStatus, isAvailable, formatTimeRemaining, timeRemainingMs } from './db.js';
import { getPaletteState } from './store.js';
import { PALETTES_ENABLED } from './features.js';
import { saveCombo, buildDirectCombo } from './favorites.js';
import { applyThemeHint, restoreSetSwitchPulse } from './palettes.js';
import { markHintSeen, getLastTimeout, setLastTimeout } from './prefs.js';
import { CHIP_VALUES, chipIndexForMinutes } from './status.js';

let savingEnabled = false;
let countdownTimer: ReturnType<typeof setInterval> | null = null;
let currentChipIndex = 3; // default: 2 hours
let firstUseActive = false;
let ownStatusSignalled = false;
let onOwnStatusReady: (() => void) | null = null;

function migrateToChipIndex() {
  return chipIndexForMinutes(getLastTimeout());
}

// Called when the userPrefs-synced lastTimeoutMinutes changes (cross-device).
// Reflects the user's chip selection from another device on this device.
function updateChipFromServer(minutes: number) {
  if (!minutes) return;
  const newIndex = chipIndexForMinutes(minutes);
  if (newIndex === currentChipIndex) return;
  currentChipIndex = newIndex;
  const timeChip = document.getElementById('time-chip');
  if (timeChip) timeChip.textContent = CHIP_VALUES[newIndex].text;
  setLastTimeout(CHIP_VALUES[newIndex].minutes);
}

export function initHeader(myUserId: string) {
  ownStatusSignalled = false;
  // Sibling-device chip pick echoes through userPrefs → 'last-timeout-synced';
  // update the Direct chip text to match.
  document.addEventListener('last-timeout-synced', (e) => {
    const detail = (e as CustomEvent<{ minutes?: number }>).detail;
    if (typeof detail?.minutes === 'number') updateChipFromServer(detail.minutes);
  });
  const dot = document.getElementById('my-dot')!;
  const timeChip = document.getElementById('time-chip')!;
  const mycodeChip = document.getElementById('mycode-chip')!;
  const drawer = document.getElementById('code-drawer')!;

  currentChipIndex = migrateToChipIndex();
  timeChip.textContent = CHIP_VALUES[currentChipIndex].text;

  dot.addEventListener('click', async () => {
    if (dot.classList.contains('available')) {
      await setStatus(myUserId, 'unavailable', null);
      setUnavailable();
    } else {
      const { minutes } = CHIP_VALUES[currentChipIndex];
      const availableUntil = Date.now() + minutes * 60000;
      await setStatus(myUserId, 'available', availableUntil);
      // prefs.setLastTimeout writes both localStorage AND
      // userPrefs/{uid}/lastTimeoutMinutes.
      setLastTimeout(minutes);
      setAvailable(availableUntil);
    }
  });

  timeChip.addEventListener('click', async () => {
    if (!document.getElementById('my-dot')!.classList.contains('available')) return;
    currentChipIndex = (currentChipIndex + 1) % CHIP_VALUES.length;
    const { minutes, text } = CHIP_VALUES[currentChipIndex];
    timeChip.textContent = text;
    const availableUntil = Date.now() + minutes * 60000;
    await setStatus(myUserId, 'available', availableUntil);
    const tr = document.getElementById('time-remaining')!;
    tr.textContent = formatTimeRemaining(timeRemainingMs(availableUntil)) + ' left';
    setLastTimeout(minutes);
  });

  mycodeChip.addEventListener('click', () => {
    const isOpen = drawer.classList.contains('open');
    drawer.classList.toggle('open');
    mycodeChip.classList.toggle('active', !isOpen);
    if (isOpen) {
      // Drawer is closing — collapse the secret-phrase pill back to Idle so the
      // user doesn't see the revealed phrase next time they open the drawer.
      document.getElementById('recovery-revealed')?.classList.add('hidden');
      // …unless the row is showing the "phrase lives on the web" note instead
      // (onramp-linked TG account — telegramSettings.js hid the pill on purpose;
      // resurrecting it would show a no-op pill beside the note).
      const elsewhereNote = document.getElementById('recovery-elsewhere-note');
      if (!elsewhereNote || elsewhereNote.classList.contains('hidden')) {
        document.getElementById('recovery-show-pill')?.classList.remove('hidden');
      }
      const copyBtn = document.getElementById('drawer-recovery-copy-btn');
      if (copyBtn) copyBtn.textContent = 'Copy';
    }
  });
}

// Strips the FTU pulse from both dots. Idempotent; safe to call when neither
// dot is wearing the class. Exposed so groupContext.js can re-install its own
// once-listener after the cloneNode-replace that wipes any handler we attach
// here.
export function clearFirstUsePulse() {
  document.getElementById('my-dot')?.classList.remove('first-use-pulse');
  document.getElementById('group-my-dot')?.classList.remove('first-use-pulse');
}

export function enterFirstUseMode() {
  firstUseActive = true;
  const directDot = document.getElementById('my-dot');
  const groupDot = document.getElementById('group-my-dot');
  const dots = [directDot, groupDot].filter((d): d is HTMLElement => d != null);
  if (dots.length === 0) return;
  for (const dot of dots) {
    dot.classList.add('first-use-pulse');
    dot.addEventListener('click', clearFirstUsePulse, { once: true });
  }
}

export function setOwnStatusReadyCallback(fn: () => void) {
  onOwnStatusReady = fn;
}

export function applyOwnStatus(status: string | null, availableUntil: number | null) {
  if (!ownStatusSignalled) {
    ownStatusSignalled = true;
    onOwnStatusReady?.();
  }
  if (firstUseActive) {
    if (isAvailable(status, availableUntil)) {
      firstUseActive = false;
      setAvailable(availableUntil);
    } else {
      setKnockKnock();
    }
    savingEnabled = true;
    return;
  }
  if (isAvailable(status, availableUntil)) {
    setAvailable(availableUntil);
  } else {
    setUnavailable();
  }
  savingEnabled = true;
}

function setKnockKnock() {
  const dot   = document.getElementById('my-dot')!;
  const label = document.getElementById('my-status-label')!;
  const chips = document.getElementById('header-chips')!;

  dot.classList.add('available');
  chips.style.opacity = '0';
  chips.style.pointerEvents = 'none';
  label.classList.remove('available');
  label.textContent = '';
  label.style.opacity = '1';
}

function setAvailable(availableUntil: number | null) {
  const dot = document.getElementById('my-dot')!;
  if (PALETTES_ENABLED && savingEnabled && !dot.classList.contains('available')) saveCombo(buildDirectCombo());
  // Track that user went available with a non-default color (for theme hint)
  if (PALETTES_ENABLED && !dot.classList.contains('available')) {
    const ps = getPaletteState();
    if (ps.sets[String(ps.activeSet)].selectedColor) {
      markHintSeen('customAvail');
    }
  }
  const label = document.getElementById('my-status-label')!;
  const chips = document.getElementById('header-chips')!;

  // Immediate: dot changes and old label starts fading out
  dot.classList.remove('dot-go-hint');
  dot.classList.add('available');
  label.style.opacity = '0';

  // clearInterval(null) is a no-op at runtime; the cast only appeases the checker.
  clearInterval(countdownTimer as ReturnType<typeof setInterval>);

  // After fade-out: swap content and fade in label + chips + time-remaining together
  setTimeout(() => {
    if (PALETTES_ENABLED) {
      document.getElementById('swatch-row')!.classList.remove('visible');
    }
    const timeRemaining = document.getElementById('time-remaining')!;
    label.classList.add('available');
    label.textContent = 'Available';
    timeRemaining.textContent = formatTimeRemaining(timeRemainingMs(availableUntil)) + ' left';
    timeRemaining.style.opacity = '0';
    timeRemaining.style.display = '';
    chips.style.pointerEvents = 'auto';
    chips.style.opacity = '0';
    requestAnimationFrame(() => {
      label.style.opacity = '1';
      chips.style.opacity = '1';
      timeRemaining.style.opacity = '1';
    });
  }, 200);

  countdownTimer = setInterval(() => {
    const ms = timeRemainingMs(availableUntil);
    if (ms <= 0) {
      setUnavailable();
    } else {
      document.getElementById('time-remaining')!.textContent = formatTimeRemaining(ms) + ' left';
    }
  }, 30000);
}

function setUnavailable() {
  const dot = document.getElementById('my-dot')!;
  const label = document.getElementById('my-status-label')!;
  const chips = document.getElementById('header-chips')!;
  const timeRemaining = document.getElementById('time-remaining')!;

  // Immediate: dot changes, drawer closes, and label + chips start fading out together
  dot.classList.remove('available');
  // clearInterval(null) is a no-op at runtime; the cast only appeases the checker.
  clearInterval(countdownTimer as ReturnType<typeof setInterval>);

  const drawer = document.getElementById('code-drawer');
  const mycodeChip = document.getElementById('mycode-chip');
  if (drawer) drawer.classList.remove('open');
  if (mycodeChip) mycodeChip.classList.remove('active');

  label.style.opacity = '0';
  chips.style.opacity = '0';
  chips.style.pointerEvents = 'none';
  timeRemaining.style.opacity = '0';

  // After fade-out: hide chips, swap label to "Unavailable", fade label back in
  setTimeout(() => {
    if (PALETTES_ENABLED) {
      document.getElementById('swatch-row')!.classList.add('visible');
      restoreSetSwitchPulse();
      applyThemeHint();
    }
    timeRemaining.style.display = 'none';
    timeRemaining.style.opacity = '';
    label.classList.remove('available');
    label.textContent = 'Unavailable';
    requestAnimationFrame(() => { label.style.opacity = '1'; });
  }, 200);
}
