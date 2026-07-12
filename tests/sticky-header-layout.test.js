/**
 * @jest-environment node
 */
// Regression guard for the sticky top-nav / Availability header separation
// bug: on short viewports the contact list / group roster scrolled the
// #nav-row off-screen while #app-header stayed pinned, so the two visually
// separated and list rows slid under the Availability section.
//
// Root cause: `position: sticky` is constrained to its parent's box.
// #nav-row's parent is <body>; when <body> was hard-capped at `height: 100%`
// (one viewport tall), the nav could only stay stuck for a single
// viewport-height of scroll before <body>'s bottom edge shoved it off —
// while #app-header, whose parent #main-ui-direct grows with the list,
// stayed pinned. Letting <body> grow to content height (min-height, not a
// fixed height) makes the nav's containing block span the full scroll range,
// so the two sticky bars never separate. Verified behaviorally in Chromium
// (headless) across short viewports before landing.
//
// jsdom has no layout engine, so this guards the invariant at the source:
// <body> must not be re-capped to a fixed viewport height.
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.resolve(__dirname, '..', 'css', 'app.css'), 'utf8');

// Pull the property text of every `body { ... }` / `html, body { ... }` block.
function bodyDeclarations() {
  const blocks = [];
  const re = /(^|[\s,{}])((?:html\s*,\s*)?body)\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) blocks.push(m[3]);
  return blocks;
}

describe('sticky nav / header never separate (body is not viewport-capped)', () => {
  test('#nav-row and #app-header are stacked sticky bars', () => {
    // The layout this guard protects: nav sticks to the top, header sticks
    // just below it. If either stops being sticky the premise is gone.
    expect(css).toMatch(/\.nav-row\s*\{[^}]*position:\s*sticky/);
    expect(css).toMatch(/#app-header\s*\{[^}]*position:\s*sticky/);
  });

  test('no body rule hard-caps height to 100% (would detach the sticky nav)', () => {
    for (const decl of bodyDeclarations()) {
      expect(decl).not.toMatch(/(^|;)\s*height:\s*100%/);
    }
  });

  test('body still guarantees at least full-viewport height via min-height', () => {
    const hasMinHeight = bodyDeclarations().some((d) => /min-height:\s*100%/.test(d));
    expect(hasMinHeight).toBe(true);
  });
});
