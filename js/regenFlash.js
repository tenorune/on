// js/regenFlash.js
// Shared "this value just regenerated" cue: a brief fade-in on the element plus a
// transient NEW badge inserted right after it. Mirrors the share-code
// regeneration animation. Used by the invite-modal hash and the new-user secret
// phrase so the change is obvious (and identical) in both places.
export function flashRegenerated(el) {
  if (!el) return;
  el.classList.remove('regen-flash');
  void el.offsetWidth; // reflow so re-adding the class restarts the animation
  el.classList.add('regen-flash');
  const parent = el.parentElement;
  const prior = parent && parent.querySelector('.new-badge');
  if (prior) prior.remove();
  const badge = document.createElement('span');
  badge.className = 'new-badge';
  badge.textContent = 'NEW';
  el.insertAdjacentElement('afterend', badge);
  requestAnimationFrame(() => { badge.style.opacity = '1'; });
  setTimeout(() => {
    badge.style.opacity = '0';
    setTimeout(() => badge.remove(), 500);
  }, 1400);
}
