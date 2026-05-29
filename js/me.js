// js/me.js
import { setStatus, isExpired, formatTimeRemaining, timeRemainingMs } from './db.js';
import { getPaletteState } from './store.js';
import { PALETTES_ENABLED } from './features.js';
import { saveCombo, buildCombo } from './favorites.js';
import { applyThemeHint, restoreSetSwitchPulse } from './palettes.js';
import { markHintSeen, getLastTimeout, setLastTimeout } from './prefs.js';

const CHIP_VALUES = [
  { minutes: 30,   text: '30 minutes' },
  { minutes: 60,   text: '1 hour' },
  { minutes: 90,   text: '1 hour 30 minutes' },
  { minutes: 120,  text: '2 hours' },
  { minutes: 180,  text: '3 hours' },
  { minutes: 240,  text: '4 hours' },
  { minutes: 360,  text: '6 hours' },
  { minutes: 480,  text: '8 hours' },
  { minutes: 720,  text: '12 hours' },
  { minutes: 1080, text: '18 hours' },
  { minutes: 1440, text: '24 hours' },
];

let savingEnabled = false;
let countdownTimer = null;
let currentChipIndex = 3; // default: 2 hours
let firstUseActive = false;
let ownStatusSignalled = false;
let onOwnStatusReady = null;

function chipIndexForMinutes(minutes) {
  let m = minutes;
  if (m <= 12) m = m * 60; // legacy: some old values were stored as hours
  let bestIndex = 0;
  let bestDist = Math.abs(CHIP_VALUES[0].minutes - m);
  for (let i = 1; i < CHIP_VALUES.length; i++) {
    const dist = Math.abs(CHIP_VALUES[i].minutes - m);
    if (dist < bestDist) { bestDist = dist; bestIndex = i; }
  }
  return bestIndex;
}

function migrateToChipIndex() {
  return chipIndexForMinutes(getLastTimeout());
}

// Called from app.js's watchStatus when userData.lastTimeoutMinutes changes.
// Reflects the user's chip selection from another device on this device.
export function updateChipFromServer(minutes) {
  if (!minutes) return;
  const newIndex = chipIndexForMinutes(minutes);
  if (newIndex === currentChipIndex) return;
  currentChipIndex = newIndex;
  const timeChip = document.getElementById('time-chip');
  if (timeChip) timeChip.textContent = CHIP_VALUES[newIndex].text;
  setLastTimeout(CHIP_VALUES[newIndex].minutes);
}

export function initHeader(myUserId) {
  ownStatusSignalled = false;
  // Sibling-device chip pick echoes through userPrefs → 'last-timeout-synced';
  // update the Direct chip text to match.
  document.addEventListener('last-timeout-synced', (e) => {
    if (typeof e.detail?.minutes === 'number') updateChipFromServer(e.detail.minutes);
  });
  const dot = document.getElementById('my-dot');
  const timeChip = document.getElementById('time-chip');
  const mycodeChip = document.getElementById('mycode-chip');
  const drawer = document.getElementById('code-drawer');

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
    if (!document.getElementById('my-dot').classList.contains('available')) return;
    currentChipIndex = (currentChipIndex + 1) % CHIP_VALUES.length;
    const { minutes, text } = CHIP_VALUES[currentChipIndex];
    timeChip.textContent = text;
    const availableUntil = Date.now() + minutes * 60000;
    await setStatus(myUserId, 'available', availableUntil);
    const tr = document.getElementById('time-remaining');
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
      document.getElementById('recovery-show-pill')?.classList.remove('hidden');
      const copyBtn = document.getElementById('drawer-recovery-copy-btn');
      if (copyBtn) copyBtn.textContent = 'Copy';
    }
  });
}

export function enterFirstUseMode() {
  firstUseActive = true;
  const dot = document.getElementById('my-dot');
  if (dot) {
    dot.classList.add('first-use-pulse');
    dot.addEventListener('click', () => {
      dot.classList.remove('first-use-pulse');
    }, { once: true });
  }
}

export function setOwnStatusReadyCallback(fn) {
  onOwnStatusReady = fn;
}

export function applyOwnStatus(status, availableUntil) {
  if (!ownStatusSignalled) {
    ownStatusSignalled = true;
    onOwnStatusReady?.();
  }
  if (firstUseActive) {
    if (status === 'available' && !isExpired(availableUntil)) {
      firstUseActive = false;
      setAvailable(availableUntil);
    } else {
      setKnockKnock();
    }
    savingEnabled = true;
    return;
  }
  if (status === 'available' && !isExpired(availableUntil)) {
    setAvailable(availableUntil);
  } else {
    setUnavailable();
  }
  savingEnabled = true;
}

function setKnockKnock() {
  const dot   = document.getElementById('my-dot');
  const label = document.getElementById('my-status-label');
  const chips = document.getElementById('header-chips');

  dot.classList.add('available');
  chips.style.opacity = '0';
  chips.style.pointerEvents = 'none';
  label.classList.remove('available');
  label.textContent = '';
  label.style.opacity = '1';
}

function setAvailable(availableUntil) {
  const dot = document.getElementById('my-dot');
  if (PALETTES_ENABLED && savingEnabled && !dot.classList.contains('available')) saveCombo(buildCombo());
  // Track that user went available with a non-default color (for theme hint)
  if (PALETTES_ENABLED && !dot.classList.contains('available')) {
    const ps = getPaletteState();
    if (ps.sets[String(ps.activeSet)].selectedColor) {
      markHintSeen('customAvail');
    }
  }
  const label = document.getElementById('my-status-label');
  const chips = document.getElementById('header-chips');

  // Immediate: dot changes and old label starts fading out
  dot.classList.remove('dot-go-hint');
  dot.classList.add('available');
  label.style.opacity = '0';

  clearInterval(countdownTimer);

  // After fade-out: swap content and fade in label + chips + time-remaining together
  setTimeout(() => {
    if (PALETTES_ENABLED) {
      document.getElementById('swatch-row').classList.remove('visible');
    }
    const timeRemaining = document.getElementById('time-remaining');
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
      document.getElementById('time-remaining').textContent = formatTimeRemaining(ms) + ' left';
    }
  }, 30000);
}

function setUnavailable() {
  const dot = document.getElementById('my-dot');
  const label = document.getElementById('my-status-label');
  const chips = document.getElementById('header-chips');
  const timeRemaining = document.getElementById('time-remaining');

  // Immediate: dot changes, drawer closes, and label + chips start fading out together
  dot.classList.remove('available');
  clearInterval(countdownTimer);

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
      document.getElementById('swatch-row').classList.add('visible');
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
