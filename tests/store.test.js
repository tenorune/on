// tests/store.test.js
const {
  getFollowing, addFollowing, removeFollowing, isFollowing,
  getLastTimeout, setLastTimeout, renameFollowing, updateFollowingCode,
} = require('../js/store');

beforeEach(() => {
  localStorage.clear();
});

test('getFollowing returns empty array when nothing stored', () => {
  expect(getFollowing()).toEqual([]);
});

test('addFollowing persists an entry', () => {
  addFollowing({ code: 'AB3K9X', label: 'Partner', userId: 'user-1' });
  expect(getFollowing()).toEqual([{ code: 'AB3K9X', label: 'Partner', userId: 'user-1' }]);
});

test('addFollowing accumulates multiple entries', () => {
  addFollowing({ code: 'AB3K9X', label: 'Partner', userId: 'user-1' });
  addFollowing({ code: 'ZZ91TL', label: 'Mom', userId: 'user-2' });
  expect(getFollowing()).toHaveLength(2);
});

test('removeFollowing removes entry by userId', () => {
  addFollowing({ code: 'AB3K9X', label: 'Partner', userId: 'user-1' });
  addFollowing({ code: 'ZZ91TL', label: 'Mom', userId: 'user-2' });
  removeFollowing('user-1');
  const list = getFollowing();
  expect(list).toHaveLength(1);
  expect(list[0].userId).toBe('user-2');
});

test('removeFollowing is a no-op for unknown userId', () => {
  addFollowing({ code: 'AB3K9X', label: 'Partner', userId: 'user-1' });
  removeFollowing('unknown');
  expect(getFollowing()).toHaveLength(1);
});

test('isFollowing returns true when userId present', () => {
  addFollowing({ code: 'AB3K9X', label: 'Partner', userId: 'user-1' });
  expect(isFollowing('user-1')).toBe(true);
});

test('isFollowing returns false when userId absent', () => {
  expect(isFollowing('user-1')).toBe(false);
});

test('getLastTimeout returns 2 by default', () => {
  expect(getLastTimeout()).toBe(2);
});

test('setLastTimeout persists and getLastTimeout retrieves it', () => {
  setLastTimeout(7);
  expect(getLastTimeout()).toBe(7);
});

test('renameFollowing updates label for matching userId, other fields unchanged', () => {
  addFollowing({ code: 'AB3K9X', label: 'Partner', userId: 'user-1' });
  renameFollowing('user-1', 'Alice');
  const list = getFollowing();
  expect(list[0]).toEqual({ code: 'AB3K9X', label: 'Alice', userId: 'user-1' });
});

test('renameFollowing leaves other entries unchanged', () => {
  addFollowing({ code: 'AB3K9X', label: 'Partner', userId: 'user-1' });
  addFollowing({ code: 'ZZ91TL', label: 'Mom', userId: 'user-2' });
  renameFollowing('user-1', 'Alice');
  const list = getFollowing();
  expect(list[1]).toEqual({ code: 'ZZ91TL', label: 'Mom', userId: 'user-2' });
});

test('renameFollowing does nothing if userId not found', () => {
  addFollowing({ code: 'AB3K9X', label: 'Partner', userId: 'user-1' });
  renameFollowing('unknown', 'Alice');
  expect(getFollowing()).toEqual([{ code: 'AB3K9X', label: 'Partner', userId: 'user-1' }]);
});

test('updateFollowingCode updates code for matching userId, leaves other fields unchanged', () => {
  addFollowing({ code: 'OLD123', label: 'Alice', userId: 'user-1' });
  updateFollowingCode('user-1', 'NEW456');
  const list = getFollowing();
  expect(list[0]).toEqual({ code: 'NEW456', label: 'Alice', userId: 'user-1' });
});

test('updateFollowingCode does not modify non-matching entries', () => {
  addFollowing({ code: 'OLD123', label: 'Alice', userId: 'user-1' });
  addFollowing({ code: 'ZZ91TL', label: 'Bob', userId: 'user-2' });
  updateFollowingCode('user-1', 'NEW456');
  const list = getFollowing();
  expect(list[1]).toEqual({ code: 'ZZ91TL', label: 'Bob', userId: 'user-2' });
});
