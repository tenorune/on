// @ts-check
// js/about-invite.js
// Must stay .js — served unbundled via <script src> from about.template.html; a
// rename to .ts 404s in prod. Tripwired by tests/about-page.test.js.
// /about page only. When opened as /about?i=TOKEN, fetch the invite preview from
// the unauthenticated resolveInvitePreview Cloud callable and show a one-line
// "You've been invited…" framing. The page has no Firebase config/SDK, so this is
// a plain fetch against the callable's HTTPS endpoint (substituted into
// #about-invite-framing[data-preview-url] at build). Framing is non-critical:
// any failure (no token, revoked, network, unsubstituted URL) just leaves it hidden.
(function () {
  var params = new URLSearchParams(location.search);
  var token = params.get('i');
  if (!token || !/^[A-Za-z0-9_-]{1,64}$/.test(token)) return;
  var el = document.getElementById('about-invite-framing');
  if (!el) return;
  var url = el.getAttribute('data-preview-url');
  if (!url || url.indexOf('__') === 0) return; // missing / unsubstituted placeholder

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { token: token } }),
  })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (res) {
      var p = res && res.result && res.result.preview;
      if (!p) return;
      var text;
      if (p.scope === 'personal') {
        text = 'You’ve been invited to follow ' + (p.label || 'someone') + '.';
      } else if (p.scope === 'group') {
        text = 'You’ve been invited to join ‘' + (p.groupName || 'a group') + '’.';
      } else {
        return;
      }
      // el is guarded non-null above; the native checker drops that narrowing inside this closure, so re-assert via JSDoc cast.
      var frame = /** @type {HTMLElement} */ (el);
      frame.textContent = text; // textContent (not innerHTML) — label/groupName are user-controlled
      frame.classList.remove('hidden');
    })
    .catch(function () { /* framing is non-critical */ });
})();
