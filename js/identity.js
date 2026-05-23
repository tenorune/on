// js/identity.js
const { WORDLIST, WORDSET } = require('./wordlist.js');

const STORAGE_KEY = 'statusapp_identity';

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generateRecoveryCode() {
  const words = [];
  for (let i = 0; i < 4; i++) {
    words.push(WORDLIST[Math.floor(Math.random() * WORDLIST.length)]);
  }
  return words.join('-');
}

function parseRecoveryCode(input) {
  if (typeof input !== 'string') return null;
  const normalized = input
    .toLowerCase()
    .replace(/[\s,\-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized) return null;
  const tokens = normalized.split('-');
  if (tokens.length !== 4) return null;
  for (const t of tokens) {
    if (!WORDSET.has(t)) return null;
  }
  return tokens.join('-');
}

async function deriveUserIdFromRecoveryCode(recoveryCode) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new Uint8Array(Buffer.from(recoveryCode, 'utf8'));
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    const hex = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return hex.slice(0, 32);
  }
  // Node environment fallback (jsdom without crypto.subtle)
  const nodeCrypto = require('crypto');
  const hash = nodeCrypto.createHash('sha256').update(recoveryCode, 'utf8').digest('hex');
  return hash.slice(0, 32);
}

function loadIdentity() {
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

function saveIdentity(userId, code, recoveryCode) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId, code, recoveryCode }));
}

function clearIdentity() {
  localStorage.removeItem(STORAGE_KEY);
}

module.exports = {
  generateCode,
  generateRecoveryCode,
  parseRecoveryCode,
  deriveUserIdFromRecoveryCode,
  loadIdentity,
  saveIdentity,
  clearIdentity,
};
