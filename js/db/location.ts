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

export function watchLocation(userId: string, cb: (loc: LocationNode | null) => void): () => void {
  return onValue(ref(db, `locations/${userId}`), (snap) => cb(snap.val()));
}

export function watchLocationCell(gid: string, userId: string, cb: (loc: LocationNode | null) => void): () => void {
  return onValue(ref(db, `locationCells/${gid}/${userId}`), (snap) => cb(snap.val()));
}
