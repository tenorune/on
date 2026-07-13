// js/inviteText.ts — recognizes a pasted invite in any shared shape (spec N6):
// a full URL carrying ?i= (web links) or ?startapp= (t.me deep links), or a
// bare 22-char base64url token. Share codes are 6 chars, so the shapes never
// collide. Dependency-free on purpose: js/following.js imports this while its
// tests mock the heavier js/invites.js.
export function extractInviteTokenFromText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (/^[A-Za-z0-9_-]{22}$/.test(s)) return s;
  try {
    const url = new URL(s);
    for (const key of ['i', 'startapp']) {
      const t = url.searchParams.get(key);
      if (t && /^[A-Za-z0-9_-]{1,64}$/.test(t)) return t;
    }
  } catch { /* not a URL */ }
  return null;
}
