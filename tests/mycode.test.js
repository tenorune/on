// tests/mycode.test.js
// Mock db.js directly — prevents firebase from loading (same pattern as me.test.js)
// utils.js needs no mock; it's a pure function with no external dependencies
jest.mock('../js/db.js', () => ({
  watchFollowers: jest.fn(),
  removeFollower: jest.fn(),
  rotateCode: jest.fn(),
}));
jest.mock('../js/identity.js', () => ({ saveIdentity: jest.fn() }));
jest.mock('../js/store.js', () => ({ getFollowing: jest.fn() }));

const { getFollowing } = require('../js/store.js');
const { renderFollowers } = require('../js/mycode.js');

beforeEach(() => {
  document.body.innerHTML = '<ul id="followers-list"></ul><p id="no-followers-msg"></p>';
  getFollowing.mockReset();
});

test('shows custom name for a followed-back follower, and no name for an unknown follower', () => {
  getFollowing.mockReturnValue([
    { userId: 'u1', code: 'XY9K2M', label: 'Alice' },
  ]);

  renderFollowers('myUserId', [
    { userId: 'u1', code: 'XY9K2M' },
    { userId: 'u2', code: 'Q3ZP7R' },
  ]);

  const items = document.querySelectorAll('#followers-list li');
  expect(items[0].querySelector('.person-follower-name').textContent).toBe('Alice');
  expect(items[1].querySelector('.person-follower-name')).toBeNull();
});

test('does not show name when label is empty string', () => {
  getFollowing.mockReturnValue([
    { userId: 'u1', code: 'XY9K2M', label: '' },
  ]);

  renderFollowers('myUserId', [{ userId: 'u1', code: 'XY9K2M' }]);

  const li = document.querySelector('#followers-list li');
  expect(li.querySelector('.person-follower-name')).toBeNull();
});

test('escapes HTML in label to prevent XSS', () => {
  getFollowing.mockReturnValue([
    { userId: 'u1', code: 'XY9K2M', label: '<b>Alice</b>' },
  ]);

  renderFollowers('myUserId', [{ userId: 'u1', code: 'XY9K2M' }]);

  const nameEl = document.querySelector('.person-follower-name');
  expect(nameEl.textContent).toBe('<b>Alice</b>');
  expect(nameEl.innerHTML).not.toContain('<b>');
});
