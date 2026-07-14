// js/groupDisplayNamePrompt.ts
// Reusable "What name would you like to use in '{group}'?" prompt screen. Wraps
// the static #group-displayname-screen DOM with a promise-based API. Used by:
//   - app.js boot-time link-join flow (Flow A in the groups design spec)
//   - inbox.js Inbox-Join flow (Flow C)

// `defaultValue` prefills the input — passed as telegramFirstName() in Telegram
// context (C#8) so the Mini-App prompt agrees with the bot's silent auto-fill;
// '' on web, so that path opens blank as before.
export function showGroupDisplayNamePrompt(groupName: string, defaultValue = '') {
  const screen = document.getElementById('group-displayname-screen')!;
  const framing = document.getElementById('group-displayname-framing')!;
  const input = document.getElementById('group-displayname-input') as HTMLInputElement;
  const errEl = document.getElementById('group-displayname-error')!;
  const submit = document.getElementById('group-displayname-submit-btn')!;

  framing.textContent = `What name would you like to use in '${groupName}'?`;
  errEl.textContent = '';
  errEl.classList.add('hidden');
  input.value = defaultValue || '';
  screen.classList.remove('hidden');

  return new Promise<string>((resolve, reject) => {
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
