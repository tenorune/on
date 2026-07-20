// tests/sw.test.js
const fs = require('fs');
const path = require('path');

function loadSwWithMockSelf() {
  const handlers = {};
  const showNotification = jest.fn();
  const matchAll = jest.fn().mockResolvedValue([]);
  const addAll = jest.fn();
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
    open: jest.fn().mockResolvedValue({ addAll }),
    keys: jest.fn().mockResolvedValue([]),
    match: jest.fn().mockResolvedValue(undefined),
  };
  jest.isolateModules(() => { require('../sw.template.js'); });
  return { handlers, showNotification, matchAll, mockSelf, addAll };
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

describe('shell precache completeness', () => {
  test('SHELL precaches every stylesheet the shell loads', async () => {
    // dist/css/canvas.css is loaded by index.template.html; a shell asset missing
    // from SHELL renders unstyled offline and ships no SW update when it changes.
    const { handlers, addAll } = loadSwWithMockSelf();
    const waited = [];
    handlers.install({ waitUntil: (p) => waited.push(p) });
    await Promise.all(waited);
    expect(addAll).toHaveBeenCalledWith(expect.arrayContaining(['/dist/css/canvas.css']));
  });

  test('cache-version hash covers every SHELL stylesheet', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'build.js'), 'utf8');
    expect(src).toMatch(/dist\/css\/canvas\.css/);
  });

  test('unsubstituted CHUNKS placeholder filters to empty (template loads as-is)', async () => {
    const { handlers, addAll } = loadSwWithMockSelf();
    const waited = [];
    handlers.install({ waitUntil: (p) => waited.push(p) });
    await Promise.all(waited);
    const cached = addAll.mock.calls[0][0];
    expect(cached).toEqual(expect.arrayContaining(['/dist/bundle.js']));
    expect(cached.some((u) => u.includes('__'))).toBe(false);
  });
});

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

test('a tagged notification sets renotify so a reused tag re-alerts instead of silently updating', async () => {
  const { handlers, showNotification } = loadSwWithMockSelf();
  await handlers.push(pushEvent({ type: 'call', title: 'Bea is calling', body: '', targetUid: 'bea' }));
  expect(showNotification).toHaveBeenCalledWith('Bea is calling', expect.objectContaining({
    tag: 'call:bea',
    renotify: true,
  }));
});

test('an untagged notification does NOT set renotify (renotify requires a tag)', async () => {
  const { handlers, showNotification } = loadSwWithMockSelf();
  await handlers.push(pushEvent({ title: 'Hello', body: '' })); // no type → no tag
  const opts = showNotification.mock.calls[0][1];
  expect(opts.tag).toBeUndefined();
  expect(opts.renotify).toBeFalsy();
});

test('push reads the title from FCM\'s nested data envelope', async () => {
  const { handlers, showNotification } = loadSwWithMockSelf();
  // Real FCM data messages arrive wrapped: our fields live under `data`.
  await handlers.push(pushEvent({ from: '123', data: { type: 'knock', title: 'Bea knocked', body: '', targetUid: 'bea', contextGroupId: 'fam' } }));
  expect(showNotification).toHaveBeenCalledWith('Bea knocked', expect.objectContaining({
    data: expect.objectContaining({ targetUid: 'bea', contextGroupId: 'fam' }),
  }));
});

test('push ALWAYS presents a notification, even when a client is focused (Safari revokes permission otherwise)', async () => {
  // Apple: "Safari doesn't support invisible push notifications… If you don't
  // [present one], Safari revokes the push notification permission for your
  // site." So we must show even when the app is visible — no foreground de-dupe.
  const { handlers, showNotification, matchAll } = loadSwWithMockSelf();
  matchAll.mockResolvedValue([{ focused: true, visibilityState: 'visible', postMessage: jest.fn() }]);
  await handlers.push(pushEvent({ type: 'knock', title: 'Bea knocked', body: '', targetUid: 'bea' }));
  expect(showNotification).toHaveBeenCalledWith('Bea knocked', expect.objectContaining({ tag: 'knock:bea' }));
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

describe('debug instrumentation (#156)', () => {
  test('push posts a push-debug ping to open clients reporting the push arrived + app visibility', async () => {
    const postMessage = jest.fn();
    const { handlers, showNotification, matchAll } = loadSwWithMockSelf();
    matchAll.mockResolvedValue([{ focused: true, visibilityState: 'visible', postMessage }]);
    await handlers.push(pushEvent({ type: 'knock', title: 'x', targetUid: 'bea' }));
    // A notification is still presented (Safari requires it)…
    expect(showNotification).toHaveBeenCalled();
    // …and the page is told the push arrived and whether the app was visible.
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'push-debug', type: 'knock', appVisible: true }));
  });

  test('a debug-ping message is answered with the controlling SW cache version', () => {
    const { handlers } = loadSwWithMockSelf();
    const post = jest.fn();
    handlers.message({ data: { kind: 'debug-ping' }, source: { postMessage: post } });
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ kind: 'debug-pong', cache: '__CACHE_VERSION__' }));
  });
});

describe('chunk carry-over on install (audit F9)', () => {
  const fsx = require('fs');
  // Jest's runtime caches file content by absolute path for the lifetime of
  // the worker (jest.isolateModules only sandboxes the module *registry*, not
  // that content cache), so re-writing the SAME tmp filename across calls in
  // this file makes a later require() silently replay an earlier stamp's
  // source. A per-call unique filename gives each stamp its own path.
  let stampCounter = 0;
  function loadStampedSw(chunkList, { priorMatch } = {}) {
    const handlers = {};
    const addAll = jest.fn().mockResolvedValue(undefined);
    const put = jest.fn().mockResolvedValue(undefined);
    global.self = {
      addEventListener: (type, fn) => { handlers[type] = fn; },
      skipWaiting: jest.fn(),
      clients: { claim: jest.fn(), matchAll: jest.fn().mockResolvedValue([]) },
      registration: { showNotification: jest.fn() },
      location: { origin: 'https://app.example' },
    };
    global.fetch = jest.fn().mockResolvedValue('network-response');
    global.caches = {
      open: jest.fn().mockResolvedValue({ addAll, put }),
      keys: jest.fn().mockResolvedValue([]),
      match: jest.fn((url) => Promise.resolve(priorMatch ? priorMatch(url) : undefined)),
    };
    const src = fsx.readFileSync(path.join(__dirname, '..', 'sw.template.js'), 'utf8')
      .replace(/__CACHE_VERSION__/g, 'knockknock-test')
      .replace('__CHUNK_LIST__', chunkList.join(','));
    const tmp = path.join(__dirname, `tmp-sw-stamped-${stampCounter++}.js`);
    fsx.writeFileSync(tmp, src);
    jest.isolateModules(() => { require(tmp); });
    fsx.unlinkSync(tmp);
    return { handlers, addAll, put };
  }

  test('a chunk present in a previous cache is copied, not re-fetched', async () => {
    const prior = { cached: true };
    const { handlers, addAll, put } = loadStampedSw(
      ['/dist/chunks/wordlist-abc123.js', '/dist/chunks/new-def456.js'],
      { priorMatch: (url) => (url === '/dist/chunks/wordlist-abc123.js' ? prior : undefined) },
    );
    const waited = [];
    handlers.install({ waitUntil: (p) => waited.push(p) });
    await Promise.all(waited);
    expect(put).toHaveBeenCalledWith('/dist/chunks/wordlist-abc123.js', prior);
    const fetched = addAll.mock.calls[0][0];
    expect(fetched).not.toContain('/dist/chunks/wordlist-abc123.js'); // carried over
    expect(fetched).toContain('/dist/chunks/new-def456.js');          // genuinely new
    expect(fetched).toContain('/dist/bundle.js');                     // shell always re-fetched
  });

  test('with no previous caches every chunk is fetched (fresh install)', async () => {
    const { handlers, addAll, put } = loadStampedSw(['/dist/chunks/a-1.js']);
    const waited = [];
    handlers.install({ waitUntil: (p) => waited.push(p) });
    await Promise.all(waited);
    expect(put).not.toHaveBeenCalled();
    expect(addAll.mock.calls[0][0]).toContain('/dist/chunks/a-1.js');
  });
});
