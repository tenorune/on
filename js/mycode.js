// js/mycode.js
import { watchFollowers, removeFollower } from './db.js';

export function initMyCodeTab(myUserId, myCode) {
  document.getElementById('my-code-display').textContent = myCode;

  document.getElementById('copy-code-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(myCode).then(() => {
      const btn = document.getElementById('copy-code-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
    });
  });

  watchFollowers(myUserId, (followers) => {
    renderFollowers(myUserId, followers);
  });
}

function renderFollowers(myUserId, followers) {
  const list = document.getElementById('followers-list');
  const noMsg = document.getElementById('no-followers-msg');

  list.innerHTML = '';

  if (followers.length === 0) {
    noMsg.classList.remove('hidden');
    return;
  }

  noMsg.classList.add('hidden');
  followers.forEach(({ userId, code }) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="person-info">
        <div class="person-label" style="letter-spacing:2px;font-size:13px">${escapeHtml(code)}</div>
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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
