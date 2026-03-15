// js/mycode.js
import { watchFollowers, removeFollower, rotateCode } from './db.js';
import { getFollowing } from './store.js';
import { saveIdentity } from './identity.js';
import { escapeHtml } from './utils.js';

export function initMyCodeTab(myUserId, myCode) {
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

      // Fade out, swap text, fade in
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

  watchFollowers(myUserId, (followers) => {
    renderFollowers(myUserId, followers);
  });
}

export function renderFollowers(myUserId, followers) {
  const list = document.getElementById('followers-list');
  const noMsg = document.getElementById('no-followers-msg');

  list.innerHTML = '';

  if (followers.length === 0) {
    noMsg.classList.remove('hidden');
    return;
  }

  noMsg.classList.add('hidden');
  const following = getFollowing();
  followers.forEach(({ userId, code }) => {
    const li = document.createElement('li');
    const followingEntry = following.find((f) => f.userId === userId);
    const nameHtml = (followingEntry && followingEntry.label)
      ? `<div class="person-follower-name">${escapeHtml(followingEntry.label)}</div>`
      : '';
    li.innerHTML = `
      <div class="person-info">
        <div class="person-label" style="letter-spacing:2px;font-size:13px">${escapeHtml(code)}</div>
        ${nameHtml}
      </div>
      <button class="remove-btn" data-follower-id="${escapeHtml(userId)}">Remove</button>`;
    li.querySelector('.remove-btn').addEventListener('click', async (e) => {
      const followerId = e.target.dataset.followerId;
      await removeFollower(myUserId, followerId);
      // List updates automatically via watchFollowers listener
    });
    list.appendChild(li);
  });
}

