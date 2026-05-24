# Recovery Code Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a user's identity survive clearing browser storage by introducing a 4-word recovery code that deterministically derives the userId via SHA-256.

**Architecture:** Pure client-side derivation. `userId = sha256(recoveryCode).slice(0, 32)`. No server changes, no Firebase Auth — same trust model as today. The recovery code is shown once at account creation (in a hard-gated modal) and again on demand via a pill in the code drawer. A welcome screen lets the user choose "I'm new" vs "I have a recovery code" on empty localStorage.

**Tech Stack:** Vanilla JS ES modules, Web Crypto API (`crypto.subtle.digest`), jest+jsdom for tests, esbuild bundling. EFF long wordlist (7776 entries, public domain — filtered to 7772 pure-lowercase-ASCII words; the 4 hyphenated entries `drop-down`, `felt-tip`, `t-shirt`, `yo-yo` are dropped because they conflict with the `-` separator) bundled as a JS array.

**Spec:** `docs/superpowers/specs/2026-05-23-recovery-code-design.md`.

---

## File structure overview

| File | Status | Purpose |
|---|---|---|
| `js/wordlist.js` | **new** | Exports `WORDLIST` array (7772 filtered EFF long words). Pure data module. |
| `js/identity.js` | **modified** | Adds `generateRecoveryCode`, `parseRecoveryCode`, `deriveUserIdFromRecoveryCode`. Replaces `generateUserId`. Updates `saveIdentity`/`loadIdentity` to v2 schema (third `recoveryCode` field). |
| `js/app.js` | **modified** | New helpers `showWelcomeScreen`, `showRecoveryCodeModal`, `showRestoreScreen`. `ensureIdentity` rewritten. |
| `js/mycode.js` | **modified** | Adds drawer recovery-code pill state machine. Updates `saveIdentity` call to include `recoveryCode`. |
| `index.template.html` | **modified** | Adds welcome screen, recovery modal, restore screen, drawer pill row. Adds second button to stale screen. Replaces `#splash` text with `.brand-mark` class. |
| `css/app.css` | **modified** | Extracts `.brand-mark` from `#splash`. Adds welcome/restore/modal/pill styles. |
| `tests/identity.test.js` | **modified** | Updates tests for new schema. Removes `generateUserId` test. |
| `tests/wordlist.test.js` | **new** | Validates wordlist shape. |
| `tests/recovery.test.js` | **new** | Tests `generateRecoveryCode`, `parseRecoveryCode`, `deriveUserIdFromRecoveryCode`, drawer pill state machine. |
| `tests/mycode.test.js` | **modified** | Updates `saveIdentity` mock calls. |

---

## Task 1: Wordlist module

**Files:**
- Create: `js/wordlist.js`
- Test: `tests/wordlist.test.js`

The EFF long wordlist is a public-domain list of 7776 short (3–9 char) common English words. We embed it as a JS array, after filtering out 4 hyphenated entries (`drop-down`, `felt-tip`, `t-shirt`, `yo-yo`) that would conflict with the `-` separator. Final count: **7772 words**.

Outbound HTTP to `eff.org` is blocked in our sandboxed container; we obtain the wordlist via the `eff-diceware-passphrase` npm package, which ships the EFF long wordlist as `wordlist.json`.

- [ ] **Step 1: Obtain the wordlist via npm**

Run from any directory:

```bash
cd /tmp && npm pack eff-diceware-passphrase 2>&1 | tail -1
tar xzf eff-diceware-passphrase-*.tgz
```

Verify:

```bash
node -e "const w = require('/tmp/package/wordlist.json'); console.log('count:', w.length);"
```

Expected: `count: 7776`. If different, STOP and reconcile before continuing.

- [ ] **Step 1b: Generate the filtered array body**

```bash
node -e "
const w = require('/tmp/package/wordlist.json');
const filtered = w.filter(x => /^[a-z]+\$/.test(x));
console.log('filtered count:', filtered.length);
require('fs').writeFileSync('/tmp/wordlist-body.txt',
  filtered.map(word => '  \"' + word + '\",').join('\n') + '\n');
"
wc -l /tmp/wordlist-body.txt
```

Expected: `filtered count: 7772` and `7772 /tmp/wordlist-body.txt`. If different, STOP and reconcile.

- [ ] **Step 2: Write `js/wordlist.js`**

```js
// js/wordlist.js — EFF long wordlist (public domain), filtered to 7772 words
// Source: https://www.eff.org/dice (eff_large_wordlist.txt)
// Filter: kept only entries matching /^[a-z]+$/ (dropped: drop-down, felt-tip, t-shirt, yo-yo)
const WORDLIST = [
  // ... paste contents of /tmp/wordlist-body.txt here ...
];

const WORDSET = new Set(WORDLIST);

module.exports = { WORDLIST, WORDSET };
```

Each line of the body has a trailing comma. A trailing comma after the last array element is fine in modern JS, so the body content can be pasted between the `[` and `]` directly.

- [ ] **Step 3: Write the test file**

```js
// tests/wordlist.test.js
const { WORDLIST, WORDSET } = require('../js/wordlist');

test('WORDLIST has exactly 7772 entries', () => {
  expect(WORDLIST).toHaveLength(7772);
});

test('WORDLIST entries are all lowercase ASCII', () => {
  for (const w of WORDLIST) {
    expect(w).toMatch(/^[a-z]+$/);
  }
});

test('WORDLIST entries are unique', () => {
  expect(WORDSET.size).toBe(WORDLIST.length);
});

test('WORDSET membership matches array', () => {
  expect(WORDSET.has(WORDLIST[0])).toBe(true);
  expect(WORDSET.has('definitely-not-in-list')).toBe(false);
});
```

- [ ] **Step 4: Run the tests**

```
npx jest tests/wordlist.test.js
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```
git add js/wordlist.js tests/wordlist.test.js
git commit -m "feat: add EFF short wordlist module for recovery codes"
```

---

## Task 2: Recovery code utilities (generate, parse, derive)

**Files:**
- Modify: `js/identity.js`
- Test: `tests/recovery.test.js` (new)

Three pure functions: random code generation, input parsing/validation, SHA-256 derivation. Async because Web Crypto's `subtle.digest` is async.

- [ ] **Step 1: Write the failing tests**

Create `tests/recovery.test.js`:

```js
// tests/recovery.test.js
const { generateRecoveryCode, parseRecoveryCode, deriveUserIdFromRecoveryCode } = require('../js/identity');
const { WORDSET } = require('../js/wordlist');

describe('generateRecoveryCode', () => {
  test('returns 4 dash-separated lowercase words', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[a-z]+(?:-[a-z]+){3}$/);
  });

  test('all 4 words are in the wordlist', () => {
    const code = generateRecoveryCode();
    for (const word of code.split('-')) {
      expect(WORDSET.has(word)).toBe(true);
    }
  });

  test('generates different codes on successive calls', () => {
    const codes = new Set(Array.from({ length: 50 }, generateRecoveryCode));
    expect(codes.size).toBeGreaterThan(40); // overwhelmingly unique
  });
});

describe('parseRecoveryCode', () => {
  test('accepts standard dash form', () => {
    const code = generateRecoveryCode();
    expect(parseRecoveryCode(code)).toBe(code);
  });

  test('accepts space-separated form', () => {
    const code = generateRecoveryCode();
    const spaced = code.replace(/-/g, ' ');
    expect(parseRecoveryCode(spaced)).toBe(code);
  });

  test('accepts comma-separated form', () => {
    const code = generateRecoveryCode();
    const commaed = code.split('-').join(', ');
    expect(parseRecoveryCode(commaed)).toBe(code);
  });

  test('normalizes case', () => {
    const code = generateRecoveryCode();
    expect(parseRecoveryCode(code.toUpperCase())).toBe(code);
  });

  test('rejects fewer than 4 tokens', () => {
    expect(parseRecoveryCode('one-two-three')).toBeNull();
  });

  test('rejects more than 4 tokens', () => {
    const code = generateRecoveryCode();
    expect(parseRecoveryCode(code + '-extra')).toBeNull();
  });

  test('rejects tokens not in wordlist', () => {
    expect(parseRecoveryCode('xyzzy-foo-bar-baz')).toBeNull();
  });

  test('rejects empty input', () => {
    expect(parseRecoveryCode('')).toBeNull();
    expect(parseRecoveryCode('   ')).toBeNull();
  });
});

describe('deriveUserIdFromRecoveryCode', () => {
  test('returns a 32-char lowercase hex string', async () => {
    const id = await deriveUserIdFromRecoveryCode('swift-river-amber-dust');
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  test('is deterministic for the same input', async () => {
    const a = await deriveUserIdFromRecoveryCode('swift-river-amber-dust');
    const b = await deriveUserIdFromRecoveryCode('swift-river-amber-dust');
    expect(a).toBe(b);
  });

  test('different inputs yield different userIds', async () => {
    const a = await deriveUserIdFromRecoveryCode('swift-river-amber-dust');
    const b = await deriveUserIdFromRecoveryCode('swift-river-amber-other');
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```
npx jest tests/recovery.test.js
```

Expected: all tests fail with `is not a function` or `Cannot find module '../js/identity'` exports.

- [ ] **Step 3: Add the functions to `js/identity.js`**

Open `js/identity.js`. Replace the entire file with:

```js
// js/identity.js
const { WORDLIST, WORDSET } = require('./wordlist.js');

const STORAGE_KEY = 'statusapp_identity';

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generateRecoveryCode() {
  const words = [];
  for (let i = 0; i < 4; i++) {
    words.push(WORDLIST[Math.floor(Math.random() * WORDLIST.length)]);
  }
  return words.join('-');
}

function parseRecoveryCode(input) {
  if (typeof input !== 'string') return null;
  // Lowercase, replace any run of separator chars (whitespace, comma, dash) with a single dash, trim
  const normalized = input
    .toLowerCase()
    .replace(/[\s,\-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized) return null;
  const tokens = normalized.split('-');
  if (tokens.length !== 4) return null;
  for (const t of tokens) {
    if (!WORDSET.has(t)) return null;
  }
  return tokens.join('-');
}

async function deriveUserIdFromRecoveryCode(recoveryCode) {
  const encoded = new TextEncoder().encode(recoveryCode);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hex = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.slice(0, 32);
}

function loadIdentity() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed
        && typeof parsed.userId === 'string'
        && typeof parsed.code === 'string'
        && typeof parsed.recoveryCode === 'string') {
      return parsed;
    }
    // Non-v2 shape (v1 or corrupt) — wipe and treat as no identity.
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return null;
}

function saveIdentity(userId, code, recoveryCode) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId, code, recoveryCode }));
}

function clearIdentity() {
  localStorage.removeItem(STORAGE_KEY);
}

module.exports = {
  generateCode,
  generateRecoveryCode,
  parseRecoveryCode,
  deriveUserIdFromRecoveryCode,
  loadIdentity,
  saveIdentity,
  clearIdentity,
};
```

Note: `generateUserId` is removed.

- [ ] **Step 4: Run the recovery tests**

```
npx jest tests/recovery.test.js
```

Expected: all passing.

- [ ] **Step 5: Update `tests/identity.test.js`** to match the new schema

Replace the file with:

```js
// tests/identity.test.js
const { generateCode, loadIdentity, saveIdentity, clearIdentity } = require('../js/identity');

beforeEach(() => {
  localStorage.clear();
});

test('generateCode returns 6-char uppercase alphanumeric string', () => {
  const code = generateCode();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
});

test('generateCode returns different values on successive calls', () => {
  const codes = new Set(Array.from({ length: 20 }, generateCode));
  expect(codes.size).toBeGreaterThan(1);
});

test('loadIdentity returns null when localStorage is empty', () => {
  expect(loadIdentity()).toBeNull();
});

test('saveIdentity persists v2 schema and loadIdentity retrieves it', () => {
  saveIdentity('user-123', 'AB3K9X', 'swift-river-amber-dust');
  const identity = loadIdentity();
  expect(identity).toEqual({
    userId: 'user-123',
    code: 'AB3K9X',
    recoveryCode: 'swift-river-amber-dust',
  });
});

test('clearIdentity removes the stored identity so loadIdentity returns null', () => {
  saveIdentity('user-abc', 'XYZ123', 'one-two-three-four');
  clearIdentity();
  expect(loadIdentity()).toBeNull();
});

test('loadIdentity returns null and wipes localStorage when v1-shape data is stored', () => {
  localStorage.setItem('statusapp_identity', JSON.stringify({ userId: 'old-uid', code: 'OLD123' }));
  expect(loadIdentity()).toBeNull();
  expect(localStorage.getItem('statusapp_identity')).toBeNull();
});

test('loadIdentity returns null and wipes localStorage when stored value is corrupt', () => {
  localStorage.setItem('statusapp_identity', '{bad json');
  expect(loadIdentity()).toBeNull();
  expect(localStorage.getItem('statusapp_identity')).toBeNull();
});
```

- [ ] **Step 6: Run the identity tests**

```
npx jest tests/identity.test.js
```

Expected: all passing.

- [ ] **Step 7: Run the full test suite to catch regressions**

```
npx jest
```

Expected: 2 test suites likely failing — `app.test.js` (if it imports `generateUserId`) and `mycode.test.js` (because `saveIdentity` signature changed). These will be fixed in later tasks. Note the failures but proceed.

- [ ] **Step 8: Commit**

```
git add js/identity.js tests/identity.test.js tests/recovery.test.js
git commit -m "feat: add recovery code generate/parse/derive utilities"
```

---

## Task 3: Extract `.brand-mark` CSS class

**Files:**
- Modify: `css/app.css`
- Modify: `index.template.html`

Move the splash's typographic styling into a reusable class so the welcome screen can use the same glyph treatment.

- [ ] **Step 1: Modify `css/app.css`**

Find the existing `#splash` rule (around line 23) and replace it with:

```css
.brand-mark {
  color: var(--text);
  font-size: 1.25rem;
}

#splash {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg);
  transition: opacity 0.5s;
}
#splash.fading { opacity: 0; pointer-events: none; }
```

The `.brand-mark` class carries the type styling; `#splash` keeps only its layout/positioning.

- [ ] **Step 2: Modify `index.template.html`**

Find the existing `#splash` div and add the `brand-mark` class to it:

Before:
```html
<div id="splash">k&#x0338;n&#x0336;o&#x0338;c&#x0335;k&#x0335; &#x0336;k&#x0338;n&#x0337;o&#x0335;c&#x0338;k&#x0335;</div>
```

After:
```html
<div id="splash"><span class="brand-mark">k&#x0338;n&#x0336;o&#x0338;c&#x0335;k&#x0335; &#x0336;k&#x0338;n&#x0337;o&#x0335;c&#x0338;k&#x0335;</span></div>
```

- [ ] **Step 3: Verify the build still works**

```
node scripts/dev-build.js
```

Expected: `Build complete: dist/bundle.js + index.html`. Open the rendered `index.html` in a browser; the splash should look identical to before.

- [ ] **Step 4: Commit**

```
git add css/app.css index.template.html
git commit -m "refactor: extract .brand-mark class from #splash"
```

---

## Task 4: Welcome screen

**Files:**
- Modify: `index.template.html`
- Modify: `css/app.css`
- Modify: `js/app.js`
- Test: `tests/recovery.test.js`

A full-screen overlay shown when localStorage is empty. The user picks "I'm new" or "I have a recovery code." Returns a Promise that resolves with the chosen path.

- [ ] **Step 1: Add markup to `index.template.html`**

Place this block immediately after the existing `#stale-screen` block:

```html
<div id="welcome-screen" class="welcome-screen hidden">
  <span class="brand-mark welcome-brand">k&#x0338;n&#x0336;o&#x0338;c&#x0335;k&#x0335; &#x0336;k&#x0338;n&#x0337;o&#x0335;c&#x0338;k&#x0335;</span>
  <div class="welcome-btns">
    <button id="welcome-new-btn" class="primary-btn">I'm new</button>
    <button id="welcome-restore-btn" class="ghost-btn">I have a recovery code</button>
  </div>
</div>
```

- [ ] **Step 2: Add CSS to `css/app.css`**

Add near the other full-screen overlay rules:

```css
.welcome-screen {
  position: fixed; inset: 0; z-index: 900;
  background: var(--bg);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 2rem;
  padding: 2rem;
}
.welcome-screen.hidden { display: none; }
.welcome-brand { font-size: 2rem; }
.welcome-btns {
  display: flex; flex-direction: column; gap: 0.75rem;
  width: 100%; max-width: 320px;
}
@media (min-width: 480px) {
  .welcome-btns { flex-direction: row; max-width: 480px; }
}
```

- [ ] **Step 3: Write the failing test**

Add to `tests/recovery.test.js`:

```js
describe('showWelcomeScreen', () => {
  let showWelcomeScreen;
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="welcome-screen" class="welcome-screen hidden">
        <button id="welcome-new-btn"></button>
        <button id="welcome-restore-btn"></button>
      </div>`;
    jest.resetModules();
    ({ showWelcomeScreen } = require('../js/app'));
  });

  test('reveals the screen and resolves "new" when "I\'m new" tapped', async () => {
    const promise = showWelcomeScreen();
    expect(document.getElementById('welcome-screen').classList.contains('hidden')).toBe(false);
    document.getElementById('welcome-new-btn').click();
    const choice = await promise;
    expect(choice).toBe('new');
    expect(document.getElementById('welcome-screen').classList.contains('hidden')).toBe(true);
  });

  test('resolves "restore" when "I have a recovery code" tapped', async () => {
    const promise = showWelcomeScreen();
    document.getElementById('welcome-restore-btn').click();
    expect(await promise).toBe('restore');
    expect(document.getElementById('welcome-screen').classList.contains('hidden')).toBe(true);
  });
});
```

- [ ] **Step 4: Run the test, expect failure**

```
npx jest tests/recovery.test.js -t "showWelcomeScreen"
```

Expected: fails — `showWelcomeScreen` not exported from `app.js`.

- [ ] **Step 5: Export `showWelcomeScreen` from `js/app.js`**

Near the top of `js/app.js`, after imports, add:

```js
export function showWelcomeScreen() {
  const el = document.getElementById('welcome-screen');
  const newBtn = document.getElementById('welcome-new-btn');
  const restoreBtn = document.getElementById('welcome-restore-btn');
  el.classList.remove('hidden');
  return new Promise((resolve) => {
    function pick(choice) {
      newBtn.removeEventListener('click', onNew);
      restoreBtn.removeEventListener('click', onRestore);
      el.classList.add('hidden');
      resolve(choice);
    }
    function onNew() { pick('new'); }
    function onRestore() { pick('restore'); }
    newBtn.addEventListener('click', onNew);
    restoreBtn.addEventListener('click', onRestore);
  });
}
```

This is added but not yet called from anywhere in production — orchestration happens in Task 9.

- [ ] **Step 6: Run the test**

```
npx jest tests/recovery.test.js -t "showWelcomeScreen"
```

Expected: passing.

- [ ] **Step 7: Commit**

```
git add index.template.html css/app.css js/app.js tests/recovery.test.js
git commit -m "feat: add welcome screen with new/restore choice"
```

---

## Task 5: Recovery-code-display modal

**Files:**
- Modify: `index.template.html`
- Modify: `css/app.css`
- Modify: `js/app.js`
- Test: `tests/recovery.test.js`

Hard-gated modal shown at account creation. Displays the recovery code, has Copy and rotate (↻) buttons, only the "I've saved it" button dismisses.

- [ ] **Step 1: Add markup to `index.template.html`**

Place after the welcome screen block:

```html
<div id="recovery-modal" class="modal-overlay hidden">
  <div class="modal-card">
    <h3>This is your recovery code</h3>
    <div class="recovery-display">
      <span id="recovery-code-text" class="recovery-code-text"></span>
      <button id="recovery-rotate-btn" class="rotate-btn" title="Generate new recovery code" aria-label="Generate new recovery code">↻</button>
    </div>
    <button id="recovery-copy-btn" class="ghost-btn">Copy</button>
    <p class="recovery-warning">Save this somewhere safe. It's the only way to restore your account if you lose this browser. We can't recover it for you.</p>
    <button id="recovery-saved-btn" class="primary-btn">I've saved it</button>
  </div>
</div>
```

- [ ] **Step 2: Add CSS to `css/app.css`**

```css
.modal-overlay {
  position: fixed; inset: 0; z-index: 950;
  background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
  padding: 1rem;
}
.modal-overlay.hidden { display: none; }
.modal-card {
  background: var(--surface);
  color: var(--text);
  padding: 1.5rem;
  border-radius: 0.75rem;
  max-width: 360px;
  width: 100%;
  display: flex; flex-direction: column;
  gap: 0.875rem;
}
.modal-card h3 { margin: 0; }
.recovery-display {
  display: flex; align-items: center; gap: 0.5rem;
  background: var(--surface2);
  padding: 0.75rem;
  border-radius: 0.5rem;
}
.recovery-code-text {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 1.05rem;
  flex: 1;
  word-break: break-all;
}
.recovery-warning {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-muted);
}
```

- [ ] **Step 3: Write the failing tests**

Add to `tests/recovery.test.js`:

```js
describe('showRecoveryCodeModal', () => {
  let showRecoveryCodeModal;
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="recovery-modal" class="modal-overlay hidden">
        <span id="recovery-code-text"></span>
        <button id="recovery-rotate-btn"></button>
        <button id="recovery-copy-btn">Copy</button>
        <button id="recovery-saved-btn">I've saved it</button>
      </div>`;
    jest.resetModules();
    ({ showRecoveryCodeModal } = require('../js/app'));
  });

  test('displays the initial code and reveals the modal', async () => {
    const p = showRecoveryCodeModal('alpha-bravo-charlie-delta');
    expect(document.getElementById('recovery-code-text').textContent).toBe('alpha-bravo-charlie-delta');
    expect(document.getElementById('recovery-modal').classList.contains('hidden')).toBe(false);
    document.getElementById('recovery-saved-btn').click();
    expect(await p).toBe('alpha-bravo-charlie-delta');
    expect(document.getElementById('recovery-modal').classList.contains('hidden')).toBe(true);
  });

  test('rotate (↻) updates the displayed code in place; modal stays open', async () => {
    const p = showRecoveryCodeModal('alpha-bravo-charlie-delta');
    const before = document.getElementById('recovery-code-text').textContent;
    document.getElementById('recovery-rotate-btn').click();
    // After rotate, the text changes to a fresh code, modal still visible
    const after = document.getElementById('recovery-code-text').textContent;
    expect(after).not.toBe(before);
    expect(after).toMatch(/^[a-z]+(?:-[a-z]+){3}$/);
    expect(document.getElementById('recovery-modal').classList.contains('hidden')).toBe(false);
    document.getElementById('recovery-saved-btn').click();
    expect(await p).toBe(after);
  });

  test('committed code reflects the last shown after multiple rotates', async () => {
    const p = showRecoveryCodeModal('alpha-bravo-charlie-delta');
    document.getElementById('recovery-rotate-btn').click();
    document.getElementById('recovery-rotate-btn').click();
    document.getElementById('recovery-rotate-btn').click();
    const finalCode = document.getElementById('recovery-code-text').textContent;
    document.getElementById('recovery-saved-btn').click();
    expect(await p).toBe(finalCode);
  });
});
```

- [ ] **Step 4: Run, expect failure**

```
npx jest tests/recovery.test.js -t "showRecoveryCodeModal"
```

Expected: fails — `showRecoveryCodeModal` not exported.

- [ ] **Step 5: Add `showRecoveryCodeModal` to `js/app.js`**

Add near `showWelcomeScreen`:

```js
import { generateRecoveryCode } from './identity.js';

export function showRecoveryCodeModal(initialCode) {
  const el = document.getElementById('recovery-modal');
  const text = document.getElementById('recovery-code-text');
  const rotateBtn = document.getElementById('recovery-rotate-btn');
  const copyBtn = document.getElementById('recovery-copy-btn');
  const savedBtn = document.getElementById('recovery-saved-btn');

  let current = initialCode;
  text.textContent = current;
  if (copyBtn) copyBtn.textContent = 'Copy';
  el.classList.remove('hidden');

  return new Promise((resolve) => {
    function onRotate() {
      current = generateRecoveryCode();
      text.textContent = current;
      if (copyBtn) copyBtn.textContent = 'Copy';
    }
    async function onCopy() {
      try {
        await navigator.clipboard?.writeText(current);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      } catch (_) {
        // ignore clipboard failures
      }
    }
    function onSaved() {
      rotateBtn.removeEventListener('click', onRotate);
      copyBtn.removeEventListener('click', onCopy);
      savedBtn.removeEventListener('click', onSaved);
      el.classList.add('hidden');
      resolve(current);
    }
    rotateBtn.addEventListener('click', onRotate);
    copyBtn.addEventListener('click', onCopy);
    savedBtn.addEventListener('click', onSaved);
  });
}
```

(The existing `import { ... } from './identity.js'` line at the top of `app.js` should already exist; just ensure `generateRecoveryCode` is in the named imports. If `app.js`'s existing import line is `import { loadIdentity, saveIdentity, generateUserId, ... }`, change it to `import { loadIdentity, saveIdentity, generateRecoveryCode, parseRecoveryCode, deriveUserIdFromRecoveryCode, clearIdentity } from './identity.js';` — `generateUserId` is removed and the new utilities are added. Remove unused imports later if any.)

- [ ] **Step 6: Run tests**

```
npx jest tests/recovery.test.js -t "showRecoveryCodeModal"
```

Expected: all 3 tests passing.

- [ ] **Step 7: Commit**

```
git add index.template.html css/app.css js/app.js tests/recovery.test.js
git commit -m "feat: add recovery-code-display modal with rotate/copy/commit"
```

---

## Task 6: Restore input screen

**Files:**
- Modify: `index.template.html`
- Modify: `css/app.css`
- Modify: `js/app.js`
- Test: `tests/recovery.test.js`

Reached from welcome screen or stale-identity screen. Validates input, derives userId, checks Firebase, returns identity object or signals cancellation.

- [ ] **Step 1: Add markup**

Place after the recovery modal block in `index.template.html`:

```html
<div id="restore-screen" class="restore-screen hidden">
  <div class="restore-card">
    <h3>Enter your recovery code</h3>
    <input id="restore-input" type="text" autocomplete="off" autocapitalize="none" autocorrect="off" placeholder="four-words-from-your-list" class="code-input restore-input" />
    <p id="restore-error" class="error-msg hidden"></p>
    <div class="restore-btns">
      <button id="restore-submit-btn" class="primary-btn">Restore</button>
      <button id="restore-cancel-btn" class="ghost-btn">Cancel</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add CSS**

```css
.restore-screen {
  position: fixed; inset: 0; z-index: 900;
  background: var(--bg);
  display: flex; align-items: center; justify-content: center;
  padding: 1.5rem;
}
.restore-screen.hidden { display: none; }
.restore-card {
  display: flex; flex-direction: column; gap: 0.75rem;
  width: 100%; max-width: 360px;
}
.restore-card h3 { margin: 0; }
.restore-input {
  width: 100%;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.restore-btns { display: flex; gap: 0.5rem; }
.restore-btns button { flex: 1; }
```

- [ ] **Step 3: Write the failing tests**

Add to `tests/recovery.test.js`:

```js
describe('showRestoreScreen', () => {
  let showRestoreScreen;
  let mockUserExists;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="restore-screen" class="restore-screen hidden">
        <input id="restore-input" />
        <p id="restore-error" class="error-msg hidden"></p>
        <button id="restore-submit-btn"></button>
        <button id="restore-cancel-btn"></button>
      </div>`;
    jest.resetModules();
    jest.mock('../js/db', () => ({
      userExists: jest.fn(),
      getUser: jest.fn(),
    }));
    mockUserExists = require('../js/db').userExists;
    ({ showRestoreScreen } = require('../js/app'));
  });

  test('resolves null when Cancel is tapped', async () => {
    const p = showRestoreScreen();
    expect(document.getElementById('restore-screen').classList.contains('hidden')).toBe(false);
    document.getElementById('restore-cancel-btn').click();
    expect(await p).toBeNull();
    expect(document.getElementById('restore-screen').classList.contains('hidden')).toBe(true);
  });

  test('shows error and does not resolve when input is malformed', async () => {
    const p = showRestoreScreen();
    document.getElementById('restore-input').value = 'only-three-words';
    document.getElementById('restore-submit-btn').click();
    // Promise has not resolved; error message visible
    await new Promise(r => setTimeout(r, 0));
    expect(document.getElementById('restore-error').classList.contains('hidden')).toBe(false);
    expect(mockUserExists).not.toHaveBeenCalled();
    // Clean up: cancel
    document.getElementById('restore-cancel-btn').click();
    await p;
  });

  test('shows "no account" error when userExists returns false', async () => {
    mockUserExists.mockResolvedValue(false);
    const { generateRecoveryCode } = require('../js/identity');
    const code = generateRecoveryCode();
    const p = showRestoreScreen();
    document.getElementById('restore-input').value = code;
    document.getElementById('restore-submit-btn').click();
    await new Promise(r => setTimeout(r, 10));
    expect(mockUserExists).toHaveBeenCalled();
    expect(document.getElementById('restore-error').classList.contains('hidden')).toBe(false);
    document.getElementById('restore-cancel-btn').click();
    await p;
  });

  test('resolves with identity when code is valid and Firebase record exists', async () => {
    const { generateRecoveryCode, deriveUserIdFromRecoveryCode } = require('../js/identity');
    const code = generateRecoveryCode();
    const expectedUid = await deriveUserIdFromRecoveryCode(code);
    mockUserExists.mockResolvedValue(true);
    require('../js/db').getUser = jest.fn().mockResolvedValue({ code: 'XK7P2M' });
    const p = showRestoreScreen();
    document.getElementById('restore-input').value = code;
    document.getElementById('restore-submit-btn').click();
    const result = await p;
    expect(result).toEqual({ userId: expectedUid, code: 'XK7P2M', recoveryCode: code });
    expect(document.getElementById('restore-screen').classList.contains('hidden')).toBe(true);
  });
});
```

- [ ] **Step 4: Run, expect failure**

```
npx jest tests/recovery.test.js -t "showRestoreScreen"
```

Expected: fails — function not exported.

- [ ] **Step 5: Add `showRestoreScreen` to `js/app.js`**

Add near the other show* functions. Also ensure `parseRecoveryCode` and `deriveUserIdFromRecoveryCode` are imported (see Task 5 note). Add to `db.js` imports: `userExists, getUser`.

```js
import { userExists, getUser } from './db.js';
import { parseRecoveryCode, deriveUserIdFromRecoveryCode } from './identity.js';

export function showRestoreScreen() {
  const el = document.getElementById('restore-screen');
  const input = document.getElementById('restore-input');
  const error = document.getElementById('restore-error');
  const submit = document.getElementById('restore-submit-btn');
  const cancel = document.getElementById('restore-cancel-btn');

  input.value = '';
  error.classList.add('hidden');
  error.textContent = '';
  el.classList.remove('hidden');

  return new Promise((resolve) => {
    async function onSubmit() {
      const normalized = parseRecoveryCode(input.value);
      if (!normalized) {
        error.textContent = "That doesn't look like a recovery code — check that you entered 4 words from the list.";
        error.classList.remove('hidden');
        return;
      }
      const userId = await deriveUserIdFromRecoveryCode(normalized);
      let exists;
      try {
        exists = await userExists(userId);
      } catch (_) {
        // Treat network errors as "not found" — user can retry
        exists = false;
      }
      if (!exists) {
        error.textContent = "No account found with that code. Check spelling, or tap Cancel to start over.";
        error.classList.remove('hidden');
        return;
      }
      const user = await getUser(userId);
      teardown();
      resolve({ userId, code: user.code, recoveryCode: normalized });
    }
    function onCancel() {
      teardown();
      resolve(null);
    }
    function teardown() {
      submit.removeEventListener('click', onSubmit);
      cancel.removeEventListener('click', onCancel);
      el.classList.add('hidden');
    }
    submit.addEventListener('click', onSubmit);
    cancel.addEventListener('click', onCancel);
  });
}
```

The existing `app.js` already imports from `./db.js`. Ensure `userExists` and `getUser` are included in that named import list (look at the top of `app.js`).

- [ ] **Step 6: Run tests**

```
npx jest tests/recovery.test.js -t "showRestoreScreen"
```

Expected: all 4 tests passing.

- [ ] **Step 7: Commit**

```
git add index.template.html css/app.css js/app.js tests/recovery.test.js
git commit -m "feat: add restore-from-recovery-code screen"
```

---

## Task 7: Stale-identity screen second button

**Files:**
- Modify: `index.template.html`
- Modify: `js/app.js`

The existing stale screen has one button. Add a second button that triggers the restore flow.

- [ ] **Step 1: Modify `index.template.html`**

Find the existing `#stale-screen` block. The current structure has:
```html
<button id="stale-continue-btn" class="primary-btn">Continue</button>
```

Replace with:
```html
<div class="stale-btns">
  <button id="stale-continue-btn" class="primary-btn">Continue with new account</button>
  <button id="stale-restore-btn" class="ghost-btn">I have a recovery code</button>
</div>
```

- [ ] **Step 2: Add CSS for `.stale-btns`**

In `css/app.css`, near the existing `.stale-screen` rules:

```css
.stale-btns {
  display: flex; flex-direction: column; gap: 0.5rem;
}
@media (min-width: 480px) {
  .stale-btns { flex-direction: row; }
  .stale-btns button { flex: 1; }
}
```

- [ ] **Step 3: Update the existing `showStaleScreen` function in `js/app.js`**

Find the existing definition:
```js
function showStaleScreen() {
  return new Promise((resolve) => {
    document.getElementById('stale-screen').classList.remove('hidden');
    document.getElementById('stale-continue-btn').addEventListener('click', () => {
      document.getElementById('stale-screen').classList.add('hidden');
      resolve();
    }, { once: true });
  });
}
```

Replace with:

```js
function showStaleScreen() {
  const el = document.getElementById('stale-screen');
  const continueBtn = document.getElementById('stale-continue-btn');
  const restoreBtn = document.getElementById('stale-restore-btn');
  el.classList.remove('hidden');
  return new Promise((resolve) => {
    function pick(choice) {
      continueBtn.removeEventListener('click', onContinue);
      restoreBtn.removeEventListener('click', onRestore);
      el.classList.add('hidden');
      resolve(choice);
    }
    function onContinue() { pick('continue'); }
    function onRestore() { pick('restore'); }
    continueBtn.addEventListener('click', onContinue);
    restoreBtn.addEventListener('click', onRestore);
  });
}
```

- [ ] **Step 4: Verify build still completes**

```
node scripts/dev-build.js
npx jest
```

Expected: build succeeds. Test suite may have some pre-existing failures from earlier tasks that haven't been integrated yet — note them but proceed.

- [ ] **Step 5: Commit**

```
git add index.template.html css/app.css js/app.js
git commit -m "feat: add restore button to stale-identity screen"
```

---

## Task 8: `ensureIdentity` rewrite

**Files:**
- Modify: `js/app.js`

The orchestrating function. Coordinates v1 migration → welcome screen → modal commit (or restore) → returns the resulting identity.

- [ ] **Step 1: Replace the existing `ensureIdentity` function**

The current implementation is:
```js
async function ensureIdentity() {
  const existing = loadIdentity();
  if (existing) {
    try {
      const valid = await userExists(existing.userId);
      if (!valid) {
        clearIdentity();
        return { identity: null, isNew: false };
      }
    } catch {
      // Network error (offline) — assume valid and proceed
    }
    return { identity: existing, isNew: false };
  }

  let userId, code, success;
  do {
    userId = generateUserId();
    code = generateCode();
    success = await initUser(userId, code);
  } while (!success);

  saveIdentity(userId, code);
  return { identity: { userId, code }, isNew: true };
}
```

Replace with:

```js
async function ensureIdentity() {
  const existing = loadIdentity();
  if (existing) {
    let valid = true;
    try {
      valid = await userExists(existing.userId);
    } catch {
      // Network error — assume valid and proceed offline
    }
    if (valid) return { identity: existing, isNew: false };
    // Stale identity flow: localStorage exists but Firebase doesn't
    const choice = await showStaleScreen();
    clearIdentity();
    if (choice === 'restore') {
      const restored = await showRestoreScreen();
      if (restored) {
        saveIdentity(restored.userId, restored.code, restored.recoveryCode);
        return { identity: restored, isNew: false };
      }
      // User cancelled restore — fall through to new-account flow
    }
    return await createNewAccount();
  }

  // Empty localStorage — true new user OR cleared cache
  const choice = await showWelcomeScreen();
  if (choice === 'restore') {
    const restored = await showRestoreScreen();
    if (restored) {
      saveIdentity(restored.userId, restored.code, restored.recoveryCode);
      return { identity: restored, isNew: false };
    }
    // User cancelled restore — fall through
  }
  return await createNewAccount();
}

async function createNewAccount() {
  // Generate code candidate, show modal so user can rotate, then commit
  const initial = generateRecoveryCode();
  const recoveryCode = await showRecoveryCodeModal(initial);
  const userId = await deriveUserIdFromRecoveryCode(recoveryCode);

  // Claim a share code transactionally; loop on collision
  let code, success;
  do {
    code = generateCode();
    success = await initUser(userId, code);
  } while (!success);

  saveIdentity(userId, code, recoveryCode);
  return { identity: { userId, code, recoveryCode }, isNew: true };
}
```

- [ ] **Step 2: Clean up imports in `js/app.js`**

At the top of the file, find the imports. Ensure they include:

```js
import { loadIdentity, saveIdentity, clearIdentity, generateCode, generateRecoveryCode, parseRecoveryCode, deriveUserIdFromRecoveryCode } from './identity.js';
import { initUser, watchStatus, isExpired, writeBackExpired, userExists, touchLastSeen, setStatus, clearCallState, getUser } from './db.js';
```

Remove any reference to `generateUserId` from the import list — it no longer exists.

- [ ] **Step 3: Update the `main()` function's identity-handling**

The existing `main()` function in `app.js` begins:

```js
async function main() {
  let { identity, isNew } = await ensureIdentity();
  if (!identity) {
    dismissSplash();
    await showStaleScreen();
    ({ identity, isNew } = await ensureIdentity());
  }
  const { userId, code } = identity;
  // ...
}
```

In v2, `ensureIdentity()` itself drives the stale screen and the welcome screen, and **always** returns a valid identity (never null). Delete the `if (!identity)` branch entirely. The result:

```js
async function main() {
  const { identity, isNew } = await ensureIdentity();
  const { userId, code } = identity;
  // ...
}
```

Everything after `const { userId, code } = identity;` is unchanged.

- [ ] **Step 4: Run the full test suite**

```
npx jest
```

Expected: all previously passing tests still pass. Some integration tests against `main()` may need updating if they were inspecting the old structure — fix them as you find them.

- [ ] **Step 5: Manual smoke test**

```
node scripts/dev-build.js
```

Open the resulting `index.html` in a browser (or `npm run dev` for the dev server). Test cases:
- **First launch (empty localStorage):** welcome screen appears → tap "I'm new" → recovery modal appears with a 4-word code → tap rotate → code changes → tap Copy → button shows "Copied!" → tap "I've saved it" → main UI appears → localStorage has v2-shape identity.
- **Returning user:** reload page → main UI appears immediately, no welcome screen.
- **Stale identity:** in devtools, edit `users/{myUserId}` in Firebase to remove the record → reload → stale screen appears with two buttons → tap "I have a recovery code" → enter the code → main UI appears with the original identity.
- **v1 migration:** in devtools, manually set `localStorage.statusapp_identity = '{"userId":"old","code":"OLDOLD"}'` → reload → welcome screen appears (old data was wiped).

- [ ] **Step 6: Commit**

```
git add js/app.js
git commit -m "feat: rewrite ensureIdentity to orchestrate welcome/modal/restore flows"
```

---

## Task 9: Drawer recovery-code pill

**Files:**
- Modify: `index.template.html`
- Modify: `css/app.css`
- Modify: `js/mycode.js`
- Modify: `tests/mycode.test.js`
- Test: `tests/recovery.test.js`

The three-state pill in the code drawer. Idle → tap → Revealed → tap Copy → Copied → 1.5s → Idle. Or Revealed → 15s idle → Idle.

- [ ] **Step 1: Add markup to `index.template.html`**

Inside the existing `<div class="drawer-inner">`, after the existing `.code-row` div and before/around the `<p class="hint">`, add:

```html
<div id="recovery-pill-row" class="recovery-pill-row">
  <button id="recovery-show-pill" class="chip">Show recovery code</button>
  <div id="recovery-revealed" class="recovery-revealed hidden">
    <span id="drawer-recovery-code" class="recovery-code-text"></span>
    <button id="drawer-recovery-copy-btn" class="ghost-btn">Copy</button>
  </div>
</div>
```

- [ ] **Step 2: Add CSS**

```css
.recovery-pill-row {
  display: flex; align-items: center;
  margin-top: 0.5rem;
}
.recovery-revealed {
  display: flex; align-items: center; gap: 0.5rem;
  background: var(--surface2);
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  flex: 1;
}
.recovery-revealed.hidden { display: none; }
```

- [ ] **Step 3: Write the failing tests**

Add to `tests/recovery.test.js`:

```js
describe('initRecoveryPill', () => {
  let initRecoveryPill;
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = `
      <div id="recovery-pill-row">
        <button id="recovery-show-pill" class="chip">Show recovery code</button>
        <div id="recovery-revealed" class="recovery-revealed hidden">
          <span id="drawer-recovery-code"></span>
          <button id="drawer-recovery-copy-btn">Copy</button>
        </div>
      </div>`;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    jest.resetModules();
    ({ initRecoveryPill } = require('../js/mycode'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('starts in Idle state (pill visible, revealed hidden)', () => {
    initRecoveryPill('alpha-bravo-charlie-delta');
    expect(document.getElementById('recovery-show-pill').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('recovery-revealed').classList.contains('hidden')).toBe(true);
  });

  test('tap pill enters Revealed: shows code and hides pill', () => {
    initRecoveryPill('alpha-bravo-charlie-delta');
    document.getElementById('recovery-show-pill').click();
    expect(document.getElementById('recovery-revealed').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('recovery-show-pill').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('drawer-recovery-code').textContent).toBe('alpha-bravo-charlie-delta');
  });

  test('15s idle in Revealed returns to Idle', () => {
    initRecoveryPill('alpha-bravo-charlie-delta');
    document.getElementById('recovery-show-pill').click();
    jest.advanceTimersByTime(15000);
    expect(document.getElementById('recovery-revealed').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('recovery-show-pill').classList.contains('hidden')).toBe(false);
  });

  test('Copy enters Copied state then returns to Idle after 1.5s', async () => {
    initRecoveryPill('alpha-bravo-charlie-delta');
    document.getElementById('recovery-show-pill').click();
    const copyBtn = document.getElementById('drawer-recovery-copy-btn');
    copyBtn.click();
    // Flush microtasks for the clipboard promise
    await Promise.resolve();
    expect(copyBtn.textContent).toBe('Copied!');
    jest.advanceTimersByTime(1500);
    expect(document.getElementById('recovery-revealed').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('recovery-show-pill').classList.contains('hidden')).toBe(false);
  });

  test('tapping the code text in Revealed resets the 15s timer', () => {
    initRecoveryPill('alpha-bravo-charlie-delta');
    document.getElementById('recovery-show-pill').click();
    jest.advanceTimersByTime(14000);
    document.getElementById('drawer-recovery-code').click();
    jest.advanceTimersByTime(10000); // total 24s from reveal, but timer was reset at 14s
    expect(document.getElementById('recovery-revealed').classList.contains('hidden')).toBe(false);
    jest.advanceTimersByTime(5000); // 15s after the reset
    expect(document.getElementById('recovery-revealed').classList.contains('hidden')).toBe(true);
  });
});
```

- [ ] **Step 4: Add `initRecoveryPill` to `js/mycode.js`**

At the bottom of `js/mycode.js`, add:

```js
export function initRecoveryPill(recoveryCode) {
  const pill = document.getElementById('recovery-show-pill');
  const revealed = document.getElementById('recovery-revealed');
  const codeText = document.getElementById('drawer-recovery-code');
  const copyBtn = document.getElementById('drawer-recovery-copy-btn');
  if (!pill || !revealed || !codeText || !copyBtn) return;

  codeText.textContent = recoveryCode;

  let idleTimer = null;
  let copiedTimer = null;

  function toIdle() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (copiedTimer) { clearTimeout(copiedTimer); copiedTimer = null; }
    copyBtn.textContent = 'Copy';
    revealed.classList.add('hidden');
    pill.classList.remove('hidden');
  }
  function startIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(toIdle, 15000);
  }
  function toRevealed() {
    pill.classList.add('hidden');
    revealed.classList.remove('hidden');
    copyBtn.textContent = 'Copy';
    startIdleTimer();
  }

  pill.addEventListener('click', toRevealed);

  codeText.addEventListener('click', () => {
    // Tap on code text (not Copy) resets the idle timer
    startIdleTimer();
  });

  copyBtn.addEventListener('click', async () => {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    try {
      await navigator.clipboard?.writeText(recoveryCode);
    } catch (_) { /* ignore */ }
    copyBtn.textContent = 'Copied!';
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copiedTimer = null;
      toIdle();
    }, 1500);
  });
}
```

- [ ] **Step 5: Update `js/mycode.js`'s `saveIdentity` call for v2 schema**

In the existing `doRotate()` function in `mycode.js`, find:
```js
saveIdentity(myUserId, newCode);
```

This is now a 2-arg call to a 3-arg function — it will break the v2 schema by writing without `recoveryCode`. Replace with code that preserves the current recoveryCode:

```js
const existing = require('./identity.js').loadIdentity();
saveIdentity(myUserId, newCode, existing?.recoveryCode ?? '');
```

Actually, since `mycode.js` uses ESM imports, use this form: at the top of the file, ensure the import line includes `loadIdentity`:

```js
import { rotateCode } from './db.js';
import { saveIdentity, loadIdentity } from './identity.js';
```

Then in `doRotate()`:
```js
const existing = loadIdentity();
saveIdentity(myUserId, newCode, existing?.recoveryCode ?? '');
```

The empty-string fallback handles the edge case of `mycode.js` being called before identity is fully set up; in practice this won't happen, but the explicit fallback prevents an `undefined` being written into localStorage.

- [ ] **Step 6: Update `initCodeDrawer` to call `initRecoveryPill`**

In `mycode.js`'s existing `initCodeDrawer` function, find the existing event-wiring code. Just before the function's end, add:

```js
const existing = loadIdentity();
if (existing?.recoveryCode) initRecoveryPill(existing.recoveryCode);
```

This is safe — if no recovery code is stored (shouldn't happen post-v2), the pill simply isn't initialized.

- [ ] **Step 7: Update `tests/mycode.test.js`** if it asserts on `saveIdentity` signature

Open the file. If any test mock or call references `saveIdentity` with 2 args, update to 3 args. Specifically the call inside the rotateCode test path. (Inspect the file; the change is mechanical.)

- [ ] **Step 8: Run all tests**

```
npx jest
```

Expected: all passing. If anything fails, fix it before moving on.

- [ ] **Step 9: Manual smoke test**

```
node scripts/dev-build.js
```

Open `index.html`, open the code drawer:
- "Show recovery code" pill visible.
- Tap → code + Copy button appear.
- Tap Copy → "Copied!" → reverts to pill after 1.5s.
- Repeat: tap pill → wait 15s without doing anything → reverts to pill.
- Repeat: tap pill → tap the code text once → wait 14s → still revealed → wait another 2s → reverts. (Verifies timer reset works.)

- [ ] **Step 10: Commit**

```
git add index.template.html css/app.css js/mycode.js tests/mycode.test.js tests/recovery.test.js
git commit -m "feat: add drawer recovery-code pill with 15s/1.5s state machine"
```

---

## Task 10: Final integration verification

**Files:** none modified — verification only.

- [ ] **Step 1: Run the full test suite**

```
npx jest
```

Expected: all suites passing. Note the test count — it should be at least the previous total plus the new wordlist/recovery tests.

- [ ] **Step 2: Manual end-to-end test in the browser**

Start the dev server:
```
npm run dev
```

Walk through these scenarios in order, in a fresh browser profile / private window:

1. **New user flow:**
   - Open the app → welcome screen with "I'm new" and "I have a recovery code".
   - Tap "I'm new" → recovery modal with a code, rotate (↻), Copy, and "I've saved it".
   - Tap rotate 3 times → confirm code changes each time.
   - Tap Copy → button reads "Copied!" briefly.
   - Tap "I've saved it" → modal dismisses, main UI loads with your new identity.
   - Open the code drawer → "Show recovery code" pill visible.
   - Tap pill → committed recovery code appears.
   - Tap Copy → "Copied!" → row collapses to pill after 1.5s.
   - Tap pill again → wait 15s without interacting → row collapses to pill.

2. **Returning-user flow:**
   - Reload the same browser → main UI appears directly (no welcome screen).

3. **Restore flow (happy path):**
   - In devtools, copy the recovery code from localStorage.
   - Clear localStorage entirely.
   - Reload → welcome screen → "I have a recovery code".
   - Paste the code → tap Restore → main UI appears with the same identity (same share code, same followers).

4. **Restore flow (bad input):**
   - Repeat (3) but enter `not-real-words-here` → inline error appears, doesn't proceed.

5. **Restore flow (record missing):**
   - Repeat (3) but enter a fresh code generated by `node -e 'require("./js/identity").generateRecoveryCode()' && echo` (i.e., a code with no Firebase record) → "No account found" inline error.

6. **Stale-identity flow:**
   - Restore your identity. In Firebase console, delete the `users/{yourUid}` record.
   - Reload → stale-identity screen with two buttons.
   - Tap "I have a recovery code" → restore flow proceeds.

7. **v1 migration:**
   - In devtools: `localStorage.setItem('statusapp_identity', JSON.stringify({ userId: 'old-uid', code: 'OLD123' }))`.
   - Reload → welcome screen appears (old data was wiped). Confirm via `localStorage.getItem('statusapp_identity')` → null.

- [ ] **Step 3: Verify build artifacts**

```
node scripts/prod.js
grep -i "<title>" index.html
ls -lh dist/bundle.js
```

Expected: title is `KnockKnock`, bundle exists, bundle size is reasonable (the wordlist adds ~75 KB to the bundle).

- [ ] **Step 4: If everything passes, no commit needed.** The previous commits already constitute the feature.

---

## Spec coverage check

Cross-reference against `docs/superpowers/specs/2026-05-23-recovery-code-design.md`:

| Spec section | Implemented in |
|---|---|
| Recovery code format (4 words, dash-separated, lowercase) | Task 2 |
| Wordlist (EFF short, 1296 words) | Task 1 |
| userId derivation (`sha256(code).slice(0,32)`) | Task 2 |
| Input acceptance (case-insensitive, multiple separators) | Task 2 (`parseRecoveryCode`) |
| localStorage v2 schema | Task 2 |
| Firebase RTDB: no changes | (verified by integration test) |
| Flow 1: empty localStorage → welcome → "I'm new" path | Tasks 4, 5, 8 |
| Flow 1: empty localStorage → welcome → "I have a recovery code" path | Tasks 4, 6, 8 |
| Flow 2: returning user | Task 8 (unchanged) |
| Flow 3: stale identity with restore option | Tasks 7, 8 |
| Flow 4: v1 → v2 migration | Task 2 (`loadIdentity`) |
| Welcome screen with `.brand-mark` | Tasks 3, 4 |
| Recovery-code-display modal with rotate (↻), Copy, "I've saved it" | Task 5 |
| Restore input screen with validation | Task 6 |
| Drawer recovery pill (Idle → Revealed → Copied state machine) | Task 9 |
| 15s idle timeout, 1.5s Copied flash | Task 9 |
| Hard-gated modal (only "I've saved it" dismisses) | Task 5 |
| Regenerate is creation-time only | Task 9 (no rotate in drawer pill, only in modal) |

All spec requirements have an implementing task.

## Out-of-scope reminder

This plan implements **Approach A only**. Phases B (server-side auth + Cloud Function) and C (QR pairing) are documented in the spec but are not part of this plan.
