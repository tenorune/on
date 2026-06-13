// tests/notifyDebug.test.js
jest.mock('../js/features.js', () => ({ NOTIFY_DEBUG: false }));
jest.mock('../js/installGuidance.js', () => ({ detectNotifyCapability: jest.fn(() => ({ state: 'supported' })) }));
jest.mock('../js/prefs.js', () => ({ getRegisteredPushToken: jest.fn(() => null) }));
jest.mock('../js/db.js', () => ({ readPushTokens: jest.fn().mockResolvedValue(null) }));

const { gatherNotifyDebugInfo, notifyDebugActive, initNotifyDebug } = require('../js/notifyDebug.js');
const prefs = require('../js/prefs.js');
const db = require('../js/db.js');
const guid = require('../js/installGuidance.js');

beforeEach(() => {
  jest.clearAllMocks();
  try { localStorage.clear(); } catch { /* no-op */ }
  window.history.replaceState({}, '', '/');
  document.body.innerHTML = '';
  global.Notification = { permission: 'granted' };
  guid.detectNotifyCapability.mockReturnValue({ state: 'supported' });
});

describe('gatherNotifyDebugInfo', () => {
  test('reports permission, capability, and the local token by tail only', async () => {
    prefs.getRegisteredPushToken.mockReturnValue('aaaaaaaaaaaaTAIL1234');
    db.readPushTokens.mockResolvedValue({ aaaaaaaaaaaaTAIL1234: {}, otherTOKEN5678: {} });
    const info = await gatherNotifyDebugInfo('me');
    expect(info.permission).toBe('granted');
    expect(info.capability).toBe('supported');
    expect(info.localToken).toMatch(/TAIL1234$/);
    expect(info.localToken).not.toContain('aaaaaaaaaaaa'); // tail only, never the full token
    expect(info.serverTokenCount).toBe(2);
    expect(info.localTokenOnServer).toBe(true);
  });

  test('flags when the local token is NOT among the server tokens (registration drift)', async () => {
    prefs.getRegisteredPushToken.mockReturnValue('localONLYtoken');
    db.readPushTokens.mockResolvedValue({ serverDIFFERENTtoken: {} });
    const info = await gatherNotifyDebugInfo('me');
    expect(info.serverTokenCount).toBe(1);
    expect(info.localTokenOnServer).toBe(false);
  });

  test('handles no local token and an empty server gracefully', async () => {
    prefs.getRegisteredPushToken.mockReturnValue(null);
    db.readPushTokens.mockResolvedValue(null);
    const info = await gatherNotifyDebugInfo('me');
    expect(info.localToken).toMatch(/none/i);
    expect(info.serverTokenCount).toBe(0);
    expect(info.localTokenOnServer).toBe(false);
  });

  test('survives a readPushTokens failure', async () => {
    db.readPushTokens.mockRejectedValue(new Error('denied'));
    const info = await gatherNotifyDebugInfo('me');
    expect(info.serverTokenCount).toBe(0);
  });
});

describe('notifyDebugActive (runtime opt-in)', () => {
  test('off by default', () => {
    expect(notifyDebugActive()).toBe(false);
  });

  test('?notifydebug=1 turns it on and persists', () => {
    window.history.replaceState({}, '', '/?notifydebug=1');
    expect(notifyDebugActive()).toBe(true);
    // Persisted: a later call without the param stays on.
    window.history.replaceState({}, '', '/');
    expect(notifyDebugActive()).toBe(true);
  });

  test('?notifydebug=0 turns it back off', () => {
    localStorage.setItem('statusapp_notify_debug', '1');
    window.history.replaceState({}, '', '/?notifydebug=0');
    expect(notifyDebugActive()).toBe(false);
  });
});

describe('initNotifyDebug', () => {
  test('renders nothing when inactive', () => {
    initNotifyDebug('me');
    expect(document.getElementById('notify-debug-panel')).toBeNull();
  });

  test('renders the panel when opted in', () => {
    window.history.replaceState({}, '', '/?notifydebug=1');
    initNotifyDebug('me');
    expect(document.getElementById('notify-debug-panel')).not.toBeNull();
  });
});
