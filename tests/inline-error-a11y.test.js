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
// bottom-center slot; they must live inside #bottom-stack so a visible toast and
// a visible promo STACK instead of overlapping (e.g. the invite-accept toast
// over the Telegram onramp promo). If any drifts back out, they collide again.
test('bottom-anchored toast + promos are all inside #bottom-stack (no overlap)', () => {
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
