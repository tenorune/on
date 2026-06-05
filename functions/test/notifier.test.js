import { jest } from '@jest/globals';
import { sendToUser, resolveName, handleKnock } from '../notifier.js';

function makeDeps(overrides = {}) {
  const store = overrides.store || {};
  return {
    store,
    getVal: jest.fn(async (path) => store[path]),
    update: jest.fn(async () => {}),
    send: jest.fn(async () => ({ failedTokens: [] })),
    now: () => 1000,
    ...overrides,
  };
}

describe('sendToUser', () => {
  test('no tokens → no send', async () => {
    const deps = makeDeps({ store: { 'userPrefs/u1/pushTokens': null } });
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, {});
    expect(deps.send).not.toHaveBeenCalled();
  });
  test('sends to all registered tokens', async () => {
    const deps = makeDeps({ store: { 'userPrefs/u1/pushTokens': { tokA: {}, tokB: {} } } });
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, { type: 'knock' });
    expect(deps.send).toHaveBeenCalledWith(['tokA', 'tokB'], { title: 'hi', body: '' }, { type: 'knock' });
  });
  test('prunes failed tokens', async () => {
    const deps = makeDeps({ store: { 'userPrefs/u1/pushTokens': { tokA: {}, tokBad: {} } } });
    deps.send = jest.fn(async () => ({ failedTokens: ['tokBad'] }));
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, {});
    expect(deps.update).toHaveBeenCalledWith('userPrefs/u1/pushTokens', { tokBad: null });
  });
});

describe('resolveName', () => {
  test('prefers the viewer\'s following label, falls back to target code, then "Someone"', async () => {
    const deps = makeDeps({ store: {
      'userPrefs/v/following/t': { label: 'Bea', code: 'x' },
    }});
    expect(await resolveName(deps, 'v', 't')).toBe('Bea');

    const deps2 = makeDeps({ store: { 'users/t/code': 'cool-code' } });
    expect(await resolveName(deps2, 'v', 't')).toBe('cool-code');

    const deps3 = makeDeps({ store: {} });
    expect(await resolveName(deps3, 'v', 't')).toBe('Someone');
  });
});

describe('handleKnock', () => {
  test('sends when recipient opted in for that sender', async () => {
    const deps = makeDeps({ store: {
      'userPrefs/rcpt/notify/sndr': { knock: true },
      'userPrefs/rcpt/following/sndr': { label: 'Bea' },
      'userPrefs/rcpt/pushTokens': { tokA: {} },
    }});
    await handleKnock(deps, 'rcpt', 'sndr', { count: 1, ts: 1, contextGroupId: 'g1' });
    expect(deps.send).toHaveBeenCalledWith(['tokA'],
      { title: 'Bea knocked', body: '' },
      { type: 'knock', targetUid: 'sndr', contextGroupId: 'g1' });
  });
  test('does nothing when not opted in', async () => {
    const deps = makeDeps({ store: { 'userPrefs/rcpt/notify/sndr': { knock: false } } });
    await handleKnock(deps, 'rcpt', 'sndr', { count: 1, ts: 1 });
    expect(deps.send).not.toHaveBeenCalled();
  });
});
