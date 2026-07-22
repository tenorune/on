// js/notifyDebug.ts
// Flag-gated push-notification debug readout (#156). Lets us tell apart the
// failure modes of "permission granted but no notifications": did a token
// register (local + server), and does a push even reach the service worker?
//
// Active when NOTIFY_DEBUG is true at build, OR ?notifydebug=1 opts in at
// runtime (persisted to localStorage so it survives reloads; ?notifydebug=0
// turns it off). Off by default — it ships dormant so a deployed device can be
// inspected without a rebuild.
import { NOTIFY_DEBUG } from './features.js';
import { detectNotifyCapability } from './installGuidance.js';
import { getRegisteredPushToken } from './prefs.js';
import { readPushTokens } from './db.js';

const OPT_IN_KEY = 'statusapp_notify_debug';
const tail = (t: unknown) => (t ? `…${String(t).slice(-8)}` : '(none)');

export function notifyDebugActive() {
  if (NOTIFY_DEBUG) return true;
  try {
    const param = new URLSearchParams(location.search).get('notifydebug');
    if (param === '1') localStorage.setItem(OPT_IN_KEY, '1');
    else if (param === '0') localStorage.removeItem(OPT_IN_KEY);
    return localStorage.getItem(OPT_IN_KEY) === '1';
  } catch { return false; }
}

// Snapshot of the local push/notification state (token tails only — never the
// full token). Async because the server token list is an RTDB read.
export async function gatherNotifyDebugInfo(userId: string) {
  const permission = (typeof Notification !== 'undefined' && Notification.permission) || 'unknown';
  const capability = detectNotifyCapability().state;
  const local = getRegisteredPushToken();
  let server: Awaited<ReturnType<typeof readPushTokens>> = null;
  try { server = await readPushTokens(userId); } catch { server = null; }
  const serverTokens = server ? Object.keys(server) : [];
  const controller = (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller) || null;
  // SW auto-update diagnostics: the registration's lifecycle state
  // distinguishes "never registered / registration lost" from "registered but
  // stale"; a parked waiting worker is a smell on its own (skipWaiting should
  // never leave one).
  let swReg = '(unsupported)';
  const sw = (typeof navigator !== 'undefined' && navigator.serviceWorker) || null;
  if (sw?.getRegistration) {
    try {
      const reg = await sw.getRegistration();
      swReg = reg
        ? [
          reg.installing ? `installing:${reg.installing.state}` : null,
          reg.waiting ? `waiting:${reg.waiting.state}` : null,
          reg.active ? `active:${reg.active.state}` : null,
        ].filter(Boolean).join(' ') || '(registration, no workers)'
        : '(no registration)';
    } catch (err) { swReg = `(getRegistration failed: ${(err as Error)?.message ?? err})`; }
  }
  // What the server offers RIGHT NOW: a cache-bypassing read of /sw.js,
  // reporting the stamped cache version (or its absence — a rewrite serving
  // HTML in sw.js's place shows up here as text/html + no version). Compared
  // against the controlling worker's debug-pong this answers "is this device
  // behind?" without serviceworker-internals — the iOS PWA has no such surface.
  let swServed = '(unsupported)';
  if (typeof fetch === 'function') {
    try {
      const res = await fetch('/sw.js', { cache: 'no-store' });
      const type = res.headers?.get?.('content-type') || '?';
      const m = (await res.text()).match(/const CACHE = '([^']+)'/);
      swServed = `${m ? m[1] : '(no cache version in body)'} (${res.status} ${type})`;
    } catch (err) { swServed = `(fetch failed: ${(err as Error)?.message ?? err})`; }
  }
  return {
    swReg,
    swServed,
    permission,
    capability,
    localToken: tail(local),
    serverTokenCount: serverTokens.length,
    serverTokenTails: serverTokens.map(tail),
    localTokenOnServer: !!(local && serverTokens.includes(local)),
    swController: controller ? controller.scriptURL : '(no controller)',
    ua: (typeof navigator !== 'undefined' && navigator.userAgent) || '',
  };
}

let _info: Awaited<ReturnType<typeof gatherNotifyDebugInfo>> | null = null;     // last gathered snapshot
let _lastPush: any = null; // last push-debug ping from the SW (raw, untyped payload)
let _swCache: string | null = null;  // controlling SW's cache version (debug-pong)

function row(label: string, value: string, warn = false) {
  return `<div class="ndbg-row${warn ? ' ndbg-warn' : ''}"><span class="ndbg-k">${label}</span><span class="ndbg-v">${value}</span></div>`;
}

function render() {
  const body = document.getElementById('notify-debug-body');
  if (!body) return;
  if (!_info) { body.textContent = 'gathering…'; return; }
  const i = _info;
  const lastPush = _lastPush
    ? `${_lastPush.type || '?'} ${_lastPush.appVisible ? '(app was visible)' : '(app hidden)'} @ ${new Date(_lastPush.at).toLocaleTimeString()}`
    : 'none yet — trigger a knock/call from another account';
  body.innerHTML = [
    row('permission', i.permission, i.permission !== 'granted'),
    row('capability', i.capability, i.capability !== 'supported'),
    row('local token', i.localToken, i.localToken === '(none)'),
    row('server tokens', String(i.serverTokenCount), i.serverTokenCount === 0),
    row('local on server?', i.localTokenOnServer ? 'yes' : 'NO', !i.localTokenOnServer),
    row('SW reg', i.swReg, i.swReg.startsWith('(no registration') || i.swReg.includes('waiting:')),
    row('SW cache', _swCache || '(asking…)'),
    row('SW controller', i.swController),
    // Warn when the controlling worker's version is known and the server is
    // serving something else — the device is running a stale build (or the
    // serve is broken), i.e. exactly the auto-update failure being chased.
    row('sw.js served', i.swServed, !!(_swCache && !i.swServed.startsWith(_swCache))),
    row('last push', lastPush, false),
    row('UA', i.ua),
  ].join('');
}

async function refresh(userId: string) {
  _info = await gatherNotifyDebugInfo(userId);
  render();
}

function buildPanel(userId: string) {
  if (document.getElementById('notify-debug-panel')) return;
  const panel = document.createElement('div');
  panel.id = 'notify-debug-panel';
  panel.setAttribute('style', 'position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#101418;color:#d6e2ea;font:11px/1.5 ui-monospace,monospace;padding:8px 10px;max-height:45vh;overflow:auto;border-top:2px solid #2dd4bf;');
  panel.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
    '<strong>notify debug (#156)</strong>' +
    '<span><button id="notify-debug-refresh" type="button">refresh</button> ' +
    '<button id="notify-debug-close" type="button">×</button></span></div>' +
    '<div id="notify-debug-body">gathering…</div>';
  document.body.appendChild(panel);
  panel.querySelector('#notify-debug-refresh')!.addEventListener('click', () => refresh(userId));
  panel.querySelector('#notify-debug-close')!.addEventListener('click', () => panel.remove());
}

export function initNotifyDebug(userId: string) {
  if (!notifyDebugActive()) return;
  buildPanel(userId);
  refresh(userId);
  if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      const m = e.data || {};
      if (m.kind === 'push-debug') { _lastPush = m; render(); }
      else if (m.kind === 'debug-pong') { _swCache = m.cache; render(); }
    });
    // Ask the controlling worker which cache version it's running.
    try { navigator.serviceWorker.controller?.postMessage({ kind: 'debug-ping' }); } catch { /* no controller */ }
  }
}
