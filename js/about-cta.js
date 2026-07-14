// @ts-check
// js/about-cta.js
// /about page only. Rewrites the "Open app" links so they (a) carry any invite
// token through to the app, and (b) on mobile, break out of in-app browsers
// (Telegram's in-app Safari is byte-identical to real Safari, so detection is
// impossible — we rewrite BY PLATFORM, always):
//   - iOS  → x-safari-https://host/<?i=…&stay=1>   (opens Safari; in real Safari
//            it just prompts "Open in Safari?" — verified harmless on iOS/macOS 26)
//   - Android → intent://host/<?i=…&stay=1>#Intent;scheme=https;…browser_fallback_url…;end
//   - desktop (incl. macOS) → normal new-tab link carrying stay=1 (plus the token
//            when present); rewritten unconditionally now that a fresh desktop boot
//            of / redirects to /about (phase 3) — an as-authored link would bounce
//            back. We don't hijack Chrome/Firefox to Safari.
// The token (?i=TOKEN) carries the invite from /about?i=TOKEN into the app, which
// performs the actual redemption after account creation. stay=1 rides every
// rewritten link (token or not) so the app boot gate never bounces back to
// /about (spec C2). Plain classic script.
(function () {
  var ua = navigator.userAgent || '';
  var isAndroid = /Android/.test(ua);
  // iOS incl. iPadOS (reports as "Macintosh" with a touchscreen; desktop Macs
  // report maxTouchPoints 0). Mirrors isIos() in js/installGuidance.js.
  var isIOS = /iPhone|iPad|iPod/.test(ua)
    || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 0);

  var token = new URLSearchParams(location.search).get('i');
  var valid = !!(token && /^[A-Za-z0-9_-]{1,64}$/.test(token));
  // stay=1 rides EVERY rewritten link (spec C2): it tells the app boot "the
  // user chose this from the landing", so the gate never bounces back — and it
  // must survive the tokenless intent:// browser_fallback_url that can
  // re-enter the SAME webview when the intent is blocked (the phase-2 loop).
  var query = valid ? '?i=' + token + '&stay=1' : '?stay=1';

  // Every platform rewrites (phase 3): fresh tokenless boots of / redirect to
  // this page, so even a desktop link must carry stay=1 or it bounces back.

  var host = location.host;
  var links = document.querySelectorAll('a[data-open-app]');
  for (var i = 0; i < links.length; i += 1) {
    if (isAndroid) {
      var fallback = encodeURIComponent('https://' + host + '/' + query);
      links[i].setAttribute('href',
        'intent://' + host + '/' + query
        + '#Intent;scheme=https;S.browser_fallback_url=' + fallback + ';end');
      links[i].removeAttribute('target'); // the scheme opens the external browser itself
    } else if (isIOS) {
      links[i].setAttribute('href', 'x-safari-https://' + host + '/' + query);
      links[i].removeAttribute('target');
    } else { // desktop → carry query (token if any) + stay=1 on the normal new-tab link
      links[i].setAttribute('href', '/' + query);
    }
  }
})();
