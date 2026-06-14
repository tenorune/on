// tests/palettes.test.js
jest.mock('../js/db.js', () => ({
  setStatusColor: jest.fn().mockResolvedValue(undefined),
  setPaletteKey: jest.fn().mockResolvedValue(undefined),
  watchPendingInvites: jest.fn(() => () => {}),
  writePendingInvite: jest.fn().mockResolvedValue(undefined),
  deletePendingInvite: jest.fn().mockResolvedValue(undefined),
  readPendingInviteesForGroup: jest.fn().mockResolvedValue([]),
}));

const DEFAULT_PALETTE_STATE = {
  activeSet: 1,
  sets: {
    '1': { selectedKey: 'forest', activePaletteKey: null },
    '2': { selectedKey: 'volt',   activePaletteKey: null },
  },
};

jest.mock('../js/store.js', () => ({
  getPaletteState: jest.fn().mockImplementation(() =>
    JSON.parse(JSON.stringify(DEFAULT_PALETTE_STATE))
  ),
  setPaletteState: jest.fn(),
  getPalette: jest.fn().mockReturnValue('forest'),
  setPalette: jest.fn(),
}));

const {
  PALETTE_SETS, getPaletteByKey, getGlowForColor, applyPaletteVars,
  applyThemeVars, resetThemeVars,
  tapSwatch, initSwatches, switchSet,
  enterPaletteMode, exitPaletteMode,
  startSwatchHints, paintStatusDot, syncPaletteStateFromServer,
} = require('../js/palettes.js');
const { setStatusColor } = require('../js/db.js');
const { getPaletteState, setPaletteState } = require('../js/store.js');

// --- PALETTE_SETS structure ---

test('PALETTE_SETS[1] has 8 entries', () => {
  expect(PALETTE_SETS[1]).toHaveLength(8);
});

test('PALETTE_SETS[2] has 8 entries', () => {
  expect(PALETTE_SETS[2]).toHaveLength(8);
});

test('PALETTE_SETS[1] contains all Natural keys', () => {
  const keys = PALETTE_SETS[1].map(p => p.key);
  expect(keys).toEqual(['forest', 'ocean', 'iris', 'ember', 'coral', 'sky', 'gold', 'mint']);
});

test('PALETTE_SETS[2] contains all Electric keys', () => {
  const keys = PALETTE_SETS[2].map(p => p.key);
  expect(keys).toEqual(['volt', 'plasma', 'arc', 'venom', 'inferno', 'aurora', 'solar', 'ultraviolet']);
});

test('forest palette has correct hex and glow', () => {
  const forest = PALETTE_SETS[1].find(p => p.key === 'forest');
  expect(forest.color).toBe('#22c55e');
  expect(forest.glow).toBe('rgba(34,197,94,0.4)');
});

test('volt palette has correct hex and glow', () => {
  const volt = PALETTE_SETS[2].find(p => p.key === 'volt');
  expect(volt.color).toBe('#aaff00');
  expect(volt.glow).toBe('rgba(170,255,0,0.4)');
});

test('each Set 1 palette has theme and complements', () => {
  PALETTE_SETS[1].forEach(p => {
    expect(p.theme).toBeDefined();
    expect(p.theme.bg).toBeDefined();
    expect(p.complements).toHaveLength(7);
  });
});

test('each Set 2 palette has theme and complements', () => {
  PALETTE_SETS[2].forEach(p => {
    expect(p.theme).toBeDefined();
    expect(p.complements).toHaveLength(7);
  });
});

// --- getPaletteByKey ---

test('getPaletteByKey returns correct palette for Set 1 key', () => {
  const p = getPaletteByKey('iris');
  expect(p.color).toBe('#818cf8');
});

test('getPaletteByKey returns correct palette for Set 2 key', () => {
  const p = getPaletteByKey('volt');
  expect(p.color).toBe('#aaff00');
});

test('getPaletteByKey returns null for unknown key', () => {
  expect(getPaletteByKey('nonexistent')).toBeNull();
});

// --- getGlowForColor ---

test('getGlowForColor returns correct glow for Set 1 hex', () => {
  expect(getGlowForColor('#818cf8')).toBe('rgba(129,140,248,0.4)');
});

test('getGlowForColor returns correct glow for Set 2 hex', () => {
  expect(getGlowForColor('#aaff00')).toBe('rgba(170,255,0,0.4)');
});

test('getGlowForColor falls back to forest glow for unknown hex', () => {
  expect(getGlowForColor('#000000')).toBe('rgba(34,197,94,0.4)');
});

// --- applyPaletteVars (unchanged API) ---

test('applyPaletteVars sets --my-status on :root for Set 1 key', () => {
  applyPaletteVars('iris');
  expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#818cf8');
});

test('applyPaletteVars sets --my-glow on :root for Set 1 key', () => {
  applyPaletteVars('iris');
  expect(document.documentElement.style.getPropertyValue('--my-glow')).toBe('rgba(129,140,248,0.4)');
});

test('applyPaletteVars works for Set 2 key', () => {
  applyPaletteVars('volt');
  expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#aaff00');
});

test('applyPaletteVars falls back to forest for unknown key', () => {
  applyPaletteVars('nonexistent');
  expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#22c55e');
});

// --- tapSwatch ---

describe('tapSwatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', activePaletteKey: null },
        '2': { selectedKey: 'volt',   activePaletteKey: null },
      },
    });
    document.body.innerHTML = `
      <div id="swatch-row">
        <div class="swatch selected" data-key="forest"></div>
        <div class="swatch" data-key="iris"></div>
      </div>`;
  });

  test('calls setPaletteState with updated selectedKey for active set', () => {
    tapSwatch('iris', 'uid1');
    expect(setPaletteState).toHaveBeenCalledWith(
      expect.objectContaining({
        sets: expect.objectContaining({
          '1': expect.objectContaining({ selectedKey: 'iris' }),
        }),
      })
    );
  });

  test('calls setStatusColor with userId and palette color', () => {
    tapSwatch('iris', 'uid1');
    expect(setStatusColor).toHaveBeenCalledWith('uid1', '#818cf8');
  });

  test('updates --my-status CSS var', () => {
    tapSwatch('iris', 'uid1');
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#818cf8');
  });

  test('moves .selected to tapped swatch', () => {
    tapSwatch('iris', 'uid1');
    expect(document.querySelector('[data-key="forest"]').classList.contains('selected')).toBe(false);
    expect(document.querySelector('[data-key="iris"]').classList.contains('selected')).toBe(true);
  });

  test('is synchronous — returns undefined', () => {
    expect(tapSwatch('iris', 'uid1')).toBeUndefined();
  });
});

// --- initSwatches ---

describe('initSwatches', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'iris', activePaletteKey: null },
        '2': { selectedKey: 'volt', activePaletteKey: null },
      },
    });
    document.body.innerHTML = `<div id="swatch-row"></div>`;
  });

  test('injects 8 swatches into #swatch-row', () => {
    initSwatches('uid1');
    expect(document.querySelectorAll('.swatch')).toHaveLength(8);
  });

  test('swatches are focusable <button type="button"> (a11y, #116)', () => {
    initSwatches('uid1');
    const swatches = document.querySelectorAll('#swatch-row .swatch');
    expect(swatches.length).toBe(8);
    for (const s of swatches) {
      expect(s.tagName).toBe('BUTTON');
      expect(s.getAttribute('type')).toBe('button');
    }
  });

  test('toggle button is first child of swatch-row', () => {
    initSwatches('uid1');
    const first = document.getElementById('swatch-row').firstChild;
    expect(first.tagName).toBe('BUTTON');
    expect(first.classList.contains('set-toggle-btn')).toBe(true);
  });

  test('toggle button shows bolt icon when in Set 1 (pointing to Electric)', () => {
    initSwatches('uid1');
    const btn = document.querySelector('.set-toggle-btn');
    expect(btn.innerHTML).toContain('<svg');
    expect(btn.innerHTML).toContain('Switch to Electric');
  });

  test('Set 1 swatches have correct data-keys', () => {
    initSwatches('uid1');
    const keys = Array.from(document.querySelectorAll('.swatch')).map(s => s.dataset.key);
    expect(keys).toEqual(['forest', 'ocean', 'iris', 'ember', 'coral', 'sky', 'gold', 'mint']);
  });

  test('swatch matching savedKey gets .selected', () => {
    initSwatches('uid1'); // savedKey is 'iris'
    expect(document.querySelector('[data-key="iris"]').classList.contains('selected')).toBe(true);
    expect(document.querySelector('[data-key="forest"]').classList.contains('selected')).toBe(false);
  });

  test('clicking a swatch calls setPaletteState (via tapSwatch)', () => {
    initSwatches('uid1');
    document.querySelector('[data-key="forest"]').click();
    expect(setPaletteState).toHaveBeenCalled();
  });
});

// --- switchSet ---

describe('switchSet', () => {
  let mockState;

  beforeEach(() => {
    jest.clearAllMocks();
    mockState = {
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', activePaletteKey: null },
        '2': { selectedKey: 'volt',   activePaletteKey: null },
      },
    };
    document.body.innerHTML = `<div id="swatch-row"></div>`;
  });

  test('calls setPaletteState with activeSet updated to target', () => {
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    switchSet(2, 'uid1');
    expect(setPaletteState).toHaveBeenCalledWith(
      expect.objectContaining({ activeSet: 2 })
    );
  });

  test('applies --my-status CSS var for target set selectedKey', () => {
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    switchSet(2, 'uid1');
    // volt (#aaff00) is Set 2 selectedKey
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#aaff00');
  });

  test('calls setStatusColor with target set selectedKey color', () => {
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    switchSet(2, 'uid1');
    expect(setStatusColor).toHaveBeenCalledWith('uid1', '#aaff00');
  });

  test('re-renders swatch row with Set 2 swatches after switching to Set 2', () => {
    // First call (in switchSet): returns state with activeSet 1
    // Second call (in renderSwatchRow after setPaletteState): returns state with activeSet 2
    getPaletteState
      .mockReturnValueOnce(JSON.parse(JSON.stringify(mockState)))
      .mockReturnValueOnce({ ...JSON.parse(JSON.stringify(mockState)), activeSet: 2 });

    switchSet(2, 'uid1');

    const keys = Array.from(document.querySelectorAll('.swatch')).map(s => s.dataset.key);
    expect(keys).toContain('volt');
    expect(keys).not.toContain('forest');
  });

  test('toggle button shows tree icon after switching to Set 2', () => {
    getPaletteState
      .mockReturnValueOnce(JSON.parse(JSON.stringify(mockState)))
      .mockReturnValueOnce({ ...JSON.parse(JSON.stringify(mockState)), activeSet: 2 });

    switchSet(2, 'uid1');
    const btn = document.querySelector('.set-toggle-btn');
    expect(btn.innerHTML).toContain('Switch to Natural');
  });

  test('clicking toggle button from Set 1 calls switchSet with 2', () => {
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    initSwatches('uid1');
    jest.clearAllMocks();

    // Return state with activeSet 1 for the toggle click's switchSet call
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));

    document.querySelector('.set-toggle-btn').click();
    expect(setPaletteState).toHaveBeenCalledWith(
      expect.objectContaining({ activeSet: 2 })
    );
  });
});

// --- applyThemeVars / resetThemeVars ---

describe('applyThemeVars', () => {
  const theme = { bg: '#111', surface: '#222', surface2: '#333', text: '#eee', textMuted: '#999', accent: '#f00', errorBg: '#100', errorText: '#faa' };

  test('sets all eight theme CSS vars', () => {
    applyThemeVars(theme);
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#111');
    expect(document.documentElement.style.getPropertyValue('--surface')).toBe('#222');
    expect(document.documentElement.style.getPropertyValue('--surface2')).toBe('#333');
    expect(document.documentElement.style.getPropertyValue('--text')).toBe('#eee');
    expect(document.documentElement.style.getPropertyValue('--text-muted')).toBe('#999');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#f00');
    expect(document.documentElement.style.getPropertyValue('--error-bg')).toBe('#100');
    expect(document.documentElement.style.getPropertyValue('--error-text')).toBe('#faa');
  });

  test('does not touch --my-status or --my-glow', () => {
    applyPaletteVars('iris');
    applyThemeVars(theme);
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#818cf8');
  });
});

describe('resetThemeVars', () => {
  const theme = { bg: '#111', surface: '#222', surface2: '#333', text: '#eee', textMuted: '#999', accent: '#f00', errorBg: '#100', errorText: '#faa' };

  test('restores all eight vars to slate defaults', () => {
    applyThemeVars(theme);
    resetThemeVars();
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#0f172a');
    expect(document.documentElement.style.getPropertyValue('--surface')).toBe('#1e293b');
    expect(document.documentElement.style.getPropertyValue('--surface2')).toBe('#334155');
    expect(document.documentElement.style.getPropertyValue('--text')).toBe('#f1f5f9');
    expect(document.documentElement.style.getPropertyValue('--text-muted')).toBe('#94a3b8');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#6366f1');
    expect(document.documentElement.style.getPropertyValue('--error-bg')).toBe('#7f1d1d');
    expect(document.documentElement.style.getPropertyValue('--error-text')).toBe('#fca5a5');
  });

  test('does not touch --my-status', () => {
    applyPaletteVars('ember');
    resetThemeVars();
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#f97316');
  });
});

// --- enterPaletteMode / exitPaletteMode ---

describe('enterPaletteMode', () => {
  let mockState;

  beforeEach(() => {
    jest.clearAllMocks();
    mockState = {
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'ember', activePaletteKey: null },
        '2': { selectedKey: 'volt',  activePaletteKey: null },
      },
    };
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    document.body.innerHTML = `<div id="swatch-row"></div>`;
  });

  test('sets activePaletteKey in stored state', () => {
    enterPaletteMode('ember', 'uid1');
    expect(setPaletteState).toHaveBeenCalledWith(
      expect.objectContaining({
        sets: expect.objectContaining({
          '1': expect.objectContaining({ activePaletteKey: 'ember' }),
        }),
      })
    );
  });

  test('calls applyThemeVars — sets --bg to ember theme bg', () => {
    enterPaletteMode('ember', 'uid1');
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#180a02');
  });

  test('re-renders swatch row in palette mode (Key Swatch present)', () => {
    // After setPaletteState, renderSwatchRow calls getPaletteState — return updated state
    getPaletteState
      .mockReturnValueOnce(JSON.parse(JSON.stringify(mockState)))
      .mockReturnValueOnce({
        ...JSON.parse(JSON.stringify(mockState)),
        sets: { '1': { selectedKey: 'ember', activePaletteKey: 'ember' }, '2': { selectedKey: 'volt', activePaletteKey: null } },
      });
    enterPaletteMode('ember', 'uid1');
    expect(document.querySelector('.key-swatch')).not.toBeNull();
  });

  test('palette-mode swatches (key + complements) are <button type="button"> (a11y, #116)', () => {
    getPaletteState
      .mockReturnValueOnce(JSON.parse(JSON.stringify(mockState)))
      .mockReturnValueOnce({
        ...JSON.parse(JSON.stringify(mockState)),
        sets: { '1': { selectedKey: 'ember', activePaletteKey: 'ember' }, '2': { selectedKey: 'volt', activePaletteKey: null } },
      });
    enterPaletteMode('ember', 'uid1');
    const swatches = document.querySelectorAll('#swatch-row .swatch');
    expect(swatches.length).toBeGreaterThan(0);
    for (const s of swatches) {
      expect(s.tagName).toBe('BUTTON');
      expect(s.getAttribute('type')).toBe('button');
    }
  });

  test('calls setPaletteKey with the entered key', () => {
    const { setPaletteKey } = require('../js/db.js');
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    enterPaletteMode('ember', 'uid1');
    expect(setPaletteKey).toHaveBeenCalledWith('uid1', 'ember');
  });

  test('key-spin survives a re-render within the 5s window (palette-state-synced echo)', () => {
    const paletteModeState = {
      ...JSON.parse(JSON.stringify(mockState)),
      sets: { '1': { selectedKey: 'ember', activePaletteKey: 'ember' }, '2': { selectedKey: 'volt', activePaletteKey: null } },
    };
    getPaletteState.mockReturnValue(paletteModeState);
    enterPaletteMode('ember', 'uid1');
    expect(document.querySelector('.key-swatch.key-spin')).not.toBeNull();
    // Simulate the userPrefs echo dispatching palette-state-synced, which
    // triggers another renderSwatchRow. Without the timestamp-based fix the
    // new key swatch would lack .key-spin and the animation would die ~100ms
    // after creation.
    document.dispatchEvent(new CustomEvent('palette-state-synced'));
    expect(document.querySelector('.key-swatch.key-spin')).not.toBeNull();
  });
});

describe('startSwatchHints — independent per-row wave', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="swatch-row"></div>
      <div id="group-swatch-row"></div>
    `;
    // Seed both rows with a few unselected swatches so .hint-wave has targets.
    for (const id of ['swatch-row', 'group-swatch-row']) {
      const row = document.getElementById(id);
      for (let i = 0; i < 3; i++) {
        const s = document.createElement('div');
        s.className = 'swatch';
        row.appendChild(s);
      }
    }
  });

  test('starting the group wave does NOT strip hint-wave from the Direct row', () => {
    const directRow = document.getElementById('swatch-row');
    const groupRow = document.getElementById('group-swatch-row');
    const state = JSON.parse(JSON.stringify(DEFAULT_PALETTE_STATE));
    startSwatchHints(directRow, state);
    expect(directRow.querySelectorAll('.swatch.hint-wave').length).toBeGreaterThan(0);
    // Now start group's wave — the previous design's shared _hintTimer +
    // global stopSwatchHints() would clear Direct's class here.
    startSwatchHints(groupRow, state);
    expect(directRow.querySelectorAll('.swatch.hint-wave').length).toBeGreaterThan(0);
    expect(groupRow.querySelectorAll('.swatch.hint-wave').length).toBeGreaterThan(0);
  });
});

describe('exitPaletteMode', () => {
  let mockState;

  beforeEach(() => {
    jest.clearAllMocks();
    mockState = {
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'ember', activePaletteKey: 'ember' },
        '2': { selectedKey: 'volt',  activePaletteKey: null },
      },
    };
    document.body.innerHTML = `<div id="swatch-row"></div>`;
    // Apply a theme so we can verify it's reverted
    applyThemeVars({ bg: '#180a02', surface: '#2b1505', surface2: '#3f1f08', text: '#fff1e8', textMuted: '#b06a30', accent: '#f97316', errorBg: '#280000', errorText: '#fca5a5' });
  });

  test('clears activePaletteKey in stored state', () => {
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    exitPaletteMode('uid1');
    expect(setPaletteState).toHaveBeenCalledWith(
      expect.objectContaining({
        sets: expect.objectContaining({
          '1': expect.objectContaining({ activePaletteKey: null }),
        }),
      })
    );
  });

  test('calls resetThemeVars — reverts --bg to slate default', () => {
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    exitPaletteMode('uid1');
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#0f172a');
  });

  test('preserves --my-status (does not clear status color)', () => {
    applyPaletteVars('ember');
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    exitPaletteMode('uid1');
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#f97316');
  });

  test('calls setPaletteKey with null', () => {
    const { setPaletteKey } = require('../js/db.js');
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    exitPaletteMode('uid1');
    expect(setPaletteKey).toHaveBeenCalledWith('uid1', null);
  });
});

// --- tapSwatch two-tap behavior ---

describe('tapSwatch two-tap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = `
      <div id="swatch-row">
        <div class="swatch selected" data-key="ember"></div>
      </div>`;
  });

  test('second tap on already-selected swatch (not in palette mode) calls enterPaletteMode', () => {
    getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: { '1': { selectedKey: 'ember', activePaletteKey: null }, '2': { selectedKey: 'volt', activePaletteKey: null } },
    });
    tapSwatch('ember', 'uid1');
    // enterPaletteMode should set --bg to ember theme
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#180a02');
  });

  test('tapSwatch is not called in palette mode — palette mode uses its own click handlers', () => {
    // tapSwatch is only invoked from base-mode swatch clicks.
    // In palette mode, renderSwatchRow attaches specialized handlers directly.
    // This test documents that tapSwatch ignores activePaletteKey entirely.
    getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: { '1': { selectedKey: 'forest', activePaletteKey: null }, '2': { selectedKey: 'volt', activePaletteKey: null } },
    });
    tapSwatch('coral', 'uid1');
    expect(setPaletteState).toHaveBeenCalledWith(
      expect.objectContaining({
        sets: expect.objectContaining({ '1': expect.objectContaining({ selectedKey: 'coral' }) }),
      })
    );
  });
});

// --- palette mode swatch layout ---

describe('palette mode swatch layout', () => {
  function setupPaletteMode(activePaletteKey) {
    const idx = PALETTE_SETS[1].findIndex(p => p.key === activePaletteKey);
    getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: { '1': { selectedKey: activePaletteKey, activePaletteKey }, '2': { selectedKey: 'volt', activePaletteKey: null } },
    });
    document.body.innerHTML = `<div id="swatch-row"></div>`;
    initSwatches('uid1');
    return idx;
  }

  test('K=0 (forest): Key Swatch at position 0', () => {
    setupPaletteMode('forest');
    const swatches = document.querySelectorAll('.swatch');
    expect(swatches[0].classList.contains('key-swatch')).toBe(true);
    expect(swatches[1].classList.contains('key-swatch')).toBe(false);
  });

  test('K=3 (ember): Key Swatch at position 3', () => {
    setupPaletteMode('ember');
    const swatches = document.querySelectorAll('.swatch');
    expect(swatches[3].classList.contains('key-swatch')).toBe(true);
    expect(swatches[2].classList.contains('key-swatch')).toBe(false);
    expect(swatches[4].classList.contains('key-swatch')).toBe(false);
  });

  test('K=7 (mint): Key Swatch at position 7', () => {
    setupPaletteMode('mint');
    const swatches = document.querySelectorAll('.swatch');
    expect(swatches[7].classList.contains('key-swatch')).toBe(true);
    expect(swatches[6].classList.contains('key-swatch')).toBe(false);
  });

  test('8 total swatches in palette mode', () => {
    setupPaletteMode('ember');
    expect(document.querySelectorAll('.swatch')).toHaveLength(8);
  });

  test('tapping Key Swatch calls exitPaletteMode', () => {
    setupPaletteMode('forest');
    // Re-set getPaletteState for the exitPaletteMode call
    getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: { '1': { selectedKey: 'forest', activePaletteKey: 'forest' }, '2': { selectedKey: 'volt', activePaletteKey: null } },
    });
    document.querySelector('.key-swatch').click();
    // exitPaletteMode resets theme
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#0f172a');
  });
});

// #216 — shared status-dot painter (Direct list + group roster route through it).
describe('paintStatusDot', () => {
  function dot() { const d = document.createElement('div'); d.className = 'person-dot'; return d; }

  test('available + color + palettes: sets background, border, and glow', () => {
    const d = dot();
    paintStatusDot(d, { color: '#22c55e', available: true, palettesEnabled: true });
    expect(d.classList.contains('available')).toBe(true);
    expect(d.style.background).toBeTruthy();
    expect(d.style.borderColor).toBeTruthy();
    expect(d.style.boxShadow).toContain('0 0 10px');
  });

  test('available + color, palettes OFF: background only, no border/glow', () => {
    const d = dot();
    paintStatusDot(d, { color: '#22c55e', available: true, palettesEnabled: false });
    expect(d.style.background).toBeTruthy();
    expect(d.style.borderColor).toBe('');
    expect(d.style.boxShadow).toBe('');
  });

  test('unavailable: clears all dot styling and the available class', () => {
    const d = dot();
    paintStatusDot(d, { color: '#22c55e', available: true, palettesEnabled: true });
    paintStatusDot(d, { color: '#22c55e', available: false, palettesEnabled: true });
    expect(d.classList.contains('available')).toBe(false);
    expect(d.style.background).toBe('');
    expect(d.style.boxShadow).toBe('');
  });

  test('available but no color: cleared (group members with no statusColor)', () => {
    const d = dot();
    paintStatusDot(d, { color: null, available: true, palettesEnabled: true });
    expect(d.style.background).toBe('');
  });

  test('null dot is a no-op (no throw)', () => {
    expect(() => paintStatusDot(null, { color: '#fff', available: true })).not.toThrow();
  });
});

// ── syncPaletteStateFromServer: cross-set echo guard ──
// switchSet writes statusColor and paletteKey to presence as TWO separate writes,
// so the own-status watch can briefly see a NEW set's color paired with the OLD
// set's paletteKey. syncPaletteStateFromServer must not attribute that color to
// the (stale) paletteKey's set — that clobbers the wrong set's selectedColor and
// forces activeSet, dropping the selected indicator and broadcasting the wrong
// color on go-available.
describe('syncPaletteStateFromServer cross-set echo guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '<div id="swatch-row"></div><div id="my-dot"></div>';
  });

  test('ignores a transient echo: a set-2 color arriving with a set-1 paletteKey', () => {
    const voltColor = getPaletteByKey('volt').color;   // set-2 base color
    getPaletteState.mockReturnValue({
      activeSet: 2,
      sets: {
        '1': { selectedKey: 'forest', selectedColor: getPaletteByKey('forest').color, activePaletteKey: 'forest' },
        '2': { selectedKey: 'volt',   selectedColor: voltColor, activePaletteKey: null },
      },
    });
    // statusColor switched to volt (set 2) but paletteKey is still 'forest' (set 1).
    syncPaletteStateFromServer('me', voltColor, 'forest');
    // Must NOT write — that would set set-1.selectedColor = voltColor and activeSet = 1.
    expect(setPaletteState).not.toHaveBeenCalled();
  });

  test('applies a consistent echo whose color belongs to the paletteKey palette', () => {
    const forest = getPaletteByKey('forest');
    getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', selectedColor: '#000000', activePaletteKey: 'forest' },
        '2': { selectedKey: 'volt',   selectedColor: getPaletteByKey('volt').color, activePaletteKey: null },
      },
    });
    syncPaletteStateFromServer('me', forest.color, 'forest'); // forest color IS in the forest palette
    expect(setPaletteState).toHaveBeenCalled();
  });

  test('applies a consistent echo whose color is a complement of the paletteKey palette', () => {
    const forest = getPaletteByKey('forest');
    const complement = forest.complements[0];
    getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', selectedColor: '#000000', activePaletteKey: 'forest' },
        '2': { selectedKey: 'volt',   selectedColor: getPaletteByKey('volt').color, activePaletteKey: null },
      },
    });
    syncPaletteStateFromServer('me', complement, 'forest');
    expect(setPaletteState).toHaveBeenCalled();
  });
});
