// js/notifyDebug.js
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
const tail = (t) => (t ? `…${String(t).slice(-8)}` : '(none)');

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
export async function gatherNotifyDebugInfo(userId) {
  const permission = (typeof Notification !== 'undefined' && Notification.permission) || 'unknown';
  const capability = detectNotifyCapability().state;
  const local = getRegisteredPushToken();
  let server = null;
  try { server = await readPushTokens(userId); } catch { server = null; }
  const serverTokens = server ? Object.keys(server) : [];
  const controller = (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller) || null;
  return {
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

let _info = null;     // last gathered snapshot
let _lastPush = null; // last push-debug ping from the SW
let _swCache = null;  // controlling SW's cache version (debug-pong)

function row(label, value, warn = false) {
  return `<div class="ndbg-row${warn ? ' ndbg-warn' : ''}"><span class="ndbg-k">${label}</span><span class="ndbg-v">${value}</span></div>`;
}

function render() {
  const body = document.getElementById('notify-debug-body');
  if (!body) return;
  if (!_info) { body.textContent = 'gathering…'; return; }
  const i = _info;
  const lastPush = _lastPush
    ? `${_lastPush.type || '?'} ${_lastPush.suppressed ? '(suppressed: app was visible)' : '(shown)'} @ ${new Date(_lastPush.at).toLocaleTimeString()}`
    : 'none yet — trigger a knock/call with this tab hidden';
  body.innerHTML = [
    row('permission', i.permission, i.permission !== 'granted'),
    row('capability', i.capability, i.capability !== 'supported'),
    row('local token', i.localToken, i.localToken === '(none)'),
    row('server tokens', String(i.serverTokenCount), i.serverTokenCount === 0),
    row('local on server?', i.localTokenOnServer ? 'yes' : 'NO', !i.localTokenOnServer),
    row('SW cache', _swCache || '(asking…)'),
    row('SW controller', i.swController),
    row('last push', lastPush, _lastPush?.suppressed),
  ].join('');
}

async function refresh(userId) {
  _info = await gatherNotifyDebugInfo(userId);
  render();
}

function buildPanel(userId) {
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
  panel.querySelector('#notify-debug-refresh').addEventListener('click', () => refresh(userId));
  panel.querySelector('#notify-debug-close').addEventListener('click', () => panel.remove());
}

export function initNotifyDebug(userId) {
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
