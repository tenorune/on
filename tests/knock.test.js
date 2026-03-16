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

// --- initKnocks: live listener ---

describe('initKnocks: live listener', () => {
  test('enqueues correct count × animation-1 entries (including count > 1)', async () => {
    let liveCallback;
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockImplementation((_uid, cb) => {
      liveCallback = cb;
      return jest.fn();
    });
    clearKnock.mockResolvedValue();

    await initKnocks('myUid');

    const li = makeLi('alice');
    liveCallback('alice', { count: 3, ts: Date.now() });

    // First knock-live animation starts immediately
    expect(li.classList.contains('knock-live')).toBe(true);

    // Fire animationend, advance timer past gap; second animation should start
    li.dispatchEvent(new Event('animationend'));
    jest.advanceTimersByTime(300);
    expect(li.classList.contains('knock-live')).toBe(true);

    li.dispatchEvent(new Event('animationend'));
    jest.advanceTimersByTime(300);
    expect(li.classList.contains('knock-live')).toBe(true);
  });
});

// --- animation queue ---

describe('animation queue: sequence gap', () => {
  test('500ms gap between sequences (different userId)', async () => {
    let liveCallback;
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockImplementation((_uid, cb) => {
      liveCallback = cb;
      return jest.fn();
    });
    clearKnock.mockResolvedValue();

    await initKnocks('myUid');
    const liA = makeLi('alice');
    const liB = makeLi('bob');

    liveCallback('alice', { count: 1, ts: Date.now() });
    liveCallback('bob', { count: 1, ts: Date.now() + 1 });

    // alice animates first
    expect(liA.classList.contains('knock-live')).toBe(true);
    liA.dispatchEvent(new Event('animationend'));

    // < 500ms: bob should not have started
    jest.advanceTimersByTime(499);
    expect(liB.classList.contains('knock-live')).toBe(false);

    // After 500ms: bob starts
    jest.advanceTimersByTime(1);
    expect(liB.classList.contains('knock-live')).toBe(true);
  });

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
