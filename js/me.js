// js/me.js
import { setStatus, isExpired, formatTimeRemaining, timeRemainingMs } from './db.js';
import { getLastTimeout, setLastTimeout } from './store.js';

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

function showChips(chipsEl) {
  chipsEl.style.display = 'flex';
  requestAnimationFrame(() => chipsEl.classList.add('visible'));
}

function hideChips(chipsEl) {
  if (getComputedStyle(chipsEl).display === 'none') return;
  chipsEl.classList.remove('visible');
  chipsEl.addEventListener('transitionend', function handler(e) {
    if (e.target === chipsEl && e.propertyName === 'opacity') {
      chipsEl.style.display = 'none';
      chipsEl.removeEventListener('transitionend', handler);
    }
  });
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

export function applyOwnStatus(status, availableUntil) {
  if (status === 'available' && !isExpired(availableUntil)) {
    setAvailable(availableUntil);
  } else {
    setUnavailable();
  }
}

function setAvailable(availableUntil) {
  const dot = document.getElementById('my-dot');
  const label = document.getElementById('my-status-label');
  const timeRemaining = document.getElementById('time-remaining');
  const chips = document.getElementById('header-chips');

  dot.classList.add('available');
  label.classList.add('available');
  label.textContent = 'Available';
  timeRemaining.textContent = '· ' + formatTimeRemaining(timeRemainingMs(availableUntil)) + ' left';
  timeRemaining.style.display = '';
  showChips(chips);

  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    const ms = timeRemainingMs(availableUntil);
    if (ms <= 0) {
      dot.classList.remove('available');
      label.classList.remove('available');
      label.textContent = 'Unavailable';
      timeRemaining.textContent = '';
      timeRemaining.style.display = 'none';
      hideChips(chips);
      clearInterval(countdownTimer);
    } else {
      timeRemaining.textContent = '· ' + formatTimeRemaining(ms) + ' left';
    }
  }, 30000);
}

function setUnavailable() {
  const dot = document.getElementById('my-dot');
  const label = document.getElementById('my-status-label');
  const timeRemaining = document.getElementById('time-remaining');
  const chips = document.getElementById('header-chips');

  dot.classList.remove('available');
  label.classList.remove('available');
  label.textContent = 'Unavailable';
  timeRemaining.textContent = '';
  timeRemaining.style.display = 'none';
  hideChips(chips);
  clearInterval(countdownTimer);
}
