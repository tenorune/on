// js/me.js
import { setStatus, isExpired, formatTimeRemaining, timeRemainingMs } from './db.js';
import { getLastTimeout, setLastTimeout } from './store.js';

let countdownTimer = null;

export function initMeTab(myUserId) {
  const dot = document.getElementById('my-dot');
  const label = document.getElementById('my-status-label');
  const sliderWrap = document.getElementById('slider-wrap');
  const slider = document.getElementById('timeout-slider');
  const sliderValue = document.getElementById('slider-value');

  // Restore last timeout preference
  slider.value = getLastTimeout();
  sliderValue.textContent = `${slider.value}h`;

  slider.addEventListener('input', () => {
    sliderValue.textContent = `${slider.value}h`;
    setLastTimeout(parseInt(slider.value, 10));
  });

  dot.addEventListener('click', async () => {
    const isCurrentlyAvailable = dot.classList.contains('available');
    if (isCurrentlyAvailable) {
      await setStatus(myUserId, 'unavailable', null);
      setUnavailable(dot, label, sliderWrap);
    } else {
      const hours = parseInt(slider.value, 10);
      const availableUntil = Date.now() + hours * 3600000;
      await setStatus(myUserId, 'available', availableUntil);
      setAvailable(dot, label, sliderWrap, availableUntil);
    }
  });
}

export function applyOwnStatus(status, availableUntil) {
  const dot = document.getElementById('my-dot');
  const label = document.getElementById('my-status-label');
  const sliderWrap = document.getElementById('slider-wrap');

  if (status === 'available' && !isExpired(availableUntil)) {
    setAvailable(dot, label, sliderWrap, availableUntil);
  } else {
    setUnavailable(dot, label, sliderWrap);
  }
}

function setAvailable(dot, label, sliderWrap, availableUntil) {
  dot.classList.add('available');
  label.classList.add('available');
  sliderWrap.classList.add('hidden');
  clearInterval(countdownTimer);
  updateCountdownLabel(label, availableUntil);
  countdownTimer = setInterval(() => updateCountdownLabel(label, availableUntil), 30000);
}

function setUnavailable(dot, label, sliderWrap) {
  dot.classList.remove('available');
  label.classList.remove('available');
  label.textContent = 'Unavailable';
  sliderWrap.classList.remove('hidden');
  clearInterval(countdownTimer);
}

function updateCountdownLabel(label, availableUntil) {
  const ms = timeRemainingMs(availableUntil);
  if (ms <= 0) {
    label.textContent = 'Unavailable';
    label.classList.remove('available');
  } else {
    label.textContent = `Available · ${formatTimeRemaining(ms)} left`;
  }
}
