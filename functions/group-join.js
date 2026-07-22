// functions/group-join.js
// Server-authoritative group join (Fix 2, option A). The client no longer
// writes groups/{gid}/members/{uid} directly (the #288 self-join surface);
// it calls this callable, which validates a real entitlement — a live invite
// token OR a pending invite addressed to the caller — before writing the member
// node via the Admin SDK (deps.set, which bypasses rules). Mirrors the checks
// the client redeemGroupInvite/inbox-accept used to perform, now authoritative.
//
// Display-name cap mirrors userPrefs/groups member displayName usage (<= 64).
const MAX_DISPLAY_NAME = 64;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/**
 * @param {{ auth?: { uid: string }, data: { groupId?: unknown, displayName?: unknown, token?: unknown } }} request
 * @param {{ now: () => number, getVal: (p: string) => Promise<any>, set: (p: string, v: unknown) => Promise<void>, transaction: (p: string, fn: (c: any) => unknown) => Promise<{ committed: boolean }> }} deps
 */
export async function joinGroupHandler(request, deps) {
  const uid = request.auth?.uid;
  if (!uid) return { ok: false, reason: 'unauthenticated' };

  const { groupId, displayName, token } = request.data || {};
  if (typeof groupId !== 'string' || !groupId
    || typeof displayName !== 'string' || !displayName.trim()
    || displayName.length > MAX_DISPLAY_NAME) {
    return { ok: false, reason: 'invalid-argument' };
  }
  if (token !== undefined && typeof token !== 'string') {
    return { ok: false, reason: 'invalid-argument' };
  }

  // Group must exist (name leaf is the cheap existence probe the redeem flow uses).
  const name = await deps.getVal(`groups/${groupId}/name`);
  if (name == null) return { ok: false, reason: 'not-found' };

  // Validate entitlement.
  if (token) {
    const invite = await deps.getVal(`groups/${groupId}/invites/${token}`);
    if (!invite) return { ok: false, reason: 'not-found' };
    if (invite.revoked) return { ok: false, reason: 'revoked' };
    if (invite.expiresAt != null && invite.expiresAt < deps.now()) return { ok: false, reason: 'expired' };
    if (invite.redemptionCap != null && (invite.redemptionsUsed || 0) >= invite.redemptionCap) {
      return { ok: false, reason: 'cap' };
    }
  } else {
    const pending = await deps.getVal(`pendingInvites/${uid}/${groupId}`);
    if (!pending) return { ok: false, reason: 'no-entitlement' };
  }

  // Idempotent: an existing membership is a no-op (mirrors the client's
  // already-member guard; re-redeem must not reset role/joinedAt/override).
  const existing = await deps.getVal(`groups/${groupId}/members/${uid}`);
  if (existing) return { ok: true, groupId, alreadyMember: true };

  const now = deps.now();
  await deps.set(`groups/${groupId}/members/${uid}`, {
    role: 'member',
    displayName,
    joinedAt: now,
    statusOverride: { enabled: true, status: 'available', availableUntil: now + TWO_HOURS_MS },
  });

  // Token path: bump redemptions authoritatively (moved off the client).
  // Transacts the whole invite object (not the redemptionsUsed leaf) so it's
  // atomic against the same node the validation read above. The member write
  // above is authoritative and already committed; this bump is best-effort —
  // we deliberately ignore {committed} because if the invite vanishes mid-
  // request the join still stands and the counter simply doesn't move.
  if (token) {
    await deps.transaction(`groups/${groupId}/invites/${token}`, (invite) => {
      if (!invite) return invite;
      invite.redemptionsUsed = (invite.redemptionsUsed || 0) + 1;
      return invite;
    });
  }

  return { ok: true, groupId };
}
