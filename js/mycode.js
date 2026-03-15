// js/mycode.js
import { watchFollowers, removeFollower } from './db.js';
import { getFollowing } from './store.js';
import { escapeHtml } from './utils.js';

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

export function renderFollowers(myUserId, followers) {
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
    const followingEntry = getFollowing().find((f) => f.userId === userId);
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

