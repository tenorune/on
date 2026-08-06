// Pins the two ignore lists that keep server-side source off the public site
// and the ops panel out of the functions deploy archive. The hosting gap was
// live and confirmed (curl -I .../functions/telegram-auth.js -> 200) before
// this test existed.
const config = require('../firebase.json');

describe('hosting.ignore', () => {
  test('excludes functions/** so Cloud Functions source is not served publicly', () => {
    expect(config.hosting.ignore).toContain('functions/**');
  });

  test('still excludes the pre-existing entries', () => {
    for (const entry of ['**/node_modules/**', 'tests/**', 'scripts/**', 'docs/**', 'css/**']) {
      expect(config.hosting.ignore).toContain(entry);
    }
  });
});

describe('functions.ignore', () => {
  test('excludes the ops panel from the deploy archive', () => {
    expect(config.functions.ignore).toContain('ops/**');
  });

  test('re-lists the CLI defaults, which specifying `ignore` replaces', () => {
    for (const entry of ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log']) {
      expect(config.functions.ignore).toContain(entry);
    }
  });
});

// The other half of the `ops/**` exclusion. Excluding the panel from the deploy
// archive only holds if nothing that IS deployed imports from it: a shipped
// module importing functions/ops/* would pass every test here, deploy cleanly,
// and then die at cold start on a missing module — taking whatever callable it
// backs down with it. telegram-link-write.js exists at the top level rather
// than under ops/ for exactly this reason, and it is imported by both sides.
describe('shipped functions code never imports the ops panel', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'functions');

  // Top-level functions/*.js only — that IS the deploy surface. functions/ops/
  // and functions/test/ are both excluded from the archive and may import it.
  const shipped = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => fs.statSync(path.join(dir, f)).isFile());

  // Comment lines are skipped LINE BY LINE, not stripped with a block-comment
  // regex. A `/*` inside ordinary prose — `ops/**` in a sentence about this very
  // exclusion — opens a match that runs to the next `*/` and silently eats the
  // real import statements in between. That is not hypothetical: the first
  // version of this test did exactly that and passed against a deliberately
  // planted violation.
  const isComment = (line) => {
    const t = line.trim();
    return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
  };

  test.each(shipped)('%s has no runtime import from ops/', (file) => {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    // Runtime forms only: static `import ... from`, dynamic `import(...)`, and
    // `require(...)`. A JSDoc `import('./ops/types.js')` is a TYPE reference —
    // erased before it ever runs — and lives on a comment line.
    const offenders = src.split('\n')
      .filter((line) => !isComment(line))
      .filter((line) => /\bfrom\s+['"][^'"]*\bops\//.test(line)
        || /\b(?:require|import)\s*\(\s*['"][^'"]*\bops\//.test(line));

    expect(offenders).toEqual([]);
  });
});
