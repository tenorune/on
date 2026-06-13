// js/db/canvas.js — shared drawing-canvas Firebase ops. Watchers return their
// own unsubscribe fn (canvas.js owns teardown).
import { db } from '../firebase-config.js';
import {
  ref, set, get, update, onValue, remove, push,
  onChildAdded, onChildRemoved, query, orderByKey, startAfter, onDisconnect,
} from 'firebase/database';

// --- Canvas operations ---

export function getCanvasId(uid1, uid2) {
  return [uid1, uid2].sort().join('_');
}

export async function loadCanvas(canvasId) {
  const snap = await get(ref(db, `canvases/${canvasId}`));
  if (!snap.exists()) return { bg: null, strokes: [] };
  const val = snap.val();
  const strokes = val.strokes
    ? Object.entries(val.strokes).map(([key, data]) => ({ key, data }))
    : [];
  return { bg: val.bg || null, strokes };
}

export async function pushStroke(canvasId, stroke) {
  const strokeRef = await push(ref(db, `canvases/${canvasId}/strokes`), stroke);
  return strokeRef.key;
}

export async function removeStroke(canvasId, strokeKey) {
  await remove(ref(db, `canvases/${canvasId}/strokes/${strokeKey}`));
}

// Canvas watchers return their unsubscribe fn for the caller (canvas.js) to own,
// mirroring following.js's per-watch Map. Parking the unsub in a module-level
// singleton meant a second watchX without the matching unwatchX silently leaked
// the first listener.
export function watchCanvasBg(canvasId, onChange) {
  return onValue(ref(db, `canvases/${canvasId}/bg`), (snap) => {
    onChange(snap.val());
  });
}

export function setDrawingState(canvasId, userId, drawingData) {
  return set(ref(db, `canvases/${canvasId}/drawing/${userId}`), drawingData);
}

export function watchDrawing(canvasId, peerId, onChange) {
  return onValue(ref(db, `canvases/${canvasId}/drawing/${peerId}`), (snap) => {
    onChange(snap.val());
  });
}

export async function setClearRequest(canvasId, requesterId) {
  await update(ref(db, `canvases/${canvasId}`), { clearRequest: requesterId });
}

export async function removeClearRequest(canvasId) {
  await update(ref(db, `canvases/${canvasId}`), { clearRequest: null });
}

export async function clearAllStrokes(canvasId) {
  await remove(ref(db, `canvases/${canvasId}/strokes`));
  await remove(ref(db, `canvases/${canvasId}/drawing`));
  await update(ref(db, `canvases/${canvasId}`), { clearRequest: null });
}

export function watchClearRequest(canvasId, onChange) {
  return onValue(ref(db, `canvases/${canvasId}/clearRequest`), (snap) => {
    onChange(snap.val());
  });
}

export async function setCanvasBg(canvasId, color) {
  await update(ref(db, `canvases/${canvasId}`), { bg: color });
}

// Returns a single unsub that tears down both the add and (optional) remove
// child listeners.
export function watchStrokes(canvasId, lastKey, onStroke, onStrokeRemoved) {
  const strokesRef = ref(db, `canvases/${canvasId}/strokes`);
  const q = lastKey
    ? query(strokesRef, orderByKey(), startAfter(lastKey))
    : strokesRef;
  const addUnsub = onChildAdded(q, (snap) => {
    onStroke({ key: snap.key, data: snap.val() });
  });
  let removeUnsub = null;
  if (onStrokeRemoved) {
    removeUnsub = onChildRemoved(strokesRef, (snap) => {
      onStrokeRemoved(snap.key);
    });
  }
  return () => { addUnsub(); if (removeUnsub) removeUnsub(); };
}

export async function setCanvasPresence(canvasId, userId, present) {
  const presenceRef = ref(db, `canvases/${canvasId}/presence/${userId}`);
  await set(presenceRef, present);
  if (present) {
    // If we disconnect unexpectedly (browser close, crash, network loss),
    // Firebase server will automatically set presence to false.
    onDisconnect(presenceRef).set(false);
  }
}

export function watchCanvasPresence(canvasId, onChange) {
  return onValue(ref(db, `canvases/${canvasId}/presence`), (snap) => {
    onChange(snap.val() || {});
  });
}
