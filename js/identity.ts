// js/identity.ts
const STORAGE_KEY = 'statusapp_identity';

type Identity = { userId: string; code: string; recoveryCode: string };

function generateCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function generateRecoveryCode(): Promise<string> {
  const { WORDLIST } = await import('./wordlist.js');
  const words = [];
  const buf = new Uint32Array(4);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 4; i++) {
    // buf[i] is in [0, 2^32). Modulo by WORDLIST.length introduces negligible bias
    // (WORDLIST.length = 7772 ≪ 2^32, so the bias is ~7e-7 — irrelevant at this scale).
    words.push(WORDLIST[buf[i] % WORDLIST.length]);
  }
  return words.join('-');
}

async function parseRecoveryCode(input: unknown): Promise<string | null> {
  if (typeof input !== 'string') return null;
  const normalized = input
    .toLowerCase()
    .replace(/[\s,\-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized) return null;
  const tokens = normalized.split('-');
  if (tokens.length !== 4) return null;
  const { WORDSET } = await import('./wordlist.js');
  for (const t of tokens) {
    if (!WORDSET.has(t)) return null;
  }
  return tokens.join('-');
}

async function deriveUserIdFromRecoveryCode(recoveryCode: string): Promise<string> {
  const encoded = new TextEncoder().encode(recoveryCode);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hex = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.slice(0, 32);
}

function loadIdentity(): Identity | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed
        && typeof parsed.userId === 'string'
        && typeof parsed.code === 'string'
        && typeof parsed.recoveryCode === 'string') {
      return parsed;
    }
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return null;
}

function saveIdentity(userId: string, code: string, recoveryCode: string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId, code, recoveryCode }));
}

function clearIdentity() {
  localStorage.removeItem(STORAGE_KEY);
}

export {
  generateCode,
  generateRecoveryCode,
  parseRecoveryCode,
  deriveUserIdFromRecoveryCode,
  loadIdentity,
  saveIdentity,
  clearIdentity,
};
