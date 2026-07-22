// js/devReset.js — DEV-ONLY, env-gated identity reset. Lets an operator clear
// the local login (statusapp_identity + cached Firebase session) via a secret
// query-param link, so the first-time invite flow can be re-tested without
// clearing browser storage by hand.
//
// Fail-closed by construction: the feature is inert unless a secret was baked
// into the build AND the caller supplies that exact secret AND the current
// hostname is on an explicit allowlist. Nothing secret is committed here — the
// secret and allowlist live in .env.local (dev) / CI env (never .env.production
// unless the operator deliberately wants this reachable there), and are read at
// build time by scripts/build.js via esbuild `define`.
//
// Usage: build with DEV_RESET_SECRET and DEV_RESET_HOSTS set, then visit
//   https://<host>/?dev-reset=<secret>
// where <host> is one of the comma-separated DEV_RESET_HOSTS entries.
import { clearIdentity } from './identity.js';
import { signOut } from 'firebase/auth';
import { auth } from './firebase-config.js';

export async function maybeRunDevReset() {
  const secret = process.env.DEV_RESET_SECRET;
  if (!secret) return false; // feature not built with a secret ⇒ inert

  let param: string | null;
  let hostname: string;
  try {
    param = new URLSearchParams(window.location.search).get('dev-reset');
    hostname = window.location.hostname;
  } catch {
    return false;
  }
  if (param !== secret) return false;

  const allowlist = (process.env.DEV_RESET_HOSTS || '')
    .split(',')
    .map(h => h.trim())
    .filter(Boolean);
  if (!allowlist.includes(hostname)) return false;

  clearIdentity();
  try { await signOut(auth); } catch (e) { /* best-effort: drop cached Firebase session too */ }
  console.info('[dev-reset] identity cleared');
  window.location.replace('/?stay=1'); // fresh new-user flow; stay=1 dodges the phase-3 /about bounce
  return true;
}
