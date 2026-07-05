// js/mycode.js
import { rotateCode, watchUserInvites } from './db.js';
import { saveIdentity, loadIdentity } from './identity.js';
import { openInviteModal } from './inviteModal.js';
import { buildInviteUrl, createPersonalInvite } from './invites.js';
import { shareInviteLink } from './inviteFlow.js';
import { telegramFirstName } from './telegram.js';
import { flashRegenerated } from './regenFlash.js';

let _myUserId = null;
let _currentCode = null;
let _currentActiveInvite = null;

export function initCodeDrawer(myUserId, myCode) {
  _myUserId = myUserId;
  _currentCode = myCode;

  document.getElementById('my-code-display').textContent = _currentCode;

  document.getElementById('copy-code-btn').addEventListener('click', () => {
    const btn = document.getElementById('copy-code-btn');
    copyText(_currentCode).then(() => {
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
        rotateCode(_myUserId, _currentCode),
        new Promise((r) => setTimeout(r, 500)), // ensure full fade-out completes
      ]);

      // Code is invisible — swap text and update state
      display.textContent = newCode;
      _currentCode = newCode;
      const existing = loadIdentity();
      saveIdentity(_myUserId, newCode, existing?.recoveryCode ?? '');

      // Hand the fade-in + transient NEW badge to the shared regen cue (same
      // animation as the invite hash / secret phrase). flashRegenerated re-hides
      // the button via visibility for the badge window and restores it when the
      // badge fades, so restore the slot (drop the display:none) and delegate.
      display.classList.remove('fading');
      rotateBtn.style.display = '';
      flashRegenerated(display, rotateBtn);

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

  // --- Invite state tracking (feeds openPersonalInviteModal's activeInvite arg) ---
  watchUserInvites(myUserId, (collection) => {
    let active = null;
    for (const [token, inv] of Object.entries(collection || {})) {
      if (inv && inv.scope === 'personal' && !inv.revoked) {
        active = { token, ...inv, url: buildInviteUrl(token) };
        break;
      }
    }
    _currentActiveInvite = active;
  });

  document.getElementById('drawer-invite-btn')?.addEventListener('click', () => openPersonalInviteModal());

  const existing = loadIdentity();
  if (existing?.recoveryCode) initRecoveryPill(existing.recoveryCode);
}

export async function openPersonalInviteModal() {
  await openInviteModal({ scope: 'personal', userId: _myUserId, activeInvite: _currentActiveInvite });
}

// Telegram one-tap invite (spec §3/§4): share the active personal invite via the
// deep link straight to the native share sheet, auto-creating one first when the
// account has none yet. The Telegram first name is the default "name on the
// invite" (editable later in the drawer modal); 'Someone' is a defensive
// fallback since createPersonalInvite requires a non-empty label.
export async function sharePersonalInvite() {
  let invite = _currentActiveInvite;
  if (!invite) {
    const label = telegramFirstName().slice(0, 40).trim() || 'Someone';
    const result = await createPersonalInvite(_myUserId, label);
    invite = { token: result.token, url: result.url, scope: 'personal', creatorLabel: label };
    _currentActiveInvite = invite; // optimistic; watchUserInvites confirms shortly
  }
  shareInviteLink(invite);
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

// Called when watchStatus reports the user's code changed on another device.
// Updates the drawer display, the in-memory current code (used by Copy and
// rotate), and localStorage. No-op if the code matches what's already shown.
export function updateMyCode(newCode) {
  if (!newCode || newCode === _currentCode) return;
  _currentCode = newCode;
  const display = document.getElementById('my-code-display');
  if (display) display.textContent = newCode;
  const existing = loadIdentity();
  if (existing) saveIdentity(existing.userId, newCode, existing.recoveryCode);
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
