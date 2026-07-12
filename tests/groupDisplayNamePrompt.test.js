// tests/groupDisplayNamePrompt.test.js — C#8 (issue #285): the Mini-App group
// display-name prompt prefills a default (the Telegram first name) so it agrees
// with the bot's silent auto-fill, instead of always opening blank. On web the
// caller passes no default, so the prompt still opens empty.
const { showGroupDisplayNamePrompt } = require('../js/groupDisplayNamePrompt.js');

function mountDom() {
  document.body.innerHTML = `
    <div id="group-displayname-screen" class="hidden">
      <p id="group-displayname-framing"></p>
      <input id="group-displayname-input" />
      <p id="group-displayname-error" class="hidden"></p>
      <button id="group-displayname-submit-btn"></button>
    </div>`;
}
beforeEach(mountDom);

test('prefills the input with the provided default name', () => {
  showGroupDisplayNamePrompt('Divers', 'Ada');
  expect(document.getElementById('group-displayname-input').value).toBe('Ada');
});

test('opens blank when no default is provided (web path unchanged)', () => {
  showGroupDisplayNamePrompt('Divers');
  expect(document.getElementById('group-displayname-input').value).toBe('');
});
