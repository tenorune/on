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

  slider.addEventListener('change', async () => {
    if (dot.classList.contains('available')) {
      const hours = parseInt(slider.value, 10);
      const newUntil = Date.now() + hours * 3600000;
      await setStatus(myUserId, 'available', newUntil);
      clearInterval(countdownTimer);
      updateCountdownLabel(label, newUntil);
      countdownTimer = setInterval(() => updateCountdownLabel(label, newUntil), 30000);
    }
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
  sliderWrap.classList.remove('hidden');
  const slider = document.getElementById('timeout-slider');
  slider.value = Math.max(1, Math.min(12, Math.round(timeRemainingMs(availableUntil) / 3600000)));
  clearInterval(countdownTimer);
  updateCountdownLabel(label, availableUntil);
  countdownTimer = setInterval(() => updateCountdownLabel(label, availableUntil), 30000);
}

function setUnavailable(dot, label, sliderWrap) {
  dot.classList.remove('available');
  label.classList.remove('available');
  label.textContent = 'Unavailable';
  sliderWrap.classList.add('hidden');
  clearInterval(countdownTimer);
}

function updateCountdownLabel(label, availableUntil) {
  const slider = document.getElementById('timeout-slider');
  const sliderWrap = document.getElementById('slider-wrap');
  const ms = timeRemainingMs(availableUntil);
  if (ms <= 0) {
    document.getElementById('my-dot').classList.remove('available');
    label.textContent = 'Unavailable';
    label.classList.remove('available');
    sliderWrap.classList.add('hidden');
  } else {
    label.textContent = `Available · ${formatTimeRemaining(ms)} left`;
    slider.value = Math.max(1, Math.min(12, Math.round(ms / 3600000)));
  }
}
