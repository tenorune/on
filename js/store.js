// js/store.js
const FOLLOWING_KEY = 'statusapp_following';
const TIMEOUT_KEY = 'statusapp_last_timeout';

function getFollowing() {
  const raw = localStorage.getItem(FOLLOWING_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveFollowing(list) {
  localStorage.setItem(FOLLOWING_KEY, JSON.stringify(list));
}

function addFollowing(entry) {
  const list = getFollowing();
  list.push(entry);
  saveFollowing(list);
}

function removeFollowing(userId) {
  saveFollowing(getFollowing().filter((e) => e.userId !== userId));
}

function isFollowing(userId) {
  return getFollowing().some((e) => e.userId === userId);
}

function getLastTimeout() {
  const raw = localStorage.getItem(TIMEOUT_KEY);
  return raw ? parseInt(raw, 10) : 2;
}

function setLastTimeout(n) {
  localStorage.setItem(TIMEOUT_KEY, String(n));
}

function renameFollowing(userId, newLabel) {
  const list = getFollowing().map((e) =>
    e.userId === userId ? { ...e, label: newLabel } : e
  );
  saveFollowing(list);
}

function updateFollowingCode(userId, newCode) {
  saveFollowing(getFollowing().map((e) =>
    e.userId === userId ? { ...e, code: newCode } : e
  ));
}

function getPalette() {
  return localStorage.getItem('statusapp_palette') || 'forest';
}

function setPalette(key) {
  localStorage.setItem('statusapp_palette', key);
}

module.exports = { getFollowing, addFollowing, removeFollowing, isFollowing, getLastTimeout, setLastTimeout, renameFollowing, updateFollowingCode, getPalette, setPalette };
