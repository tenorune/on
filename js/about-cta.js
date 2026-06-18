// js/about-cta.js
// /about page only. When the page is opened inside an in-app browser (Instagram,
// Telegram, Facebook, etc.), the "Open app" links can't reliably install or
// deliver notifications, so break out to the real browser instead: Safari on iOS
// via the x-safari-https: scheme, the default browser on Android via an intent://
// URL. Outside an in-app browser the links behave normally (open the app in a new
// tab — handled by their target="_blank").
//
// A plain classic script (no imports) so the static about page can load it
// directly. In-app UA list mirrors isInAppBrowser() in js/installGuidance.js.
(function () {
  var ua = navigator.userAgent || '';
  var IN_APP = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|Twitter|LinkedInApp|WhatsApp|musical_ly|Bytedance|TikTok|Pinterest|Telegram|MicroMessenger|; ?wv\)|GSA\//;
  if (!IN_APP.test(ua)) return; // real browser → leave the normal new-tab links alone
  var isAndroid = /Android/.test(ua);
  var links = document.querySelectorAll('a[data-open-app]');
  for (var i = 0; i < links.length; i += 1) {
    links[i].addEventListener('click', function (e) {
      e.preventDefault();
      var host = location.host;
      // Android: intent:// hands off to the default browser. iOS: x-safari-https:
      // forces Safari from within a WKWebView-based in-app browser.
      window.location.href = isAndroid
        ? 'intent://' + host + '/#Intent;scheme=https;end'
        : 'x-safari-https://' + host + '/';
    });
  }
})();
