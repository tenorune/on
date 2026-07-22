// js/regenFlash.ts
// Shared "this value just regenerated" cue: a brief fade-in on the element plus a
// transient NEW badge that REPLACES the regenerate button while it shows (the
// button is hidden, then restored once the badge fades). Mirrors the share-code
// regeneration animation. Used by the invite-modal hash and the new-user secret
// phrase so the change is obvious (and identical) in all three places.
//
//   el     — the value element that just changed (gets the fade + the badge after it)
//   button — the regenerate ↻ button to swap out for the badge (optional)
export function flashRegenerated(el: HTMLElement | null | undefined, button: HTMLElement | null = null) {
  if (!el) return;
  el.classList.remove('regen-flash');
  void el.offsetWidth; // reflow so re-adding the class restarts the animation
  el.classList.add('regen-flash');
  // Anchor the badge in the button's slot (absolutely positioned over it) when a
  // button is given, else inline after the value.
  const host = button || el;
  const prior = host.parentElement && host.parentElement.querySelector('.new-badge');
  if (prior) prior.remove();
  const badge = document.createElement('span');
  badge.className = 'new-badge';
  badge.textContent = 'NEW';
  // Hide the regenerate button with visibility (not display) so its slot keeps
  // its size — the value's width never changes, so the phrase doesn't reflow and
  // the box stays a constant size. blur() drops the "stuck selected" focus.
  if (button) { button.blur(); button.style.visibility = 'hidden'; }
  host.insertAdjacentElement('afterend', badge);
  requestAnimationFrame(() => { badge.style.opacity = '1'; });
  setTimeout(() => {
    badge.style.opacity = '0';
    setTimeout(() => {
      badge.remove();
      if (button) button.style.visibility = '';
    }, 500);
  }, 1400);
}
