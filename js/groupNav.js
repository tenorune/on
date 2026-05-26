// js/groupNav.js
// Navigation state machine: currentContext + group cards row.
// State is in-memory; writes mirror to Firebase via setCurrentContext / setLastVisited.

import { setCurrentContext, setLastVisited } from './db.js';

let _myUserId = null;
let _state = { context: 'direct', groupId: null };
const _listeners = new Set();

function parseContextString(s) {
  if (s === 'direct' || !s) return { context: 'direct', groupId: null };
  const m = typeof s === 'string' ? s.match(/^group:(.+)$/) : null;
  if (m) return { context: 'group', groupId: m[1] };
  return { context: 'direct', groupId: null };
}

function emit() {
  const snapshot = { ..._state };
  _listeners.forEach((fn) => { try { fn(snapshot); } catch { /* swallow */ } });
}

export function initNav(userId) {
  _myUserId = userId;
  _state = { context: 'direct', groupId: null };
  _listeners.clear();
}

export function getCurrentContext() {
  return { ..._state };
}

export function onContextChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export async function navigateToDirect() {
  if (_state.context === 'direct') return;
  _state = { context: 'direct', groupId: null };
  await setCurrentContext(_myUserId, 'direct');
  emit();
}

export async function navigateToGroup(groupId) {
  if (_state.context === 'group' && _state.groupId === groupId) return;
  _state = { context: 'group', groupId };
  await setCurrentContext(_myUserId, `group:${groupId}`);
  await setLastVisited(_myUserId, groupId, Date.now());
  emit();
}

export function applyServerCurrentContext(rawValue) {
  const next = parseContextString(rawValue);
  if (next.context === _state.context && next.groupId === _state.groupId) return;
  _state = next;
  emit();
}
