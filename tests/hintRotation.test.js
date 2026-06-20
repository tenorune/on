// tests/hintRotation.test.js
jest.mock('../js/groupNav.js', () => ({ getCurrentContext: jest.fn(() => ({ context: 'direct', groupId: null })) }));
jest.mock('../js/cardDrawer.js', () => ({ isCardDrawerOpen: jest.fn(() => false) }));
jest.mock('../js/notifyBell.js', () => ({ isNotifyPopoverOpen: jest.fn(() => false) }));
jest.mock('../js/following.js', () => ({
  getCallModeCalleeId: jest.fn(() => null),
  getIncomingCallFrom: jest.fn(() => null),
}));

const { resolvePool, selectNextHint, isPaused } = require('../js/hintRotation.js');

describe('resolvePool', () => {
  const vis = (set) => (id) => set.has(id);

  test('returns only available ids when any visible candidate is available', () => {
    const cands = [
      { id: 'a', available: false },
      { id: 'b', available: true },
      { id: 'c', available: true },
    ];
    expect(resolvePool(cands, vis(new Set(['a', 'b', 'c'])))).toEqual(['b', 'c']);
  });

  test('falls back to visible unavailable ids when none visible is available', () => {
    const cands = [
      { id: 'a', available: false },
      { id: 'b', available: false },
    ];
    expect(resolvePool(cands, vis(new Set(['a', 'b'])))).toEqual(['a', 'b']);
  });

  test('an available-but-offscreen candidate does not block a visible unavailable one', () => {
    const cands = [
      { id: 'off', available: true },   // not visible
      { id: 'on', available: false },   // visible
    ];
    expect(resolvePool(cands, vis(new Set(['on'])))).toEqual(['on']);
  });

  test('returns empty when nothing is visible', () => {
    const cands = [{ id: 'a', available: true }];
    expect(resolvePool(cands, vis(new Set()))).toEqual([]);
  });

  test('preserves input order', () => {
    const cands = [
      { id: 'x', available: true },
      { id: 'y', available: true },
    ];
    expect(resolvePool(cands, vis(new Set(['x', 'y'])))).toEqual(['x', 'y']);
  });
});

describe('selectNextHint', () => {
  const fresh = () => ({ lastType: null, lastIds: { longpress: null, swipe: null } });

  test('returns {type:null} when both pools are empty', () => {
    const r = selectNextHint(fresh(), { longpress: [], swipe: [] });
    expect(r.type).toBeNull();
    expect(r.id).toBeNull();
  });

  test('single non-empty pool: no type flip, round-robins and wraps', () => {
    let s = fresh();
    let r = selectNextHint(s, { longpress: ['a', 'b'], swipe: [] });
    expect([r.type, r.id]).toEqual(['longpress', 'a']);
    r = selectNextHint(r.state, { longpress: ['a', 'b'], swipe: [] });
    expect([r.type, r.id]).toEqual(['longpress', 'b']);
    r = selectNextHint(r.state, { longpress: ['a', 'b'], swipe: [] });
    expect([r.type, r.id]).toEqual(['longpress', 'a']); // wrap
  });

  test('both pools: type alternates every step', () => {
    let r = selectNextHint(fresh(), { longpress: ['a'], swipe: ['a'] });
    const types = [r.type];
    for (let i = 0; i < 3; i++) {
      r = selectNextHint(r.state, { longpress: ['a'], swipe: ['a'] });
      types.push(r.type);
    }
    expect(types).toEqual(['longpress', 'swipe', 'longpress', 'swipe']);
  });

  test('each type round-robins its OWN list independently while alternating', () => {
    const pools = { longpress: ['A', 'C'], swipe: ['A', 'B', 'C'] };
    let r = selectNextHint(fresh(), pools);
    const seq = [[r.type, r.id]];
    for (let i = 0; i < 5; i++) {
      r = selectNextHint(r.state, pools);
      seq.push([r.type, r.id]);
    }
    expect(seq).toEqual([
      ['longpress', 'A'],
      ['swipe', 'A'],
      ['longpress', 'C'],
      ['swipe', 'B'],
      ['longpress', 'A'],
      ['swipe', 'C'],
    ]);
  });

  test('round-robin is identity-stable when the pool reorders between calls', () => {
    let r = selectNextHint(fresh(), { longpress: ['A', 'B'], swipe: [] });
    expect([r.type, r.id]).toEqual(['longpress', 'A']);
    // same order → advance to B
    r = selectNextHint(r.state, { longpress: ['A', 'B'], swipe: [] });
    expect([r.type, r.id]).toEqual(['longpress', 'B']);
    // pool reordered to ['B','A']: advance to the card AFTER last-shown 'B'
    // in the CURRENT order, which wraps to 'A' (must NOT repeat 'B').
    r = selectNextHint(r.state, { longpress: ['B', 'A'], swipe: [] });
    expect([r.type, r.id]).toEqual(['longpress', 'A']);
  });

  test('restarts at index 0 when the last-shown id is gone from the pool', () => {
    let r = selectNextHint(fresh(), { longpress: ['A', 'B'], swipe: [] });
    expect([r.type, r.id]).toEqual(['longpress', 'A']);
    // 'A' removed; last-shown 'A' absent → restart at index 0 of current pool.
    r = selectNextHint(r.state, { longpress: ['B', 'C'], swipe: [] });
    expect([r.type, r.id]).toEqual(['longpress', 'B']);
  });
});

describe('isPaused', () => {
  const none = { overlayOpen: false, callActive: false, hidden: false, scrolling: false };
  test('false when nothing is set', () => { expect(isPaused(none)).toBe(false); });
  test('true if any single flag is set', () => {
    for (const k of ['overlayOpen', 'callActive', 'hidden', 'scrolling']) {
      expect(isPaused({ ...none, [k]: true })).toBe(true);
    }
  });
});

const {
  _collectCandidates, _placeHint, _clearActive, _resetEngineForTest,
} = require('../js/hintRotation.js');

describe('engine: _collectCandidates', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <ul id="people-list">
        <li data-user-id="a" data-hint-longpress="1" data-hint-swipe="1" data-hint-avail="1"></li>
        <li data-user-id="b" data-hint-longpress="0" data-hint-swipe="1" data-hint-avail="0"></li>
        <li data-user-id="c" data-hint-longpress="1" data-hint-swipe="0" data-hint-avail="1"></li>
      </ul>`;
  });

  test('reads data-hint-* attributes from #people-list in DOM order', () => {
    const pools = _collectCandidates(document.getElementById('people-list'));
    expect(pools.longpress.map((c) => [c.id.dataset.userId, c.available]))
      .toEqual([['a', true], ['c', true]]);
    expect(pools.swipe.map((c) => [c.id.dataset.userId, c.available]))
      .toEqual([['a', true], ['b', false]]);
  });
});

describe('engine: placement', () => {
  beforeEach(() => {
    _resetEngineForTest();
    document.body.innerHTML = `<ul id="people-list"><li data-user-id="a"></li></ul>`;
  });

  test('_placeHint adds exactly one hint element of the right class', () => {
    const li = document.querySelector('[data-user-id="a"]');
    _placeHint(li, 'longpress');
    expect(document.querySelectorAll('.longpress-hint').length).toBe(1);
    expect(li.querySelector('.longpress-hint')).not.toBeNull();
  });

  test('_placeHint swaps to a single element when the type changes on the same card', () => {
    const li = document.querySelector('[data-user-id="a"]');
    _placeHint(li, 'longpress');
    _placeHint(li, 'swipe');
    expect(document.querySelectorAll('.longpress-hint, .swipe-hint').length).toBe(1);
    expect(li.querySelector('.swipe-hint')).not.toBeNull();
  });

  test('_clearActive removes all hint elements document-wide', () => {
    const li = document.querySelector('[data-user-id="a"]');
    _placeHint(li, 'longpress');
    _clearActive();
    expect(document.querySelectorAll('.longpress-hint, .swipe-hint').length).toBe(0);
  });
});

const { _collectPauseFlags } = require('../js/hintRotation.js');
const cardDrawer = require('../js/cardDrawer.js');
const notifyBell = require('../js/notifyBell.js');
const following = require('../js/following.js');

describe('engine: _collectPauseFlags', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="add-person-form"></div>
      <div id="code-drawer"></div>
      <div id="create-group-modal" class="hidden"></div>
      <details id="group-context-actions"></details>
      <div id="recovery-revealed" class="hidden"></div>`;
    cardDrawer.isCardDrawerOpen.mockReturnValue(false);
    notifyBell.isNotifyPopoverOpen.mockReturnValue(false);
    following.getCallModeCalleeId.mockReturnValue(null);
    following.getIncomingCallFrom.mockReturnValue(null);
  });

  test('overlayOpen true when the code drawer is open', () => {
    document.getElementById('code-drawer').classList.add('open');
    expect(_collectPauseFlags().overlayOpen).toBe(true);
  });

  test('overlayOpen true when the settings details is open', () => {
    document.getElementById('group-context-actions').open = true;
    expect(_collectPauseFlags().overlayOpen).toBe(true);
  });

  test('callActive true when a call is in progress', () => {
    following.getCallModeCalleeId.mockReturnValue('peer1');
    expect(_collectPauseFlags().callActive).toBe(true);
  });

  test('all flags false in a clean Direct view', () => {
    expect(_collectPauseFlags()).toEqual({
      overlayOpen: false, callActive: false, hidden: false, scrolling: false,
    });
  });
});

const { _step, refreshHints, initHintRotation, stopHintRotation } = require('../js/hintRotation.js');

describe('engine: _step integration', () => {
  const inView = (li) => { li.getBoundingClientRect = () => ({ top: 100, bottom: 150, height: 50, left: 0, right: 100, width: 100 }); };
  beforeEach(() => {
    _resetEngineForTest();
    document.body.innerHTML = `
      <ul id="people-list">
        <li data-user-id="a" data-hint-longpress="1" data-hint-swipe="1" data-hint-avail="1"></li>
        <li data-user-id="b" data-hint-longpress="1" data-hint-swipe="1" data-hint-avail="1"></li>
      </ul>`;
    document.querySelectorAll('#people-list li').forEach(inView);
    // getCurrentContext is already mocked to { context: 'direct' } at top of file.
  });

  test('places exactly one hint on a visible eligible row', () => {
    _step();
    expect(document.querySelectorAll('.longpress-hint, .swipe-hint').length).toBe(1);
  });

  test('alternates type across consecutive steps', () => {
    _step();
    const first = document.querySelector('.longpress-hint, .swipe-hint').className;
    _step();
    const second = document.querySelector('.longpress-hint, .swipe-hint').className;
    expect(first).not.toBe(second); // longpress-hint <-> swipe-hint
    expect(document.querySelectorAll('.longpress-hint, .swipe-hint').length).toBe(1);
  });

  test('clears the hint when an overlay is open (paused)', () => {
    _step();
    expect(document.querySelectorAll('.longpress-hint, .swipe-hint').length).toBe(1);
    const drawer = document.createElement('div');
    drawer.id = 'code-drawer'; drawer.className = 'open';
    document.body.appendChild(drawer);
    _step();
    expect(document.querySelectorAll('.longpress-hint, .swipe-hint').length).toBe(0);
  });

  test('initHintRotation fires an immediate pulse then steps on the interval', () => {
    jest.useFakeTimers();
    try {
      initHintRotation();
      expect(document.querySelectorAll('.longpress-hint, .swipe-hint').length).toBe(1);
      const before = document.querySelector('.longpress-hint, .swipe-hint').className;
      jest.advanceTimersByTime(6850);
      const after = document.querySelector('.longpress-hint, .swipe-hint').className;
      expect(after).not.toBe(before); // advanced (type alternated)
      expect(document.querySelectorAll('.longpress-hint, .swipe-hint').length).toBe(1);
    } finally {
      stopHintRotation();
      jest.useRealTimers();
    }
  });

  test('refreshHints clears the active hint when its row is removed from the DOM', () => {
    initHintRotation();          // sets _started + places a hint
    const active = document.querySelector('.longpress-hint, .swipe-hint').closest('li');
    active.remove();
    refreshHints();
    expect(document.querySelectorAll('.longpress-hint, .swipe-hint').length).toBe(0);
    stopHintRotation();
  });
});
