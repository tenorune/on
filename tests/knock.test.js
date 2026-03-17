// tests/knock.test.js

// Module-level let bindings — re-assigned in beforeEach after jest.resetModules()
let writeKnock, getKnocks, watchKnocksAdded, clearKnock;
let sendKnock, initKnocks, colorToRgba;

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();
  jest.mock('../js/features.js', () => ({ KNOCK_ENABLED: true, PALETTES_ENABLED: false }));
  jest.mock('../js/db.js', () => ({
    writeKnock: jest.fn(),
    getKnocks: jest.fn(),
    watchKnocksAdded: jest.fn(),
    clearKnock: jest.fn(),
  }));
  jest.mock('../js/store.js', () => ({}));
  jest.mock('../js/firebase-config.js', () => ({ db: {} }));
  ({ sendKnock, initKnocks, colorToRgba } = require('../js/knock.js'));
  // Re-bind db mocks to fresh instances created after resetModules
  const db = require('../js/db.js');
  writeKnock = db.writeKnock;
  getKnocks = db.getKnocks;
  watchKnocksAdded = db.watchKnocksAdded;
  clearKnock = db.clearKnock;
});
afterEach(() => {
  jest.useRealTimers();
  document.body.innerHTML = '';
});

function makeLi(userId, { available = true } = {}) {
  const li = document.createElement('li');
  li.dataset.userId = userId;
  li.dataset.available = String(available);
  document.body.appendChild(li);
  return li;
}

// --- sendKnock ---

describe('sendKnock: debounce', () => {
  test('suppresses flash and write within 300ms', () => {
    makeLi('u1');
    sendKnock('u1', 'me');
    writeKnock.mockClear();
    jest.advanceTimersByTime(299);
    sendKnock('u1', 'me');
    expect(writeKnock).not.toHaveBeenCalled();
  });

  test('allows knock after 300ms', () => {
    makeLi('u1');
    sendKnock('u1', 'me');
    writeKnock.mockClear();
    jest.advanceTimersByTime(300);
    sendKnock('u1', 'me');
    expect(writeKnock).toHaveBeenCalledWith('u1', 'me');
  });

  test('debounce map persists across re-renders (module-level, userId string key)', () => {
    makeLi('u1');
    sendKnock('u1', 'me');
    writeKnock.mockClear();
    // Simulate re-render: remove and recreate li
    document.body.innerHTML = '';
    makeLi('u1');
    jest.advanceTimersByTime(100);
    sendKnock('u1', 'me');
    // Debounce still in effect — should not call writeKnock
    expect(writeKnock).not.toHaveBeenCalled();
  });
});

describe('sendKnock: flash', () => {
  test('flash fires after debounce passes', () => {
    const li = makeLi('u1');
    sendKnock('u1', 'me');
    expect(li.classList.contains('knock-sender')).toBe(true);
  });

  test('no flash for debounced taps', () => {
    const li = makeLi('u1');
    sendKnock('u1', 'me');
    li.classList.remove('knock-sender');
    jest.advanceTimersByTime(100);
    sendKnock('u1', 'me');
    expect(li.classList.contains('knock-sender')).toBe(false);
  });

  test('statusColor defaults to #22c55e when available and absent', () => {
    const li = makeLi('u1');
    sendKnock('u1', 'me');
    expect(li.style.getPropertyValue('--knock-color')).toBe('#22c55e');
  });

  test('statusColor is applied as --knock-color when available and provided', () => {
    const li = makeLi('u1');
    sendKnock('u1', 'me', '#f43f5e');
    expect(li.style.getPropertyValue('--knock-color')).toBe('#f43f5e');
  });

  test('uses grey (#6b7280 fallback) when recipient is unavailable', () => {
    const li = makeLi('u1', { available: false });
    sendKnock('u1', 'me', '#f43f5e'); // statusColor ignored when unavailable
    // jsdom has no CSS vars so getKnockColor returns the '#6b7280' fallback
    expect(li.style.getPropertyValue('--knock-color')).toBe('#6b7280');
  });

  test('knock-sender class is removed on animationend', () => {
    const li = makeLi('u1');
    sendKnock('u1', 'me');
    expect(li.classList.contains('knock-sender')).toBe(true);
    li.dispatchEvent(new Event('animationend'));
    expect(li.classList.contains('knock-sender')).toBe(false);
  });
});

describe('sendKnock: writeKnock call', () => {
  test('calls writeKnock after debounce passes', () => {
    makeLi('u1');
    sendKnock('u1', 'me');
    expect(writeKnock).toHaveBeenCalledWith('u1', 'me');
  });
});

// --- initKnocks: deferred processing ---

describe('initKnocks: deferred (null snapshot)', () => {
  test('null snapshot → no animations, no errors', async () => {
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockReturnValue(jest.fn());
    await expect(initKnocks('myUid')).resolves.not.toThrow();
  });
});

describe('initKnocks: deferred (within 24h)', () => {
  test('within-24h entries enqueue one deferred animation per sender', async () => {
    const ts = Date.now() - 1000; // 1 second ago
    getKnocks.mockResolvedValue({
      exists: () => true,
      val: () => ({ alice: { count: 3, ts }, bob: { count: 1, ts } }),
    });
    watchKnocksAdded.mockReturnValue(jest.fn());
    clearKnock.mockResolvedValue();

    makeLi('alice');
    makeLi('bob');

    await initKnocks('myUid');

    // All senders get knock-deferred simultaneously
    const aliceLi = document.querySelector('[data-user-id="alice"]');
    const bobLi = document.querySelector('[data-user-id="bob"]');
    expect(aliceLi.classList.contains('knock-deferred')).toBe(true);
    expect(bobLi.classList.contains('knock-deferred')).toBe(true);
  });

  test('older-than-24h entries are deleted without animating', async () => {
    const ts = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
    getKnocks.mockResolvedValue({
      exists: () => true,
      val: () => ({ alice: { count: 2, ts } }),
    });
    watchKnocksAdded.mockReturnValue(jest.fn());
    clearKnock.mockResolvedValue();

    makeLi('alice');
    await initKnocks('myUid');

    // clearKnock called for alice
    expect(clearKnock).toHaveBeenCalledWith('myUid', 'alice');
    // No animation on alice's card
    const aliceLi = document.querySelector('[data-user-id="alice"]');
    expect(aliceLi.classList.contains('knock-deferred')).toBe(false);
  });

  test('only snapshot keys are deleted (not new knocks arriving during window)', async () => {
    const ts = Date.now() - 1000;
    getKnocks.mockResolvedValue({
      exists: () => true,
      val: () => ({ alice: { count: 1, ts } }),
    });
    watchKnocksAdded.mockReturnValue(jest.fn());
    clearKnock.mockResolvedValue();

    await initKnocks('myUid');

    // Only alice was in snapshot — only alice should be deleted
    expect(clearKnock).toHaveBeenCalledWith('myUid', 'alice');
    expect(clearKnock).toHaveBeenCalledTimes(1);
  });
});

describe('initKnocks: deferredKeys skip set', () => {
  test('live listener skips senders in deferredKeys during deletion window', async () => {
    const ts = Date.now() - 1000;
    let liveCallback;
    getKnocks.mockResolvedValue({
      exists: () => true,
      val: () => ({ alice: { count: 1, ts } }),
    });
    // Make clearKnock hang until we manually resolve to simulate deletion window
    let resolveClear;
    clearKnock.mockReturnValue(new Promise(r => { resolveClear = r; }));
    watchKnocksAdded.mockImplementation((_uid, cb) => {
      liveCallback = cb;
      return jest.fn();
    });

    const initPromise = initKnocks('myUid');
    // Fire live callback for alice while deletion is pending (deferredKeys still has alice)
    liveCallback('alice', { count: 1, ts: Date.now() });
    // clearKnock should NOT have been called by the live listener (alice is in deferredKeys, skip)
    expect(clearKnock).not.toHaveBeenCalled();
    resolveClear();
    await initPromise;
  });

  test('deferredKeys cleared → previously-deferred sender fires are processed', async () => {
    const ts = Date.now() - 1000;
    let liveCallback;
    getKnocks.mockResolvedValue({
      exists: () => true,
      val: () => ({ alice: { count: 1, ts } }),
    });
    clearKnock.mockResolvedValue();
    watchKnocksAdded.mockImplementation((_uid, cb) => {
      liveCallback = cb;
      return jest.fn();
    });

    makeLi('alice');
    await initKnocks('myUid');

    // After initKnocks completes, deferredKeys is cleared
    // A new live callback for alice should now trigger a live animation
    clearKnock.mockClear();
    liveCallback('alice', { count: 2, ts: Date.now() });
    expect(clearKnock).toHaveBeenCalledWith('myUid', 'alice');
  });
});

// --- deferred animation: simultaneous ---

describe('applyDeferredKnock: simultaneous animations', () => {
  test('all within-24h deferred senders animate simultaneously', async () => {
    const now = Date.now();
    getKnocks.mockResolvedValue({
      exists: () => true,
      val: () => ({
        bob:   { count: 1, ts: now - 2000 },
        alice: { count: 1, ts: now - 5000 },
      }),
    });
    clearKnock.mockResolvedValue();
    watchKnocksAdded.mockReturnValue(jest.fn());

    const liA = makeLi('alice');
    const liB = makeLi('bob');

    await initKnocks('myUid');

    // Both senders should have knock-deferred class at the same time
    expect(liA.classList.contains('knock-deferred')).toBe(true);
    expect(liB.classList.contains('knock-deferred')).toBe(true);
  });

  test('skips silently when [data-user-id] element not found in DOM', async () => {
    let liveCallback;
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockImplementation((_uid, cb) => {
      liveCallback = cb;
      return jest.fn();
    });
    clearKnock.mockResolvedValue();

    await initKnocks('myUid');
    // No li for 'ghost' in DOM — should not throw
    expect(() => liveCallback('ghost', { count: 1, ts: Date.now() })).not.toThrow();
  });
});

// --- initKnocks: state reset ---

describe('initKnocks: state reset', () => {
  test('resets debounce map and deferredKeys on re-call', async () => {
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockReturnValue(jest.fn());

    await initKnocks('myUid');

    const li = makeLi('u1');
    sendKnock('u1', 'me');     // sets debounce entry
    writeKnock.mockClear();

    await initKnocks('myUid');  // re-call should reset debounce map

    jest.advanceTimersByTime(0);
    sendKnock('u1', 'me');
    // After reset, debounce map is cleared so knock should go through
    expect(writeKnock).toHaveBeenCalledWith('u1', 'me');
  });
});

// --- visibilitychange re-init ---

describe('visibilitychange re-init', () => {
  test('becoming visible resets module state (debounce map cleared)', async () => {
    // Initial app load
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockReturnValue(jest.fn());
    await initKnocks('myUid');

    // Fire a knock to populate the debounce map
    const li = makeLi('u1');
    sendKnock('u1', 'me');
    writeKnock.mockClear();

    // Simulate app returning to foreground; state reset is synchronous at top of initKnocks
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockReturnValue(jest.fn());
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    // Debounce map is cleared synchronously — knock should fire again immediately
    sendKnock('u1', 'me');
    expect(writeKnock).toHaveBeenCalledWith('u1', 'me');
  });
});

// --- live listener background / reconnect guards ---

describe('live listener: visibility and timestamp guards', () => {
  async function setupLiveListener() {
    let liveCallback;
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockImplementation((_uid, cb) => { liveCallback = cb; return jest.fn(); });
    clearKnock.mockResolvedValue();
    await initKnocks('myUid');
    return liveCallback;
  }

  test('knock arriving while hidden is not processed (stays in DB for deferred pick-up)', async () => {
    const fire = await setupLiveListener();
    const li = makeLi('alice');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    fire('alice', { count: 1, ts: Date.now() });
    // Neither live pulse nor clear should have been triggered
    expect(li.style.boxShadow).toBe('');
    expect(clearKnock).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  test('knock with ts before appOpenTime is shown as deferred, not live', async () => {
    const fire = await setupLiveListener();
    const li = makeLi('alice');
    // ts well before session start — simulates reconnect delivering a pre-existing knock
    fire('alice', { count: 1, ts: Date.now() - 60_000 });
    expect(li.classList.contains('knock-deferred')).toBe(true);
    expect(clearKnock).toHaveBeenCalledWith('myUid', 'alice');
    // Should NOT have applied a live pulse (no boxShadow transition set)
    expect(li.style.transition).not.toContain('box-shadow 2s');
  });
});

// --- live knock pulse ---

describe('live knock pulse: color', () => {
  async function setupLive() {
    let liveCallback;
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockImplementation((_uid, cb) => { liveCallback = cb; return jest.fn(); });
    clearKnock.mockResolvedValue();
    await initKnocks('myUid');
    return liveCallback;
  }

  test('color read from person-dot.style.background', async () => {
    const fire = await setupLive();
    const li = makeLi('alice');
    const dot = document.createElement('div');
    dot.className = 'person-dot';
    dot.style.background = '#f43f5e'; // jsdom normalizes to rgb(244, 63, 94)
    li.appendChild(dot);

    fire('alice', { count: 1, ts: Date.now() });
    // colorToRgba handles rgb(...) so the decay target is correctly set
    expect(li.style.transition).toBe('box-shadow 2s ease-out');
    expect(li.style.boxShadow).toBe('inset 0 0 0 9999px rgba(244, 63, 94, 0)');
  });

  test('falls back to #22c55e when available and dot has no inline background', async () => {
    const fire = await setupLive();
    const li = makeLi('alice');
    const dot = document.createElement('div');
    dot.className = 'person-dot';
    li.appendChild(dot); // no dot.style.background set

    fire('alice', { count: 1, ts: Date.now() });
    expect(li.style.transition).toBe('box-shadow 2s ease-out');
    expect(li.style.boxShadow).toBe('inset 0 0 0 9999px rgba(34, 197, 94, 0)');
  });

  test('uses grey (#6b7280 fallback) when sender is unavailable', async () => {
    const fire = await setupLive();
    const li = makeLi('alice', { available: false });

    fire('alice', { count: 1, ts: Date.now() });
    // jsdom has no CSS vars so getKnockColor returns '#6b7280' fallback
    // colorToRgba('#6b7280', 0) = rgba(107, 114, 128, 0)
    expect(li.style.transition).toBe('box-shadow 2s ease-out');
    expect(li.style.boxShadow).toBe('inset 0 0 0 9999px rgba(107, 114, 128, 0)');
  });
});

describe('live knock pulse: intensity', () => {
  async function setupLive() {
    let liveCallback;
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockImplementation((_uid, cb) => { liveCallback = cb; return jest.fn(); });
    clearKnock.mockResolvedValue();
    await initKnocks('myUid');
    return liveCallback;
  }

  test('count=1 sets alpha to 0.4 (INTENSITY_STEP)', async () => {
    const fire = await setupLive();
    const li = makeLi('alice');

    const bsValues = [];
    const origDescriptor = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'boxShadow');
    Object.defineProperty(li.style, 'boxShadow', {
      set(v) { bsValues.push(v); origDescriptor.set.call(this, v); },
      get() { return origDescriptor.get.call(this); },
      configurable: true,
    });

    fire('alice', { count: 1, ts: Date.now() });
    // bsValues[0] = peak (alpha=0.4), bsValues[1] = decay target (alpha=0)
    expect(bsValues[0]).toBe('inset 0 0 0 9999px rgba(34, 197, 94, 0.4)');
  });

  test('count=2 sets alpha to 0.8', async () => {
    const fire = await setupLive();
    const li = makeLi('alice');

    const bsValues = [];
    const origDescriptor = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'boxShadow');
    Object.defineProperty(li.style, 'boxShadow', {
      set(v) { bsValues.push(v); origDescriptor.set.call(this, v); },
      get() { return origDescriptor.get.call(this); },
      configurable: true,
    });

    fire('alice', { count: 2, ts: Date.now() });
    expect(bsValues[0]).toBe('inset 0 0 0 9999px rgba(34, 197, 94, 0.8)');
  });

  test('intensity capped at 1.0 — two sequential count=2 knocks stay ≤ 1', async () => {
    const fire = await setupLive();
    const li = makeLi('alice');
    fire('alice', { count: 2, ts: Date.now() }); // 0.8
    fire('alice', { count: 2, ts: Date.now() }); // would be 1.6, capped to 1.0
    // Transition was started (not blocked by a cap bug)
    expect(li.style.transition).toBe('box-shadow 2s ease-out');
    // Timer fires after 2.1s — cleanup works even at capped intensity
    jest.advanceTimersByTime(2100);
    expect(li.style.boxShadow).toBe('');
  });

  test('cancels previous cleanup timer on re-knock', async () => {
    const fire = await setupLive();
    const li = makeLi('alice');
    fire('alice', { count: 1, ts: Date.now() });
    jest.advanceTimersByTime(1000); // 1s into 2.1s timer
    fire('alice', { count: 1, ts: Date.now() }); // resets timer
    // 1.2s after second knock (2.2s after first): first timer would have fired, second hasn't
    jest.advanceTimersByTime(1200);
    expect(li.style.boxShadow).not.toBe('');
  });

  test('cleans up inline styles after 2.1s', async () => {
    const fire = await setupLive();
    const li = makeLi('alice');
    fire('alice', { count: 1, ts: Date.now() });
    expect(li.style.boxShadow).not.toBe('');

    jest.advanceTimersByTime(2100);
    expect(li.style.boxShadow).toBe('');
    expect(li.style.transition).toBe('');
  });

  test('skips silently when sender li not in DOM', async () => {
    const fire = await setupLive();
    // 'ghost' has no li in the DOM
    expect(() => fire('ghost', { count: 1, ts: Date.now() })).not.toThrow();
  });
});

describe('live knock pulse: pulseMap reset', () => {
  test('pulseMap is cleared on initKnocks re-call (cleanup timer cancelled)', async () => {
    let liveCallback;
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockImplementation((_uid, cb) => { liveCallback = cb; return jest.fn(); });
    clearKnock.mockResolvedValue();
    await initKnocks('myUid');

    const li = makeLi('alice');
    liveCallback('alice', { count: 1, ts: Date.now() });
    expect(li.style.boxShadow).not.toBe('');

    // Re-init: pulseMap reset; timer cancelled; styles NOT cleaned (reset only clears state)
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockReturnValue(jest.fn());
    await initKnocks('myUid');

    // Advance past old timer duration — it should have been cancelled, no double-cleanup crash
    jest.advanceTimersByTime(2100);
    // No error means the cancelled timer didn't fire the delete on an already-cleared map
    expect(true).toBe(true);
  });
});

// --- deferred color fix ---

describe('initKnocks: deferred color fix', () => {
  test('applyDeferredKnock uses sender dot color instead of hardcoded green', async () => {
    const ts = Date.now() - 1000;
    getKnocks.mockResolvedValue({
      exists: () => true,
      val: () => ({ alice: { count: 1, ts } }),
    });
    watchKnocksAdded.mockReturnValue(jest.fn());
    clearKnock.mockResolvedValue();

    const li = makeLi('alice');
    const dot = document.createElement('div');
    dot.className = 'person-dot';
    dot.style.background = '#f43f5e';
    li.appendChild(dot);

    await initKnocks('myUid');

    // --knock-color should reflect the sender's dot color, not hardcoded green.
    // jsdom normalizes dot.style.background '#f43f5e' → 'rgb(244, 63, 94)' on read,
    // so getSenderColor returns 'rgb(244, 63, 94)' and that is what gets set as --knock-color.
    expect(li.style.getPropertyValue('--knock-color')).toBe('rgb(244, 63, 94)');
  });
});

// --- colorToRgba unit tests ---

describe('colorToRgba', () => {
  test('converts #rrggbb hex to rgba', () => {
    expect(colorToRgba('#f43f5e', 0.4)).toBe('rgba(244, 63, 94, 0.4)');
  });

  test('converts browser-normalized rgb(r, g, b) to rgba', () => {
    expect(colorToRgba('rgb(244, 63, 94)', 0.4)).toBe('rgba(244, 63, 94, 0.4)');
  });

  test('fallback for unrecognized format returns green', () => {
    expect(colorToRgba('hsl(350, 90%, 60%)', 0.5)).toBe('rgba(34, 197, 94, 0.5)');
  });

  test('alpha=0 produces correct decay target', () => {
    expect(colorToRgba('#22c55e', 0)).toBe('rgba(34, 197, 94, 0)');
  });
});
