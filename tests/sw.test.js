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
