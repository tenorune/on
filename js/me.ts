// js/me.js
import { setStatus, isAvailable, formatTimeRemaining, timeRemainingMs } from './db.js';
import { getPaletteState } from './store.js';
import { PALETTES_ENABLED } from './features.js';
import { saveCombo, buildDirectCombo } from './favorites.js';
import { applyThemeHint, restoreSetSwitchPulse } from './palettes.js';
import { markHintSeen, getLastTimeout, setLastTimeout, getLocationOptIn } from './prefs.js';
import { CHIP_VALUES, chipIndexForMinutes } from './status.js';
import { toggleContext, capabilityState } from './locationShare.js';
import { showToast, LOCATION_DENIED_TOAST } from './groups.js';

let savingEnabled = false;
let countdownTimer: ReturnType<typeof setInterval> | null = null;
// The availableUntil the running countdown targets — also the echo-absorb
// marker: a subscription tick carrying exactly this window while the dot is
// already available is the echo of our own optimistic write, not news.
let _countdownUntil: number | null = null;
let currentChipIndex = 3; // default: 2 hours
let firstUseActive = false;
let ownStatusSignalled = false;
let onOwnStatusReady: (() => void) | null = null;

function migrateToChipIndex() {
  return chipIndexForMinutes(getLastTimeout());
}

// Paint a location glyph's tri-state. Shared by the Direct header (me.js) and
// the group band (groupContext.js) — same classes, different element.
export function paintLocationGlyph(el: HTMLElement, state: 'on' | 'off' | 'denied') {
  el.classList.toggle('on', state === 'on');
  el.classList.toggle('denied', state === 'denied');
  el.setAttribute('aria-pressed', state === 'on' ? 'true' : 'false');
  if (state === 'denied') el.title = 'Location unavailable — check permissions';
  else el.removeAttribute('title');
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

  // Optimistic toggles: paint first, write in the background — parity with the
  // group context's pushOptimistic path. Awaiting the write before painting
  // cost a full server round-trip per toggle, and the RTDB echo then re-ran
  // the label crossfade a second time ("the UI looks like it is thinking",
  // device-reported). The setters' idempotence guards absorb the echo.
  dot.addEventListener('click', () => {
    if (dot.classList.contains('available')) {
      setUnavailable();
      setStatus(myUserId, 'unavailable', null).catch(() => {});
    } else {
      const { minutes } = CHIP_VALUES[currentChipIndex];
      const availableUntil = Date.now() + minutes * 60000;
      setAvailable(availableUntil);
      setStatus(myUserId, 'available', availableUntil).catch(() => {});
      // prefs.setLastTimeout writes both localStorage AND
      // userPrefs/{uid}/lastTimeoutMinutes.
      setLastTimeout(minutes);
    }
  });

  timeChip.addEventListener('click', () => {
    if (!document.getElementById('my-dot')!.classList.contains('available')) return;
    currentChipIndex = (currentChipIndex + 1) % CHIP_VALUES.length;
    const { minutes, text } = CHIP_VALUES[currentChipIndex];
    timeChip.textContent = text;
    const availableUntil = Date.now() + minutes * 60000;
    const tr = document.getElementById('time-remaining')!;
    tr.textContent = formatTimeRemaining(timeRemainingMs(availableUntil)) + ' left';
    // Retarget the countdown (and the echo-absorb marker) without the full
    // setAvailable crossfade — a chip tap only changes the window.
    startCountdown(availableUntil);
    setStatus(myUserId, 'available', availableUntil).catch(() => {});
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

  const locGlyph = document.getElementById('location-glyph');
  if (locGlyph) {
    paintLocationGlyph(locGlyph, getLocationOptIn('direct') ? 'on' : 'off');
    if (capabilityState() === 'unsupported') paintLocationGlyph(locGlyph, 'denied');
    locGlyph.addEventListener('click', async () => {
      const state = await toggleContext('direct');
      paintLocationGlyph(locGlyph, state === 'on' ? 'on' : state === 'off' ? 'off' : 'denied');
      if (state === 'denied') showToast(LOCATION_DENIED_TOAST);
    });
    // Cross-device echo: another device flipping the pref repaints this glyph.
    document.addEventListener('location-prefs-synced', () => {
      paintLocationGlyph(locGlyph, getLocationOptIn('direct') ? 'on' : 'off');
    });
    // Pref flipped outside the tap path (locationShare's mid-flight-revocation
    // teardown): the tap handler above never runs, so the paint rides the event.
    document.addEventListener('location-optin-changed', () => {
      paintLocationGlyph(locGlyph, getLocationOptIn('direct') ? 'on' : 'off');
    });
  }
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

// (Re)start the 30s countdown toward availableUntil and record it as the
// current target. Shared by setAvailable and the time-chip retarget.
function startCountdown(availableUntil: number | null) {
  _countdownUntil = availableUntil;
  // clearInterval(null) is a no-op at runtime; the cast only appeases the checker.
  clearInterval(countdownTimer as ReturnType<typeof setInterval>);
  countdownTimer = setInterval(() => {
    const ms = timeRemainingMs(availableUntil);
    if (ms <= 0) {
      setUnavailable(); // state transition — must fire even while hidden
    } else if (document.visibilityState !== 'hidden') {
      document.getElementById('time-remaining')!.textContent = formatTimeRemaining(ms) + ' left';
    }
  }, 30000);
}

function setAvailable(availableUntil: number | null) {
  const dot = document.getElementById('my-dot')!;
  // Idempotence: already available with this exact window → this is the RTDB
  // echo of our own optimistic write; re-running would restart the label
  // crossfade. A different window (sibling device) falls through and re-renders.
  if (dot.classList.contains('available') && availableUntil === _countdownUntil) return;
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
  const timeRemaining = document.getElementById('time-remaining')!;
  const lg = document.getElementById('location-glyph');

  // Same-frame swap (operator call: Direct must read as instantaneous, like
  // the group context) — no staged fade-out/swap/fade-in choreography; any
  // softness comes from the CSS opacity transitions alone.
  dot.classList.remove('dot-go-hint');
  dot.classList.add('available');
  startCountdown(availableUntil);
  if (PALETTES_ENABLED) {
    document.getElementById('swatch-row')!.classList.remove('visible');
  }
  label.classList.add('available');
  label.textContent = 'Available';
  label.style.opacity = '1';
  timeRemaining.textContent = formatTimeRemaining(timeRemainingMs(availableUntil)) + ' left';
  timeRemaining.style.display = '';
  timeRemaining.style.opacity = '1';
  if (lg) lg.style.display = '';
  chips.style.pointerEvents = 'auto';
  chips.style.opacity = '1';
}

function setUnavailable() {
  const dot = document.getElementById('my-dot')!;
  const label = document.getElementById('my-status-label')!;
  const chips = document.getElementById('header-chips')!;
  const timeRemaining = document.getElementById('time-remaining')!;
  const lg = document.getElementById('location-glyph');

  // Idempotence: already fully unavailable (dot off AND the chips faded — the
  // latter distinguishes an applied unavailable from the markup default) →
  // this is the echo of our own optimistic write; skip the re-fade. The
  // knock-knock first-use state keeps the dot available, so it never matches.
  if (!dot.classList.contains('available') && chips.style.opacity === '0') return;

  // Same-frame swap — see setAvailable's note. Dot flips, drawer closes,
  // chips hide, swatch row returns and the label reads "Unavailable" all in
  // one paint.
  dot.classList.remove('available');
  _countdownUntil = null;
  // clearInterval(null) is a no-op at runtime; the cast only appeases the checker.
  clearInterval(countdownTimer as ReturnType<typeof setInterval>);

  const drawer = document.getElementById('code-drawer');
  const mycodeChip = document.getElementById('mycode-chip');
  if (drawer) drawer.classList.remove('open');
  if (mycodeChip) mycodeChip.classList.remove('active');

  chips.style.opacity = '0';
  chips.style.pointerEvents = 'none';
  if (PALETTES_ENABLED) {
    document.getElementById('swatch-row')!.classList.add('visible');
    restoreSetSwitchPulse();
    applyThemeHint();
  }
  timeRemaining.style.display = 'none';
  timeRemaining.style.opacity = '';
  if (lg) lg.style.display = 'none';
  label.classList.remove('available');
  label.textContent = 'Unavailable';
  label.style.opacity = '1';
}
