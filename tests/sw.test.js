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
    location: { origin: 'https://app.example' },
  };
  global.self = mockSelf;
  global.fetch = jest.fn().mockResolvedValue('network-response');
  global.caches = {
    open: jest.fn().mockResolvedValue({ addAll: jest.fn() }),
    keys: jest.fn().mockResolvedValue([]),
    match: jest.fn().mockResolvedValue(undefined),
  };
  jest.isolateModules(() => { require('../sw.template.js'); });
  return { handlers, showNotification, matchAll, mockSelf };
}

function fetchEvent(url, method = 'GET') {
  return { request: { url, method }, respondWith: jest.fn() };
}

function pushEvent(data) {
  return { data: { json: () => data }, waitUntil: (p) => p };
}

function clickEvent(data) {
  return { notification: { close: jest.fn(), data }, waitUntil: (p) => p };
}

describe('fetch handler — only the same-origin shell is intercepted', () => {
  test('a cross-origin GET (apis.google.com / gapi) passes through — respondWith NOT called', () => {
    // The SW must not take over cross-origin requests: re-fetching them rejects
    // respondWith on Safari ("FetchEvent.respondWith received an error: Load
    // failed"), breaking Firebase Auth/FCM's apis.google.com/js/api.js load.
    const { handlers } = loadSwWithMockSelf();
    const e = fetchEvent('https://apis.google.com/js/api.js?onload=__iframe123');
    handlers.fetch(e);
    expect(e.respondWith).not.toHaveBeenCalled();
  });

  test('other cross-origin GETs (firebaseio, googleapis, gstatic) also pass through', () => {
    const { handlers } = loadSwWithMockSelf();
    for (const url of [
      'https://my-db.firebaseio.com/x.json',
      'https://fcmregistrations.googleapis.com/v1/x',
      'https://www.gstatic.com/firebasejs/x.js',
    ]) {
      const e = fetchEvent(url);
      handlers.fetch(e);
      expect(e.respondWith).not.toHaveBeenCalled();
    }
  });

  test('a same-origin GET (shell asset) is intercepted (cache-first)', () => {
    const { handlers } = loadSwWithMockSelf();
    const e = fetchEvent('https://app.example/dist/bundle.js');
    handlers.fetch(e);
    expect(e.respondWith).toHaveBeenCalled();
  });

  test('a non-GET request is never intercepted', () => {
    const { handlers } = loadSwWithMockSelf();
    const e = fetchEvent('https://app.example/index.html', 'POST');
    handlers.fetch(e);
    expect(e.respondWith).not.toHaveBeenCalled();
  });
});

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
