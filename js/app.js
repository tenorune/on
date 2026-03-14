// js/app.js
import { loadIdentity, saveIdentity, generateUserId, generateCode } from './identity.js';
import { initUser, watchStatus, isExpired, writeBackExpired } from './db.js';
import { initMeTab, applyOwnStatus } from './me.js';
import { initFollowingTab } from './following.js';
import { initMyCodeTab } from './mycode.js';

async function ensureIdentity() {
  const existing = loadIdentity();
  if (existing) return existing;

  // First open: generate identity and register in Firebase with collision retry
  let userId, code, success;
  do {
    userId = generateUserId();
    code = generateCode();
    success = await initUser(userId, code);
  } while (!success);

  saveIdentity(userId, code);
  return { userId, code };
}

function initTabs() {
  const panels = document.querySelectorAll('.tab-panel');
  const navBtns = document.querySelectorAll('.nav-btn');

  navBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      panels.forEach((p) => p.classList.remove('active'));
      navBtns.forEach((b) => b.classList.remove('active'));
      document.getElementById(`tab-${target}`).classList.add('active');
      btn.classList.add('active');
    });
  });
}

async function main() {
  initTabs();

  const { userId, code } = await ensureIdentity();

  initMeTab(userId);
  initFollowingTab(userId, code);
  initMyCodeTab(userId, code);

  // Watch own status to keep Me tab in sync (e.g. after expiry on another device)
  watchStatus(userId, (userData) => {
    if (!userData) return;
    const expired = userData.status === 'available' && isExpired(userData.availableUntil);
    if (expired) writeBackExpired(userId);
    applyOwnStatus(
      expired ? 'unavailable' : userData.status,
      expired ? null : userData.availableUntil,
    );
  });

  // Register service worker (must be last in main — non-critical)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  }
}

main().catch(console.error);
