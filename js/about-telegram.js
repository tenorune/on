// @ts-check
// js/about-telegram.js
// /about + /invite only. Owns the Telegram-facing page behavior (spec N4):
//   - token-less pages: unhide the standing bare "Open in Telegram" CTA when
//     the build substituted a real deep link (fail-closed on __…__);
//   - valid ?i=TOKEN: show the invite block (one set of doors — the intro's
//     CTAs hide), compose the token-carrying Telegram CTA, wire the copy
//     button (with a selectable-text fallback, C7);
//   - /invite (config #1): identity-aware pass-through when this browser
//     already holds an account (no mint risk — straight into the app, C1),
//     else collapse the marketing behind the "More about …" expander.
// Plain classic script (CSP script-src 'self'); tested via vm sandbox.
(function () {
  /**
   * @param {HTMLElement | null} el
   * @returns {string | null}
   */
  function realLink(el) {
    var v = el && el.getAttribute('data-telegram-link');
    return (v && v.indexOf('__') !== 0) ? v : null; // unsubstituted placeholder → no link
  }

  var t = null;
  try { t = new URLSearchParams(location.search).get('i'); } catch (e) { /* unusual URL */ }
  var token = (t && /^[A-Za-z0-9_-]{1,64}$/.test(t)) ? t : null;

  var introTg = document.getElementById('about-telegram-cta');

  if (!token) {
    // Plain marketing page: just the standing bare Telegram door (A3).
    var bare = realLink(introTg);
    // bare non-null implies introTg non-null (realLink null-guards el); cast to satisfy the checker.
    if (bare) {
      var bareEl = /** @type {HTMLElement} */ (introTg);
      bareEl.setAttribute('href', bare);
      bareEl.classList.remove('hidden');
    }
    return;
  }

  var onInvitePath = location.pathname === '/invite';

  // Identity-aware pass-through (C1): an account in THIS browser means no mint
  // risk — skip the landing entirely. stay=1 keeps the boot gate from bouncing
  // back. /about?i= deliberately does not pass through (it is a reading page).
  // The inline pre-paint script in about.template.html's <head> normally does
  // this redirect before the page renders (no flash); this bottom-of-body copy
  // is the fallback for when that inline script didn't run (e.g. CSP-blocked).
  if (onInvitePath) {
    var hasIdentity = false;
    try { hasIdentity = !!localStorage.getItem('statusapp_identity'); } catch (e) { /* storage blocked */ }
    if (hasIdentity) { location.replace('/?i=' + token + '&stay=1'); return; }
  }

  var landing = document.getElementById('invite-landing');
  if (!landing) return; // stale cached page without the block — do nothing

  // One set of doors: while the invite block shows, the intro's CTAs hide —
  // two "Open in Telegram" buttons where only one carries the invite would
  // silently drop the token on the wrong tap.
  if (introTg) introTg.classList.add('hidden');
  var introOpen = document.getElementById('about-open-cta');
  if (introOpen) introOpen.classList.add('hidden');

  var tgCta = document.getElementById('invite-telegram-cta');
  var deep = realLink(tgCta);
  if (deep) {
    // deep non-null implies tgCta non-null (realLink null-guards el); cast to satisfy the checker.
    var tgEl = /** @type {HTMLElement} */ (tgCta);
    tgEl.setAttribute('href', deep + '?startapp=' + token);
    tgEl.classList.remove('hidden');
  }

  landing.classList.remove('hidden');

  // Config #1: marketing collapses behind the expander (CSS keys off the class;
  // script-off fallback = fully expanded page, nothing unreachable).
  if (onInvitePath) document.body.classList.add('invite-first');

  // C5 (implement-and-evaluate): promote the installed-app door on iOS.
  // Mirrors about-cta.js's inline check (iPadOS reports as Macintosh + touch).
  var ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 0)) {
    document.body.classList.add('ios-door-promoted');
  }

  var moreBtn = document.getElementById('about-more-btn');
  if (moreBtn) {
    moreBtn.addEventListener('click', function () {
      // Clear both drivers of the collapse: the pre-paint <html> class set by
      // the inline head script, and the body class this script sets as fallback.
      document.documentElement.classList.remove('cfg-invite-first');
      document.body.classList.remove('invite-first');
    });
  }

  var copyBtn = document.getElementById('invite-copy-btn');
  var copyOut = document.getElementById('invite-copy-fallback');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      // copyBtn guarded non-null above; native checker drops that narrowing in the nested then-closure, so cast.
      var btn = /** @type {HTMLElement} */ (copyBtn);
      var url = location.origin + '/invite?i=' + token;
      var write = (navigator.clipboard && navigator.clipboard.writeText)
        ? navigator.clipboard.writeText(url)
        : Promise.reject(new Error('no clipboard api'));
      write.then(function () {
        btn.textContent = 'Copied!';
        setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
      }).catch(function () {
        // Webviews commonly deny clipboard writes (C7) — show the URL to select.
        if (copyOut) { copyOut.textContent = url; copyOut.classList.remove('hidden'); }
      });
    });
  }
})();
