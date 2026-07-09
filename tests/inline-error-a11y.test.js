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
