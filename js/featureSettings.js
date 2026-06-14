// js/featureSettings.js
// Experimental per-user feature toggles, rendered inside the header
// #code-drawer. Visibility is gated behind the ?features query param while the
// feature is experimental; ungate later by removing the guard in
// initFeatureSettings. Flipping a switch writes the pref and reloads — the
// gates in js/features.js are evaluated once at boot (reload-to-apply).
import { getFeatureToggle, setFeatureToggle } from './prefs.js';

// Injectable reload so jsdom tests don't hit the unimplemented navigation.
let _reload = () => window.location.reload();
export function _setReloadForTests(fn) { _reload = fn; }

const TOGGLES = [
  { key: 'palettes', label: 'Palettes', desc: 'Color picker, themes, favorites, and color adoption.' },
  { key: 'groups',   label: 'Groups',   desc: 'Group cards, group view, invites, and the Inbox.' },
];

export function initFeatureSettings() {
  if (!new URLSearchParams(window.location.search).has('features')) return;
  const root = document.getElementById('feature-settings');
  if (!root) return;

  root.replaceChildren(); // idempotent: tear down any prior render
  const title = document.createElement('h4');
  title.className = 'feature-settings-title';
  title.textContent = 'Experimental';
  root.appendChild(title);

  for (const { key, label, desc } of TOGGLES) {
    const row = document.createElement('div');
    row.className = 'feature-settings-row';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `feature-toggle-${key}`;
    input.checked = getFeatureToggle(key);
    input.addEventListener('change', () => {
      setFeatureToggle(key, input.checked);
      _reload();
    });

    const text = document.createElement('label');
    text.setAttribute('for', input.id);
    text.className = 'feature-settings-label';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'feature-settings-name';
    nameSpan.textContent = label;
    const descSpan = document.createElement('span');
    descSpan.className = 'feature-settings-desc';
    descSpan.textContent = desc;
    text.append(nameSpan, descSpan);

    row.append(input, text);
    root.appendChild(row);
  }
  root.classList.remove('hidden');
}
