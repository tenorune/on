// js/about-cta.js
// /about page only. The "Open app" links can't reliably escape an in-app browser
// (Telegram's in-app Safari is byte-identical to real Safari, so detection is
// impossible). Instead, rewrite the links BY PLATFORM, always:
//   - iOS  → x-safari-https://host/   (opens Safari; in real Safari it just
//            prompts "Open in Safari?" — verified harmless on iOS/macOS 26)
//   - Android → intent://host/#Intent;scheme=https;...;end  (hands off to the
//            default browser; real Chrome resolves it too; browser_fallback_url
//            degrades cleanly if nothing handles it)
//   - desktop (incl. macOS) → left as the normal new-tab link, so we don't hijack
//            a Chrome/Firefox user into Safari.
// Plain classic script (no imports) so the static about page can load it directly.
(function () {
  var ua = navigator.userAgent || '';
  var isAndroid = /Android/.test(ua);
  // iOS incl. iPadOS (reports as "Macintosh" but has a touchscreen; desktop Macs
  // report maxTouchPoints 0). Mirrors isIos() in js/installGuidance.js.
  var isIOS = /iPhone|iPad|iPod/.test(ua)
    || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 0);
  if (!isAndroid && !isIOS) return; // desktop → leave the normal links alone
  var host = location.host;
  var url = isAndroid
    ? 'intent://' + host + '/#Intent;scheme=https;S.browser_fallback_url='
        + encodeURIComponent('https://' + host + '/') + ';end'
    : 'x-safari-https://' + host + '/';
  var links = document.querySelectorAll('a[data-open-app]');
  for (var i = 0; i < links.length; i += 1) {
    links[i].setAttribute('href', url);
    links[i].removeAttribute('target'); // the scheme opens the external browser itself
  }
})();
