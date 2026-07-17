/**
 * @jest-environment node
 */
// Regression guard for mobile-Safari double-tap zoom (defect: fast taps on the
// time pill, Share code / Levers & knobs pill, "Redeem an invite" button, and
// the notify popover zoomed the page). The viewport meta deliberately keeps
// user-scalable (pinch-zoom stays available for accessibility), so the fix is
// `touch-action: manipulation` at the body level: it removes only the
// double-tap-zoom gesture for every touch that starts inside <body> — which
// includes body-portaled overlays like .notify-popover — while leaving
// panning and pinch-zoom intact. Stricter per-element rules (pan-y on list
// rows, none on the canvas) still apply on top.
//
// jsdom has no gesture engine, so this guards the invariant at the source,
// like sticky-header-layout.test.js.
const fs = require('fs');
const path = require('path');

const appCss = fs.readFileSync(path.resolve(__dirname, '..', 'css', 'app.css'), 'utf8');
const aboutCss = fs.readFileSync(path.resolve(__dirname, '..', 'css', 'about.css'), 'utf8');

// Every css block whose selector list includes a bare `html` or `body`.
function rootDeclarations(css) {
  const blocks = [];
  const re = /(^|[}\s])((?:html|body)(?:\s*,\s*(?:html|body))*)\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) blocks.push(m[3]);
  return blocks;
}

describe('double-tap zoom is disabled app-wide via body-level touch-action', () => {
  test('app.css declares touch-action: manipulation on html/body', () => {
    const hasRule = rootDeclarations(appCss).some((d) => /touch-action:\s*manipulation/.test(d));
    expect(hasRule).toBe(true);
  });

  test('about.css declares touch-action: manipulation on html/body', () => {
    const hasRule = rootDeclarations(aboutCss).some((d) => /touch-action:\s*manipulation/.test(d));
    expect(hasRule).toBe(true);
  });

  test('viewport meta still permits pinch-zoom (no user-scalable=no / maximum-scale)', () => {
    for (const tpl of ['index.template.html', 'about.template.html']) {
      const html = fs.readFileSync(path.resolve(__dirname, '..', tpl), 'utf8');
      expect(html).not.toMatch(/user-scalable\s*=\s*no/);
      expect(html).not.toMatch(/maximum-scale/);
    }
  });
});
