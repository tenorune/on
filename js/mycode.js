// js/mycode.js
import { rotateCode } from './db.js';
import { saveIdentity } from './identity.js';

export function initCodeDrawer(myUserId, myCode) {
  let currentCode = myCode;

  document.getElementById('my-code-display').textContent = currentCode;

  document.getElementById('copy-code-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(currentCode).then(() => {
      const btn = document.getElementById('copy-code-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
    });
  });

  // Inject rotate confirm sheet once (guard prevents duplicate on re-init)
  if (!document.getElementById('rotate-confirm')) {
    const el = document.createElement('div');
    el.id = 'rotate-confirm';
    el.className = 'confirm-overlay hidden';
    el.innerHTML = `
      <div class="confirm-sheet">
        <h4>Generate a new code?</h4>
        <p>Your current code will no longer work for new people to find you.</p>
        <div class="confirm-btns">
          <button class="confirm-btn-cancel" id="rotate-cancel-btn">Cancel</button>
          <button class="confirm-btn-generate" id="rotate-do-btn">Generate</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el) dismissRotateConfirm(); });
    document.getElementById('rotate-cancel-btn').addEventListener('click', dismissRotateConfirm);
    document.getElementById('rotate-do-btn').addEventListener('click', doRotate);
  }

  document.getElementById('rotate-code-btn').addEventListener('click', () => {
    if (!navigator.onLine) return;
    document.getElementById('rotate-confirm').classList.remove('hidden');
  });

  async function doRotate() {
    dismissRotateConfirm();
    const rotateBtn = document.getElementById('rotate-code-btn');
    const copyBtn = document.getElementById('copy-code-btn');
    const errorEl = document.getElementById('rotate-error-msg');

    rotateBtn.classList.add('spinning');
    rotateBtn.disabled = true;
    copyBtn.disabled = true;
    errorEl.classList.add('hidden');

    try {
      const newCode = await rotateCode(myUserId, currentCode);

      const display = document.getElementById('my-code-display');
      display.classList.add('fading');
      await new Promise((r) => setTimeout(r, 200));
      display.textContent = newCode;
      display.classList.remove('fading');

      currentCode = newCode;
      saveIdentity(myUserId, newCode);
    } catch (_e) {
      errorEl.classList.remove('hidden');
    } finally {
      rotateBtn.classList.remove('spinning');
      rotateBtn.disabled = false;
      copyBtn.disabled = false;
    }
  }

  function dismissRotateConfirm() {
    document.getElementById('rotate-confirm').classList.add('hidden');
  }
}
