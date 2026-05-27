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
  jest.mock('../js/groupNav.js', () => ({
    getCurrentContext: jest.fn(() => ({ context: 'direct', groupId: null })),
  }));
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
    expect(writeKnock).toHaveBeenCalledWith('u1', 'me', {});
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
    expect(writeKnock).toHaveBeenCalledWith('u1', 'me', {});
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
    expect(writeKnock).toHaveBeenCalledWith('u1', 'me', {});
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
    expect(writeKnock).toHaveBeenCalledWith('u1', 'me', {});
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

  test('knock with ts clearly before appOpenTime is shown as deferred, not live', async () => {
    const fire = await setupLiveListener();
    const li = makeLi('alice');
    // ts ~5 min before session start — well outside the 60s clock-skew
    // tolerance, so this simulates reconnect delivering a genuinely
    // pre-existing knock (not a fresh cross-device knock with skew).
    fire('alice', { count: 1, ts: Date.now() - 5 * 60_000 });
    expect(li.classList.contains('knock-deferred')).toBe(true);
    expect(clearKnock).toHaveBeenCalledWith('myUid', 'alice');
    // Should NOT have applied a live pulse (no boxShadow transition set)
    expect(li.style.transition).not.toContain('box-shadow 2s');
  });

  test('knock with ts within 60s clock-skew window is treated as live, not deferred', async () => {
    // Regression: prior to the clock-skew tolerance, fresh cross-device
    // knocks where the sender's clock was a few seconds behind the
    // recipient's were misclassified as deferred — landing on a hidden
    // Direct contact li (global selector) and never floating to the top.
    const fire = await setupLiveListener();
    const li = makeLi('alice');
    fire('alice', { count: 1, ts: Date.now() - 30_000 }); // 30s of skew
    // Live pulse, NOT deferred:
    expect(li.classList.contains('knock-deferred')).toBe(false);
    expect(li.classList.contains('knock-live')).toBe(true);
  });
});

// --- live knock pulse ---

describe('live knock pulse', () => {
  async function setupLive() {
    let liveCallback;
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockImplementation((_uid, cb) => { liveCallback = cb; return jest.fn(); });
    clearKnock.mockResolvedValue();
    await initKnocks('myUid');
    return liveCallback;
  }

  test('sets --knock-color from person-dot.style.background and adds .knock-live class', async () => {
    const fire = await setupLive();
    const li = makeLi('alice');
    const dot = document.createElement('div');
    dot.className = 'person-dot';
    dot.style.background = '#f43f5e';
    li.appendChild(dot);

    fire('alice', { count: 1, ts: Date.now() });
    expect(li.style.getPropertyValue('--knock-color')).toMatch(/rgb\(244,\s*63,\s*94\)|#f43f5e/);
    expect(li.classList.contains('knock-live')).toBe(true);
  });

  test('falls back to #22c55e when available and dot has no inline background', async () => {
    const fire = await setupLive();
    const li = makeLi('alice');
    const dot = document.createElement('div');
    dot.className = 'person-dot';
    li.appendChild(dot);

    fire('alice', { count: 1, ts: Date.now() });
    expect(li.style.getPropertyValue('--knock-color')).toBe('#22c55e');
    expect(li.classList.contains('knock-live')).toBe(true);
  });

  test('uses grey (#6b7280 fallback) when sender is unavailable', async () => {
    const fire = await setupLive();
    const li = makeLi('alice', { available: false });

    fire('alice', { count: 1, ts: Date.now() });
    expect(li.style.getPropertyValue('--knock-color')).toBe('#6b7280');
    expect(li.classList.contains('knock-live')).toBe(true);
  });

  test('repeated knocks re-trigger the animation (class removed then re-added each time)', async () => {
    const fire = await setupLive();
    const li = makeLi('alice');
    fire('alice', { count: 1, ts: Date.now() });
    expect(li.classList.contains('knock-live')).toBe(true);
    // Second knock — the helper removes the class to retrigger then adds again.
    fire('alice', { count: 1, ts: Date.now() });
    expect(li.classList.contains('knock-live')).toBe(true);
  });

  test('animationend handler removes the .knock-live class', async () => {
    const fire = await setupLive();
    const li = makeLi('alice');
    fire('alice', { count: 1, ts: Date.now() });
    expect(li.classList.contains('knock-live')).toBe(true);
    li.dispatchEvent(new Event('animationend'));
    expect(li.classList.contains('knock-live')).toBe(false);
  });

  test('skips silently when sender li not in DOM', async () => {
    const fire = await setupLive();
    expect(() => fire('ghost', { count: 1, ts: Date.now() })).not.toThrow();
  });

  test('live knock with contextGroupId targets the group-roster li when recipient is in that group', async () => {
    const { getCurrentContext } = require('../js/groupNav.js');
    getCurrentContext.mockReturnValue({ context: 'group', groupId: 'G1' });

    const root = document.createElement('div');
    root.id = 'group-context-root';
    const list = document.createElement('ul');
    list.id = 'group-roster';
    const li = document.createElement('li');
    li.dataset.userId = 'alice';
    li.dataset.available = 'true';
    const dot = document.createElement('div');
    dot.className = 'person-dot';
    dot.style.background = '#11aaff';
    li.appendChild(dot);
    list.appendChild(li);
    root.appendChild(list);
    document.body.appendChild(root);

    const fire = await setupLive();
    fire('alice', { count: 1, ts: Date.now(), contextGroupId: 'G1' });

    expect(li.classList.contains('knock-live')).toBe(true);
    expect(list.firstElementChild).toBe(li);
  });
});

describe('live knock pulse: state reset on re-init', () => {
  test('initKnocks can be re-called without crashing after a prior live knock', async () => {
    let liveCallback;
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockImplementation((_uid, cb) => { liveCallback = cb; return jest.fn(); });
    clearKnock.mockResolvedValue();
    await initKnocks('myUid');

    const li = makeLi('alice');
    liveCallback('alice', { count: 1, ts: Date.now() });
    expect(li.classList.contains('knock-live')).toBe(true);

    // Re-init clears internal maps. Should not throw, should leave previously-
    // animated elements alone.
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockReturnValue(jest.fn());
    await expect(initKnocks('myUid')).resolves.not.toThrow();
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

// --- float-to-top + group-card badge (Task 20) ---

describe('float-to-top', () => {
  let applyFloatToTop;

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
    jest.mock('../js/groupNav.js', () => ({
      getCurrentContext: jest.fn(() => ({ context: 'group', groupId: 'G1' })),
    }));
    ({ applyFloatToTop } = require('../js/knock.js'));

    document.body.innerHTML = `
      <ul id="list">
        <li data-user-id="a">A</li>
        <li data-user-id="b">B</li>
        <li data-user-id="c">C</li>
      </ul>
    `;
  });

  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  test('floats the targeted row to top', () => {
    const li = document.querySelector('[data-user-id="b"]');
    applyFloatToTop(li);
    const order = Array.from(document.querySelectorAll('#list li')).map((el) => el.dataset.userId);
    expect(order).toEqual(['b', 'a', 'c']);
  });

  test('restores the row to its original position after 20s', () => {
    const li = document.querySelector('[data-user-id="b"]');
    applyFloatToTop(li);
    jest.advanceTimersByTime(20000);
    const order = Array.from(document.querySelectorAll('#list li')).map((el) => el.dataset.userId);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  test('repeated float resets the 20s timer', () => {
    const li = document.querySelector('[data-user-id="b"]');
    applyFloatToTop(li);
    jest.advanceTimersByTime(15000);
    applyFloatToTop(li);
    jest.advanceTimersByTime(15000);
    const order = Array.from(document.querySelectorAll('#list li')).map((el) => el.dataset.userId);
    expect(order).toEqual(['b', 'a', 'c']);
  });
});

describe('drainPendingKnocks', () => {
  let initKnocks, sendKnock, drainPendingKnocks, watchKnocksAdded, getKnocks, clearKnock, writeKnock;
  let mockGetCurrentContext;

  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = '';
    jest.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    jest.mock('../js/features.js', () => ({ KNOCK_ENABLED: true, PALETTES_ENABLED: false }));
    jest.mock('../js/db.js', () => ({
      writeKnock: jest.fn().mockResolvedValue(),
      getKnocks: jest.fn(),
      watchKnocksAdded: jest.fn(() => jest.fn()),
      clearKnock: jest.fn().mockResolvedValue(),
    }));
    jest.mock('../js/store.js', () => ({}));
    jest.mock('../js/firebase-config.js', () => ({ db: {} }));
    mockGetCurrentContext = jest.fn(() => ({ context: 'direct', groupId: null }));
    jest.mock('../js/groupNav.js', () => ({ getCurrentContext: mockGetCurrentContext }));
    ({ initKnocks, sendKnock, drainPendingKnocks } = require('../js/knock.js'));
    const db = require('../js/db.js');
    watchKnocksAdded = db.watchKnocksAdded;
    getKnocks = db.getKnocks;
    clearKnock = db.clearKnock;
    writeKnock = db.writeKnock;
    window.scrollTo = jest.fn();
  });

  afterEach(() => { jest.useRealTimers(); });

  test('a live knock with contextGroupId in a non-matching context stashes and drains on entry', async () => {
    // Bob is in Direct context when Ann sends a knock with contextGroupId=G1.
    let liveCb;
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockImplementation((_uid, cb) => { liveCb = cb; return jest.fn(); });
    await initKnocks('bob');
    // Live knock arrives — Bob is still in Direct.
    liveCb('ann', { count: 1, ts: Date.now(), contextGroupId: 'G1' });

    // Set up the group roster as it would appear after Bob navigates into G1.
    const root = document.createElement('div');
    root.id = 'group-context-root';
    const list = document.createElement('ul');
    list.id = 'group-roster';
    const annLi = document.createElement('li');
    annLi.dataset.userId = 'ann';
    annLi.dataset.available = 'false';
    const dot = document.createElement('div');
    dot.className = 'person-dot';
    annLi.appendChild(dot);
    list.appendChild(annLi);
    root.appendChild(list);
    document.body.appendChild(root);
    mockGetCurrentContext.mockReturnValue({ context: 'group', groupId: 'G1' });

    drainPendingKnocks('G1');

    // The drain should have:
    // - Applied the .knock-deferred CSS animation to Ann's li.
    // - Prepended Ann's li (float-to-top — already first since it's the only li, but verify).
    // - Cleared the knock from Firebase.
    // - Scrolled to top.
    expect(annLi.classList.contains('knock-deferred')).toBe(true);
    expect(list.firstElementChild).toBe(annLi);
    expect(clearKnock).toHaveBeenCalledWith('bob', 'ann');
    expect(window.scrollTo).toHaveBeenCalled();
  });

  test('drainPendingKnocks is idempotent: calling twice does not double-animate', async () => {
    let liveCb;
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockImplementation((_uid, cb) => { liveCb = cb; return jest.fn(); });
    await initKnocks('bob');
    liveCb('ann', { count: 1, ts: Date.now(), contextGroupId: 'G1' });

    const root = document.createElement('div');
    root.id = 'group-context-root';
    const list = document.createElement('ul');
    list.id = 'group-roster';
    const annLi = document.createElement('li');
    annLi.dataset.userId = 'ann';
    annLi.dataset.available = 'false';
    const dot = document.createElement('div');
    dot.className = 'person-dot';
    annLi.appendChild(dot);
    list.appendChild(annLi);
    root.appendChild(list);
    document.body.appendChild(root);
    mockGetCurrentContext.mockReturnValue({ context: 'group', groupId: 'G1' });

    drainPendingKnocks('G1');
    expect(clearKnock).toHaveBeenCalledTimes(1);
    // Second drain is a no-op since the stash was cleared.
    drainPendingKnocks('G1');
    expect(clearKnock).toHaveBeenCalledTimes(1);
  });

  test('live knock with contextGroupId AND matching current context scrolls to top', async () => {
    let liveCb;
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockImplementation((_uid, cb) => { liveCb = cb; return jest.fn(); });

    // Bob is already in G1 — set up roster + context before initKnocks fires.
    const root = document.createElement('div');
    root.id = 'group-context-root';
    const list = document.createElement('ul');
    list.id = 'group-roster';
    const annLi = document.createElement('li');
    annLi.dataset.userId = 'ann';
    annLi.dataset.available = 'true';
    const dot = document.createElement('div');
    dot.className = 'person-dot';
    annLi.appendChild(dot);
    list.appendChild(annLi);
    root.appendChild(list);
    document.body.appendChild(root);
    mockGetCurrentContext.mockReturnValue({ context: 'group', groupId: 'G1' });
    await initKnocks('bob');

    liveCb('ann', { count: 1, ts: Date.now(), contextGroupId: 'G1' });
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });
});

describe('group-card badge', () => {
  let bumpGroupCardBadge, clearGroupCardBadge;

  beforeEach(() => {
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
    jest.mock('../js/groupNav.js', () => ({
      getCurrentContext: jest.fn(() => ({ context: 'group', groupId: 'G1' })),
    }));
    ({ bumpGroupCardBadge, clearGroupCardBadge } = require('../js/knock.js'));

    document.body.innerHTML = `<button class="group-card" data-group-id="G1"></button>`;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('bumpGroupCardBadge adds a badge with the count', () => {
    bumpGroupCardBadge('G1');
    expect(document.querySelector('.group-card[data-group-id="G1"] .group-card-badge').textContent).toBe('1');
    bumpGroupCardBadge('G1');
    expect(document.querySelector('.group-card[data-group-id="G1"] .group-card-badge').textContent).toBe('2');
  });

  test('clearGroupCardBadge removes the badge', () => {
    bumpGroupCardBadge('G1');
    clearGroupCardBadge('G1');
    expect(document.querySelector('.group-card[data-group-id="G1"] .group-card-badge')).toBeNull();
  });
});
