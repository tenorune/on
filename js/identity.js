// js/identity.js
const STORAGE_KEY = 'statusapp_identity';

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generateUserId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function loadIdentity() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.userId !== 'string' || typeof parsed.code !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveIdentity(userId, code) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId, code }));
}

function clearIdentity() {
  localStorage.removeItem(STORAGE_KEY);
}

module.exports = { generateCode, generateUserId, loadIdentity, saveIdentity, clearIdentity };
