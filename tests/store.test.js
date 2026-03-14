// tests/store.test.js
const {
  getFollowing, addFollowing, removeFollowing, isFollowing,
  getLastTimeout, setLastTimeout,
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
