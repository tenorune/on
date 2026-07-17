// functions/invites.js
import { HttpsError } from 'firebase-functions/v2/https';

// Unauthenticated invite-preview resolver. The welcome screen names the inviter
// (personal scope) or the group (group scope) BEFORE the new user has any auth
// session — but every invite node is gated by `auth != null` in the security
// rules, so a brand-new (unauthenticated) user can't read them from the client.
// This callable reads via the Admin SDK (which bypasses rules) and returns ONLY
// the preview-safe fields. Mirrors js/invites.js resolveInvitePreview.
//
// deps.getVal(path): reads the value at an RTDB path (injected so the handler is
// testable without firebase-admin).
/**
 * @param {{ data?: { token?: unknown } }} request
 * @param {{ getVal: (path: string) => Promise<any> }} deps
 */
export async function resolveInvitePreviewHandler(request, deps) {
  const token = request.data?.token;
  // Same shape as the client's extractInviteTokenFromUrl guard.
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(token)) {
    throw new HttpsError('invalid-argument', 'Invalid invite token.');
  }
  try {
    const index = await deps.getVal(`inviteIndex/${token}`);
    if (!index) return { preview: null };

    if (index.scope === 'personal') {
      const m = String(index.ownerPath || '').match(/^users\/([^/]+)\/invites\/([^/]+)$/);
      if (!m) return { preview: null };
      const invite = await deps.getVal(`users/${m[1]}/invites/${m[2]}`);
      if (!invite || invite.revoked) return { preview: null };
      return { preview: { scope: 'personal', label: invite.creatorLabel || null } };
    }

    if (index.scope === 'group') {
      const m = String(index.ownerPath || '').match(/^groups\/([^/]+)\/invites\/([^/]+)$/);
      if (!m) return { preview: null };
      // groups/{gid}/name holds the bare string; groups/{gid}/invites/{token} the record.
      const [name, invite] = await Promise.all([
        deps.getVal(`groups/${m[1]}/name`),
        deps.getVal(`groups/${m[1]}/invites/${m[2]}`),
      ]);
      if (name == null) return { preview: null }; // group missing
      if (!invite || invite.revoked) return { preview: null };
      return { preview: { scope: 'group', groupName: name || null, groupId: m[1] } };
    }

    return { preview: null };
  } catch {
    // Framing is non-critical: on any read failure, fall back to no framing
    // rather than surfacing an error to a user who's just trying to sign up.
    return { preview: null };
  }
}
