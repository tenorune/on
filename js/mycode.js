// js/mycode.js
import { rotateCode } from './db.js';
import { saveIdentity, loadIdentity } from './identity.js';

export function initCodeDrawer(myUserId, myCode) {
  let currentCode = myCode;

  document.getElementById('my-code-display').textContent = currentCode;

  document.getElementById('copy-code-btn').addEventListener('click', () => {
    const btn = document.getElementById('copy-code-btn');
    copyText(currentCode).then(() => {
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
    const display = document.getElementById('my-code-display');

    rotateBtn.style.display = 'none';
    rotateBtn.disabled = true;
    copyBtn.disabled = true;
    errorEl.classList.add('hidden');

    // Start fading out the old code immediately, in parallel with the network call
    display.classList.add('fading');

    try {
      const [newCode] = await Promise.all([
        rotateCode(myUserId, currentCode),
        new Promise((r) => setTimeout(r, 500)), // ensure full fade-out completes
      ]);

      // Code is invisible — swap text and update state
      display.textContent = newCode;
      currentCode = newCode;
      const existing = loadIdentity();
      saveIdentity(myUserId, newCode, existing?.recoveryCode ?? '');

      // Create NEW badge (starts invisible via CSS opacity:0)
      const badge = document.createElement('span');
      badge.className = 'new-badge';
      badge.textContent = 'NEW';
      display.insertAdjacentElement('afterend', badge);

      // Fade in code + badge simultaneously
      display.classList.remove('fading');
      requestAnimationFrame(() => { badge.style.opacity = '1'; });

      // Fade out and remove the NEW badge, then restore rotate button
      await new Promise((r) => setTimeout(r, 900));
      badge.style.opacity = '0';
      await new Promise((r) => setTimeout(r, 500));
      badge.remove();
      rotateBtn.style.display = '';

    } catch (_e) {
      display.classList.remove('fading');
      errorEl.classList.remove('hidden');
      rotateBtn.style.display = '';
    } finally {
      rotateBtn.disabled = false;
      copyBtn.disabled = false;
    }
  }

  function dismissRotateConfirm() {
    document.getElementById('rotate-confirm').classList.add('hidden');
  }

  const existing = loadIdentity();
  if (existing?.recoveryCode) initRecoveryPill(existing.recoveryCode);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (_) {
      // fall through to execCommand fallback
    }
  }
  // Fallback for iOS Safari and older browsers
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

export function initRecoveryPill(recoveryCode) {
  const pill = document.getElementById('recovery-show-pill');
  const revealed = document.getElementById('recovery-revealed');
  const codeText = document.getElementById('drawer-recovery-code');
  const copyBtn = document.getElementById('drawer-recovery-copy-btn');
  if (!pill || !revealed || !codeText || !copyBtn) return;

  codeText.textContent = recoveryCode;

  let idleTimer = null;
  let copiedTimer = null;

  function toIdle() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (copiedTimer) { clearTimeout(copiedTimer); copiedTimer = null; }
    copyBtn.textContent = 'Copy';
    revealed.classList.add('hidden');
    pill.classList.remove('hidden');
  }
  function startIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(toIdle, 15000);
  }
  function toRevealed() {
    pill.classList.add('hidden');
    revealed.classList.remove('hidden');
    copyBtn.textContent = 'Copy';
    startIdleTimer();
  }

  pill.addEventListener('click', toRevealed);

  codeText.addEventListener('click', () => {
    // Tap on code text (not Copy) resets the idle timer
    startIdleTimer();
  });

  copyBtn.addEventListener('click', async () => {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    try {
      await navigator.clipboard?.writeText(recoveryCode);
    } catch (_) { /* ignore */ }
    copyBtn.textContent = 'Copied!';
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copiedTimer = null;
      toIdle();
    }, 1500);
  });
}
