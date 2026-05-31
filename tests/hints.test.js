// tests/hints.test.js
jest.mock('../js/db.js', () => ({
  mergeUserPrefs: jest.fn().mockResolvedValue(undefined),
  watchUserPrefs: jest.fn(() => () => {}),
}));

const {
  shouldShowSwatchWave, shouldShowThemeHint, shouldShowDotGoHint,
  shouldShowSetTogglePulse, isLongpressHintEligible, isSwipeHintEligible,
} = require('../js/hints.js');

const defaultState = () => ({
  activeSet: 1,
  sets: {
    '1': { selectedKey: 'forest', activePaletteKey: null },
    '2': { selectedKey: 'volt',   activePaletteKey: null },
  },
});

beforeEach(() => { localStorage.clear(); });

describe('shouldShowSwatchWave', () => {
  test('true when both sets default and customAvail unseen', () => {
    expect(shouldShowSwatchWave(defaultState())).toBe(true);
  });
  test('false once customAvail is seen', () => {
    localStorage.setItem('statusapp_went_avail_custom', '1');
    expect(shouldShowSwatchWave(defaultState())).toBe(false);
  });
  test('false when Set 1 selectedKey is non-default', () => {
    const s = defaultState();
    s.sets['1'].selectedKey = 'iris';
    expect(shouldShowSwatchWave(s)).toBe(false);
  });
  test('false when Set 2 selectedKey is non-default', () => {
    const s = defaultState();
    s.sets['2'].selectedKey = 'ember';
    expect(shouldShowSwatchWave(s)).toBe(false);
  });
});

describe('shouldShowThemeHint', () => {
  test('true when customAvail seen and theme unseen', () => {
    localStorage.setItem('statusapp_went_avail_custom', '1');
    expect(shouldShowThemeHint()).toBe(true);
  });
  test('false when customAvail unseen', () => {
    expect(shouldShowThemeHint()).toBe(false);
  });
  test('false once theme is seen', () => {
    localStorage.setItem('statusapp_went_avail_custom', '1');
    localStorage.setItem('statusapp_seen_theme', '1');
    expect(shouldShowThemeHint()).toBe(false);
  });
});

describe('shouldShowDotGoHint', () => {
  test('true when non-default selected, customAvail unseen, dot unavailable', () => {
    expect(shouldShowDotGoHint({ isNonDefault: true, dotAvailable: false })).toBe(true);
  });
  test('false when on default', () => {
    expect(shouldShowDotGoHint({ isNonDefault: false, dotAvailable: false })).toBe(false);
  });
  test('false when dot already available', () => {
    expect(shouldShowDotGoHint({ isNonDefault: true, dotAvailable: true })).toBe(false);
  });
  test('false once customAvail is seen', () => {
    localStorage.setItem('statusapp_went_avail_custom', '1');
    expect(shouldShowDotGoHint({ isNonDefault: true, dotAvailable: false })).toBe(false);
  });
});

describe('shouldShowSetTogglePulse', () => {
  test('true for Set 1 when bolt unseen', () => {
    expect(shouldShowSetTogglePulse(1)).toBe(true);
  });
  test('false for Set 1 once bolt seen', () => {
    localStorage.setItem('statusapp_seen_bolt', '1');
    expect(shouldShowSetTogglePulse(1)).toBe(false);
  });
  test('true for Set 2 when flower unseen', () => {
    expect(shouldShowSetTogglePulse(2)).toBe(true);
  });
  test('false for Set 2 once flower seen', () => {
    localStorage.setItem('statusapp_seen_flower', '1');
    expect(shouldShowSetTogglePulse(2)).toBe(false);
  });
});

describe('isLongpressHintEligible / isSwipeHintEligible', () => {
  function markChain() {
    localStorage.setItem('statusapp_went_avail_custom', '1');
    localStorage.setItem('statusapp_seen_theme', '1');
    localStorage.setItem('statusapp_seen_strip_peek_done', '1');
  }
  test('longpress eligible only after customAvail+theme+stripPeek and not longpress-seen', () => {
    expect(isLongpressHintEligible()).toBe(false);
    markChain();
    expect(isLongpressHintEligible()).toBe(true);
    localStorage.setItem('statusapp_seen_longpress', '1');
    expect(isLongpressHintEligible()).toBe(false);
  });
  test('swipe eligible follows the same chain', () => {
    expect(isSwipeHintEligible()).toBe(false);
    markChain();
    expect(isSwipeHintEligible()).toBe(true);
    localStorage.setItem('statusapp_seen_swipe', '1');
    expect(isSwipeHintEligible()).toBe(false);
  });
});
