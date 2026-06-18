// /about-echo.js — easter egg for the /about page.
//
// Tints the "ambient presence" <em> with the visitor's CURRENT set status color
// when one is saved locally, instead of the default green. Pure progressive
// enhancement: same-origin, no network, no auth, no app bundle. With no saved
// color (or anything unexpected) it does nothing and the CSS default stands.
//
// Source of truth: the app persists the resolved status color (the dot color)
// to localStorage at statusapp_palette_state.sets[activeSet].selectedColor
// (js/store.js setPaletteStateLocal / js/palettes.js). We read it read-only.
(function () {
  try {
    var raw = localStorage.getItem('statusapp_palette_state');
    if (!raw) return;
    var state = JSON.parse(raw);
    if (!state || !state.sets) return;
    var set = state.sets[String(state.activeSet)];
    var color = set && set.selectedColor;
    // Only accept a literal hex color (#rgb … #rrggbbaa) before writing it into a
    // CSS custom property — guards against anything unexpected in storage.
    if (typeof color !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(color)) return;
    document.documentElement.style.setProperty('--status-echo', color);
  } catch (e) { /* easter egg only — never disrupt the page */ }
})();
