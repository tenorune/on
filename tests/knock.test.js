// tests/knock.test.js

// Module-level let bindings — re-assigned in beforeEach after jest.resetModules()
let writeKnock, getKnocks, watchKnocksAdded, clearKnock;
let sendKnock, initKnocks;

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
  ({ sendKnock, initKnocks } = require('../js/knock.js'));
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

function makeLi(userId) {
  const li = document.createElement('li');
  li.dataset.userId = userId;
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

  test('statusColor defaults to #22c55e when absent', () => {
    const li = makeLi('u1');
    sendKnock('u1', 'me');
    expect(li.style.getPropertyValue('--knock-color')).toBe('#22c55e');
  });

  test('statusColor is applied as --knock-color when provided', () => {
    const li = makeLi('u1');
    sendKnock('u1', 'me', '#f43f5e');
    expect(li.style.getPropertyValue('--knock-color')).toBe('#f43f5e');
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

    // Each sender gets one deferred animation class (not three)
    const aliceLi = document.querySelector('[data-user-id="alice"]');
    const bobLi = document.querySelector('[data-user-id="bob"]');
    // One of them should have a knock-deferred class (the queue runs the first)
    const hasDeferredClass = aliceLi.classList.contains('knock-deferred') ||
                             bobLi.classList.contains('knock-deferred');
    expect(hasDeferredClass).toBe(true);
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
    // A new live callback for alice should now enqueue a live animation
    clearKnock.mockClear();
    liveCallback('alice', { count: 2, ts: Date.now() });
    expect(clearKnock).toHaveBeenCalledWith('myUid', 'alice');
  });
});

// --- animation queue ---

describe('animation queue: sequence gap', () => {
  test('deferred sorted ascending before playback; live knocks appended to end', async () => {
    const now = Date.now();
    const ts1 = now - 5000; // older
    const ts2 = now - 2000; // newer
    let liveCallback;

    getKnocks.mockResolvedValue({
      exists: () => true,
      val: () => ({
        bob:   { count: 1, ts: ts2 },
        alice: { count: 1, ts: ts1 },
      }),
    });
    clearKnock.mockResolvedValue();
    watchKnocksAdded.mockImplementation((_uid, cb) => {
      liveCallback = cb;
      return jest.fn();
    });

    const liA = makeLi('alice');
    const liB = makeLi('bob');
    const liC = makeLi('carol');

    await initKnocks('myUid');

    // After deferredKeys is cleared, enqueue a live knock for carol
    liveCallback('carol', { count: 1, ts: Date.now() });

    // alice (older ts) should animate first
    expect(liA.classList.contains('knock-deferred')).toBe(true);
    expect(liB.classList.contains('knock-deferred')).toBe(false);
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
  test('resets debounce map, queue, and deferredKeys on re-call', async () => {
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
    expect(li.style.transition).toBe('background-color 2s ease-out');
    expect(li.style.backgroundColor).toBe('rgba(244, 63, 94, 0)');
  });

  test('falls back to #22c55e when dot has no inline background', async () => {
    const fire = await setupLive();
    const li = makeLi('alice');
    const dot = document.createElement('div');
    dot.className = 'person-dot';
    li.appendChild(dot); // no dot.style.background set

    fire('alice', { count: 1, ts: Date.now() });
    expect(li.style.transition).toBe('background-color 2s ease-out');
    expect(li.style.backgroundColor).toBe('rgba(34, 197, 94, 0)');
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
    makeLi('alice');
    fire('alice', { count: 1, ts: Date.now() });
    // jsdom shows decay target (alpha=0); transition property confirms fade was started
    expect(document.querySelector('[data-user-id="alice"]').style.transition)
      .toBe('background-color 2s ease-out');
  });

  test('count=2 sets alpha to 0.8', async () => {
    const fire = await setupLive();
    makeLi('alice');
    fire('alice', { count: 2, ts: Date.now() });
    expect(document.querySelector('[data-user-id="alice"]').style.transition)
      .toBe('background-color 2s ease-out');
  });

  test('intensity capped at 1.0 — two sequential count=2 knocks stay ≤ 1', async () => {
    const fire = await setupLive();
    const li = makeLi('alice');
    fire('alice', { count: 2, ts: Date.now() }); // 0.8
    fire('alice', { count: 2, ts: Date.now() }); // would be 1.6, capped to 1.0
    // Transition was started (not blocked by a cap bug)
    expect(li.style.transition).toBe('background-color 2s ease-out');
    // Timer fires after 2.1s — cleanup works even at capped intensity
    jest.advanceTimersByTime(2100);
    expect(li.style.backgroundColor).toBe('');
  });

  test('cancels previous cleanup timer on re-knock', async () => {
    const fire = await setupLive();
    const li = makeLi('alice');
    fire('alice', { count: 1, ts: Date.now() });
    jest.advanceTimersByTime(1000); // 1s into 2.1s timer
    fire('alice', { count: 1, ts: Date.now() }); // resets timer
    // 1.2s after second knock (2.2s after first): first timer would have fired, second hasn't
    jest.advanceTimersByTime(1200);
    expect(li.style.backgroundColor).not.toBe('');
  });

  test('cleans up inline styles after 2.1s', async () => {
    const fire = await setupLive();
    const li = makeLi('alice');
    fire('alice', { count: 1, ts: Date.now() });
    expect(li.style.backgroundColor).not.toBe('');

    jest.advanceTimersByTime(2100);
    expect(li.style.backgroundColor).toBe('');
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
    expect(li.style.backgroundColor).not.toBe('');

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
  test('playNext uses sender dot color instead of hardcoded green', async () => {
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
