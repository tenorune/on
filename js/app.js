// js/app.js
import { loadIdentity, saveIdentity, generateUserId, generateCode, clearIdentity } from './identity.js';
import { initUser, watchStatus, isExpired, writeBackExpired, userExists, touchLastSeen } from './db.js';
import { initHeader, applyOwnStatus } from './me.js';
import { initList } from './following.js';
import { initCodeDrawer } from './mycode.js';

async function ensureIdentity() {
  const existing = loadIdentity();
  if (existing) {
    try {
      const valid = await userExists(existing.userId);
      if (!valid) {
        clearIdentity();
        return null;
      }
    } catch {
      // Network error (offline) — assume valid and proceed
    }
    return existing;
  }

  let userId, code, success;
  do {
    userId = generateUserId();
    code = generateCode();
    success = await initUser(userId, code);
  } while (!success);

  saveIdentity(userId, code);
  return { userId, code };
}

function showStaleScreen() {
  return new Promise((resolve) => {
    document.getElementById('stale-screen').classList.remove('hidden');
    document.getElementById('stale-continue-btn').addEventListener('click', () => {
      document.getElementById('stale-screen').classList.add('hidden');
      resolve();
    }, { once: true });
  });
}

async function main() {
  let identity = await ensureIdentity();
  if (!identity) {
    await showStaleScreen();
    identity = await ensureIdentity();
  }
  const { userId, code } = identity;

  touchLastSeen(userId).catch(() => {});

  initCodeDrawer(userId, code);
  initHeader(userId);
  initList(userId, code);

  watchStatus(userId, (userData) => {
    if (!userData) return;
    const expired = userData.status === 'available' && isExpired(userData.availableUntil);
    if (expired) writeBackExpired(userId);
    applyOwnStatus(
      expired ? 'unavailable' : userData.status,
      expired ? null : userData.availableUntil,
    );
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  }
}

main().catch(console.error);
