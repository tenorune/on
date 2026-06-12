// tests/sw.test.js
function loadSwWithMockSelf() {
  const handlers = {};
  const showNotification = jest.fn();
  const matchAll = jest.fn().mockResolvedValue([]);
  const mockSelf = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: jest.fn(),
    clients: { claim: jest.fn(), matchAll, openWindow: jest.fn() },
    registration: { showNotification },
  };
  global.self = mockSelf;
  global.caches = { open: jest.fn().mockResolvedValue({ addAll: jest.fn() }), keys: jest.fn().mockResolvedValue([]) };
  jest.isolateModules(() => { require('../sw.template.js'); });
  return { handlers, showNotification, matchAll, mockSelf };
}

function pushEvent(data) {
  return { data: { json: () => data }, waitUntil: (p) => p };
}

function clickEvent(data) {
  return { notification: { close: jest.fn(), data }, waitUntil: (p) => p };
}

test('push with no focused client shows a notification', async () => {
  const { handlers, showNotification } = loadSwWithMockSelf();
  await handlers.push(pushEvent({ type: 'knock', title: 'Bea knocked', body: '', targetUid: 'bea' }));
  expect(showNotification).toHaveBeenCalledWith('Bea knocked', expect.objectContaining({ data: expect.objectContaining({ targetUid: 'bea' }) }));
});

test('push reads the title from FCM\'s nested data envelope', async () => {
  const { handlers, showNotification } = loadSwWithMockSelf();
  // Real FCM data messages arrive wrapped: our fields live under `data`.
  await handlers.push(pushEvent({ from: '123', data: { type: 'knock', title: 'Bea knocked', body: '', targetUid: 'bea', contextGroupId: 'fam' } }));
  expect(showNotification).toHaveBeenCalledWith('Bea knocked', expect.objectContaining({
    data: expect.objectContaining({ targetUid: 'bea', contextGroupId: 'fam' }),
  }));
});

test('push is suppressed when a focused client exists (foreground de-dupe)', async () => {
  const { handlers, showNotification, matchAll } = loadSwWithMockSelf();
  matchAll.mockResolvedValue([{ focused: true, visibilityState: 'visible' }]);
  await handlers.push(pushEvent({ type: 'knock', title: 'Bea knocked', body: '', targetUid: 'bea' }));
  expect(showNotification).not.toHaveBeenCalled();
});

describe('notificationclick cold-start routing (no live client → openWindow)', () => {
  test('invite opens the Inbox deep-link', async () => {
    const { handlers, mockSelf } = loadSwWithMockSelf();
    await handlers.notificationclick(clickEvent({ type: 'invite', targetUid: 'bea' }));
    expect(mockSelf.clients.openWindow).toHaveBeenCalledWith('/?inbox=1');
  });

  test('followRequest opens the Inbox deep-link', async () => {
    const { handlers, mockSelf } = loadSwWithMockSelf();
    await handlers.notificationclick(clickEvent({ type: 'followRequest', targetUid: 'bea' }));
    expect(mockSelf.clients.openWindow).toHaveBeenCalledWith('/?inbox=1');
  });

  test('group knock opens the group deep-link', async () => {
    const { handlers, mockSelf } = loadSwWithMockSelf();
    await handlers.notificationclick(clickEvent({ type: 'knock', targetUid: 'bea', contextGroupId: 'ABCD1234' }));
    expect(mockSelf.clients.openWindow).toHaveBeenCalledWith('/?group=ABCD1234');
  });

  test('a malformed contextGroupId is not used in the group deep-link (#164 R3c)', async () => {
    const { handlers, mockSelf } = loadSwWithMockSelf();
    // forged group knock → invalid id ignored; knock type falls back to Direct
    await handlers.notificationclick(clickEvent({ type: 'knock', targetUid: 'bea', contextGroupId: "x';alert(1)//" }));
    expect(mockSelf.clients.openWindow).toHaveBeenCalledWith('/?direct=1');
  });

  test('Direct knock / call / availability open the Direct deep-link', async () => {
    for (const type of ['knock', 'call', 'availability']) {
      const { handlers, mockSelf } = loadSwWithMockSelf();
      await handlers.notificationclick(clickEvent({ type, targetUid: 'bea' }));
      expect(mockSelf.clients.openWindow).toHaveBeenCalledWith('/?direct=1');
    }
  });

  test('an unknown/typeless notification opens the root', async () => {
    const { handlers, mockSelf } = loadSwWithMockSelf();
    await handlers.notificationclick(clickEvent({ targetUid: 'bea' }));
    expect(mockSelf.clients.openWindow).toHaveBeenCalledWith('/');
  });
});

test('notificationclick warm path posts to a live client and focuses it (no window opened)', async () => {
  const { handlers, mockSelf, matchAll } = loadSwWithMockSelf();
  const focus = jest.fn();
  const postMessage = jest.fn();
  matchAll.mockResolvedValue([{ focus, postMessage }]);
  await handlers.notificationclick(clickEvent({ type: 'invite', targetUid: 'bea' }));
  expect(postMessage).toHaveBeenCalledWith({ kind: 'notification-click', data: { type: 'invite', targetUid: 'bea' } });
  expect(focus).toHaveBeenCalled();
  expect(mockSelf.clients.openWindow).not.toHaveBeenCalled();
});
