// js/me.js
import { setStatus, isExpired, formatTimeRemaining, timeRemainingMs } from './db.js';
import { getLastTimeout, setLastTimeout } from './store.js';
import { PALETTES_ENABLED } from './features.js';

const CHIP_VALUES = [
  { minutes: 30,  text: '30 minutes' },
  { minutes: 60,  text: '1 hour' },
  { minutes: 90,  text: '1 hour 30 minutes' },
  { minutes: 120, text: '2 hours' },
  { minutes: 180, text: '3 hours' },
  { minutes: 240, text: '4 hours' },
  { minutes: 360, text: '6 hours' },
  { minutes: 480, text: '8 hours' },
];

let countdownTimer = null;
let currentChipIndex = 3; // default: 2 hours
let firstUseActive = false;

function migrateToChipIndex() {
  let stored = getLastTimeout();
  if (stored <= 12) stored = stored * 60;
  let bestIndex = 0;
  let bestDist = Math.abs(CHIP_VALUES[0].minutes - stored);
  for (let i = 1; i < CHIP_VALUES.length; i++) {
    const dist = Math.abs(CHIP_VALUES[i].minutes - stored);
    if (dist < bestDist) { bestDist = dist; bestIndex = i; }
  }
  return bestIndex;
}

export function initHeader(myUserId) {
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
    tr.textContent = '· ' + formatTimeRemaining(timeRemainingMs(availableUntil)) + ' left';
    setLastTimeout(minutes);
  });

  mycodeChip.addEventListener('click', () => {
    const isOpen = drawer.classList.contains('open');
    drawer.classList.toggle('open');
    mycodeChip.classList.toggle('active', !isOpen);
  });
}

export function enterFirstUseMode() {
  firstUseActive = true;
}

export function applyOwnStatus(status, availableUntil) {
  if (firstUseActive) {
    if (status === 'available' && !isExpired(availableUntil)) {
      firstUseActive = false;
      setAvailable(availableUntil);
    } else {
      setKnockKnock();
    }
    return;
  }
  if (status === 'available' && !isExpired(availableUntil)) {
    setAvailable(availableUntil);
  } else {
    setUnavailable();
  }
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
  const label = document.getElementById('my-status-label');
  const chips = document.getElementById('header-chips');

  // Immediate: dot changes and old label starts fading out
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
    timeRemaining.textContent = '· ' + formatTimeRemaining(timeRemainingMs(availableUntil)) + ' left';
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
      document.getElementById('time-remaining').textContent = '· ' + formatTimeRemaining(ms) + ' left';
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
    }
    timeRemaining.style.display = 'none';
    timeRemaining.style.opacity = '';
    label.classList.remove('available');
    label.textContent = 'Unavailable';
    requestAnimationFrame(() => { label.style.opacity = '1'; });
  }, 200);
}
