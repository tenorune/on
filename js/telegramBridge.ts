// js/telegramBridge.ts — decouples web boots from telegram.org.
// The bridge <script> is `async` (index.template.html): the bundle no longer
// executes behind a third-party download. Telegram launches are detected from
// the launch URL itself — Mini App URLs carry tgWebAppData/tgWebAppPlatform in
// the fragment — and only those boots await the bridge, with a timeout so a
// slow/blocked telegram.org degrades to a web boot instead of hanging forever.
// Everyone else resolves synchronously.
const TG_LAUNCH = /tgWebAppData|tgWebAppPlatform/;

export function telegramBridgeReady(timeoutMs = 3000): Promise<void> {
  const w = window as unknown as { Telegram?: { WebApp?: unknown } };
  if (w.Telegram?.WebApp) return Promise.resolve();          // bridge already up
  if (!TG_LAUNCH.test(location.hash)) return Promise.resolve(); // not a Telegram launch
  const el = document.getElementById('tg-bridge');
  if (!el) return Promise.resolve();                          // no bridge tag (tests/legacy)
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); resolve(); };
    // The timeout also covers the rare case where the bridge script already
    // fired load/error BEFORE the bundle ran (listeners attach too late to
    // hear it) — the boot degrades after timeoutMs instead of hanging.
    const timer = setTimeout(done, timeoutMs);
    el.addEventListener('load', done, { once: true });
    el.addEventListener('error', done, { once: true });
  });
}
