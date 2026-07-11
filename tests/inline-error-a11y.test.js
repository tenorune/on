/**
 * @jest-environment node
 *
 * #284 item 8: the confirm-modal inline error is the retry surface for the
 * Telegram unlink round-trip (showConfirmModal, js/promptModal.js). Without a
 * live region a screen reader never announces "Couldn't unlink right now. Try
 * again." — the failure is silent to non-sighted users. Assert the shipped
 * template marks it as an alert. Repo precedent: #group-removal-toast.
 */
const fs = require('fs');
const path = require('path');

const template = fs.readFileSync(
  path.resolve(__dirname, '..', 'index.template.html'), 'utf8');

const openingTag = (id) => {
  const m = template.match(new RegExp(`<[a-z]+\\s+id="${id}"[^>]*>`, 'i'));
  if (!m) throw new Error(`no element with id="${id}" in index.template.html`);
  return m[0];
};

test('confirm-modal inline error is an announced live region (role="alert")', () => {
  expect(openingTag('confirm-modal-error')).toMatch(/role="alert"/);
});

// The confirmation toast and the notify/install/onramp promos share one fixed
// bottom-center slot; they must live inside #bottom-stack (which owns the
// positioning) so they don't collide (e.g. the invite-accept toast over the
// Telegram onramp promo). Only one shows at a time.
test('bottom-anchored toast + promos are all inside #bottom-stack', () => {
  const { JSDOM } = require('jsdom');
  const doc = new JSDOM(template).window.document;
  const stack = doc.getElementById('bottom-stack');
  expect(stack).not.toBeNull();
  for (const id of ['group-removal-toast', 'notify-promo', 'tg-onramp-promo', 'install-toast']) {
    const el = doc.getElementById(id);
    expect(el).not.toBeNull();
    expect(stack.contains(el)).toBe(true);
  }
});

// Toast precedence: while the confirmation toast is visible the promos are
// suppressed, so the two never show together.
test('CSS suppresses the promos while the confirmation toast is visible', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '..', 'css', 'app.css'), 'utf8');
  expect(css).toMatch(/\.bottom-stack:has\(#group-removal-toast:not\(\.hidden\)\)\s+\.notify-promo\s*\{\s*display:\s*none/);
});

// The redeem field takes a code OR an invite link, so it's a normal text input —
// NOT the centered, letter-spaced, all-caps .code-input style (all-caps is
// misleading for a case-sensitive link).
test('redeem Code/invite-link field is a normal text input (not all-caps .code-input)', () => {
  const tag = openingTag('add-code-input');
  expect(tag).toMatch(/class="[^"]*\btext-input\b[^"]*"/);
  expect(tag).not.toMatch(/class="[^"]*\bcode-input\b/); // scoped to the class attr (id contains "code-input")
});
