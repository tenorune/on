// js/db/location.ts — RTDB ops for the location-sharing feature (spec
// 2026-07-18). Raw point at locations/{uid} (mutual+reciprocity-gated by
// rules); grid-snapped point per group at locationCells/{gid}/{uid}
// (member+reciprocity-gated). Cells are written one ref per group, NOT in a
// multipath update with the raw point: a multipath write is atomic, so a
// single stale-membership cell (kicked mid-session) would fail the precise
// write too. Deletes go multipath — the cells' delete-only carve-out means
// they can't be denied.
import { db } from '../firebase-config.js';
import { ref, set, update, onValue } from 'firebase/database';
import { snapToCell } from '../../shared/geo.js';

export async function publishLocation(userId: string, lat: number, lng: number, updatedAt: number): Promise<void> {
  await set(ref(db, `locations/${userId}`), { lat, lng, updatedAt });
}

export async function publishLocationCell(gid: string, userId: string, lat: number, lng: number, updatedAt: number): Promise<void> {
  const cell = snapToCell(lat, lng);
  await set(ref(db, `locationCells/${gid}/${userId}`), { lat: cell.lat, lng: cell.lng, updatedAt });
}

export async function clearLocationData(userId: string, gids: string[]): Promise<void> {
  const updates: Record<string, null> = { [`locations/${userId}`]: null };
  for (const gid of gids) updates[`locationCells/${gid}/${userId}`] = null;
  await update(ref(db), updates);
}

// Cells-only clear: deletes the given groups' cells WITHOUT touching
// locations/{uid}. Used when a group context toggles off while other contexts
// keep publishing — a transient raw-point delete would make RTDB re-evaluate
// reciprocity and cancel every peer's precise-tier listener (and racing an
// unordered republish against the delete is unsafe on real infra).
export async function clearLocationCells(userId: string, gids: string[]): Promise<void> {
  const updates: Record<string, null> = {};
  for (const gid of gids) updates[`locationCells/${gid}/${userId}`] = null;
  await update(ref(db), updates);
}

// Both watchers wire onValue's CANCEL callback to a null emission: when a
// listener is cancelled (reciprocity lost → PERMISSION_DENIED — e.g. the
// viewer's own node was deleted on going unavailable, or the read was denied
// at attach time), the SDK fires the cancel callback and never ticks again.
// Emitting null guarantees a cancelled watch can never strand its last
// coordinate inside locationHub's combine() closures.
export function watchLocation(userId: string, cb: (loc: LocationNode | null) => void): () => void {
  return onValue(ref(db, `locations/${userId}`), (snap) => cb(snap.val()), () => cb(null));
}

export function watchLocationCell(gid: string, userId: string, cb: (loc: LocationNode | null) => void): () => void {
  return onValue(ref(db, `locationCells/${gid}/${userId}`), (snap) => cb(snap.val()), () => cb(null));
}
