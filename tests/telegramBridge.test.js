/** @jest-environment jsdom */
const { telegramBridgeReady } = require('../js/telegramBridge.ts');

// jsdom hardcodes window.location as a non-configurable "unforgeable" property
// in this repo's jsdom/jest versions (see tests/devReset.test.js's note on the
// same constraint), so it can't be reassigned via Object.defineProperty like
// the brief's original setHash. Driving the hash setter directly is supported
// and gives telegramBridgeReady() the same `location.hash` it reads in prod.
function setHash(h) {
  window.location.hash = h;
}

describe('telegramBridgeReady', () => {
  afterEach(() => {
    delete window.Telegram;
    document.getElementById('tg-bridge')?.remove();
    jest.useRealTimers();
  });

  test('resolves immediately outside a Telegram launch (no tgWebApp hash)', async () => {
    setHash('#other=1');
    await expect(telegramBridgeReady()).resolves.toBeUndefined();
  });

  test('resolves immediately when the bridge already loaded', async () => {
    setHash('#tgWebAppData=x');
    window.Telegram = { WebApp: { initData: 'x' } };
    await expect(telegramBridgeReady()).resolves.toBeUndefined();
  });

  test('waits for the bridge script load event on a Telegram launch', async () => {
    setHash('#tgWebAppData=x');
    const el = document.createElement('script');
    el.id = 'tg-bridge';
    document.head.appendChild(el);
    let settled = false;
    const p = telegramBridgeReady().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    el.dispatchEvent(new Event('load'));
    await p;
    expect(settled).toBe(true);
  });

  test('times out rather than hanging when telegram.org never answers', async () => {
    jest.useFakeTimers();
    setHash('#tgWebAppData=x');
    const el = document.createElement('script');
    el.id = 'tg-bridge';
    document.head.appendChild(el);
    const p = telegramBridgeReady(3000);
    jest.advanceTimersByTime(3000);
    await expect(p).resolves.toBeUndefined();
  });
});
