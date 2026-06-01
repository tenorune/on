// js/groupDisplayNamePrompt.js
// Reusable "Your name in '{group}'" prompt screen. Wraps the static
// #group-displayname-screen DOM with a promise-based API. Used by:
//   - app.js boot-time link-join flow (Flow A in the groups design spec)
//   - inbox.js Inbox-Join flow (Flow C)

export function showGroupDisplayNamePrompt(groupName) {
  const screen = document.getElementById('group-displayname-screen');
  const framing = document.getElementById('group-displayname-framing');
  const input = document.getElementById('group-displayname-input');
  const errEl = document.getElementById('group-displayname-error');
  const submit = document.getElementById('group-displayname-submit-btn');

  framing.textContent = `Your name in '${groupName}'`;
  errEl.textContent = '';
  errEl.classList.add('hidden');
  input.value = '';
  screen.classList.remove('hidden');

  return new Promise((resolve, reject) => {
    function onSubmit() {
      const trimmed = (input.value || '').trim();
      if (!trimmed) { errEl.textContent = 'Please enter a name.'; errEl.classList.remove('hidden'); return; }
      if (trimmed.length > 40) { errEl.textContent = 'Name must be at most 40 characters.'; errEl.classList.remove('hidden'); return; }
      submit.removeEventListener('click', onSubmit);
      screen.classList.add('hidden');
      resolve(trimmed);
    }
    submit.addEventListener('click', onSubmit);
  });
}

export function cancelGroupDisplayNamePrompt() {
  const screen = document.getElementById('group-displayname-screen');
  if (screen) screen.classList.add('hidden');
}
