// js/regenFlash.js
// Shared "this value just regenerated" cue: a brief fade-in on the element plus a
// transient NEW badge that REPLACES the regenerate button while it shows (the
// button is hidden, then restored once the badge fades). Mirrors the share-code
// regeneration animation. Used by the invite-modal hash and the new-user secret
// phrase so the change is obvious (and identical) in all three places.
//
//   el     — the value element that just changed (gets the fade + the badge after it)
//   button — the regenerate ↻ button to swap out for the badge (optional)
export function flashRegenerated(el, button = null) {
  if (!el) return;
  el.classList.remove('regen-flash');
  void el.offsetWidth; // reflow so re-adding the class restarts the animation
  el.classList.add('regen-flash');
  const parent = el.parentElement;
  const prior = parent && parent.querySelector('.new-badge');
  if (prior) prior.remove();
  // Hide the regenerate button so the badge takes its place; blur it first so it
  // never stays visibly "selected" (display:none alone drops focus in browsers,
  // but be explicit) and can't be double-tapped while the cue plays.
  if (button) { button.blur(); button.style.display = 'none'; }
  const badge = document.createElement('span');
  badge.className = 'new-badge';
  badge.textContent = 'NEW';
  el.insertAdjacentElement('afterend', badge);
  requestAnimationFrame(() => { badge.style.opacity = '1'; });
  setTimeout(() => {
    badge.style.opacity = '0';
    setTimeout(() => {
      badge.remove();
      if (button) button.style.display = '';
    }, 500);
  }, 1400);
}
