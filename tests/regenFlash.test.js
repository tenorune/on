// tests/regenFlash.test.js
const { flashRegenerated } = require('../js/regenFlash.js');

function mount() {
  document.body.innerHTML = `
    <div id="host">
      <span id="val">VALUE</span>
      <button id="btn">rotate</button>
    </div>`;
  return { val: document.getElementById('val'), btn: document.getElementById('btn') };
}

beforeEach(() => { document.body.innerHTML = ''; });

test('no-op (no throw) when the element is null', () => {
  expect(() => flashRegenerated(null)).not.toThrow();
});

test('adds the regen-flash class and inserts a NEW badge after the value (no button)', () => {
  const { val } = mount();
  flashRegenerated(val);
  expect(val.classList.contains('regen-flash')).toBe(true);
  const badge = val.nextElementSibling;
  expect(badge).not.toBeNull();
  expect(badge.className).toBe('new-badge');
  expect(badge.textContent).toBe('NEW');
});

test('with a button: badge anchors in the button slot and the button is hidden via visibility', () => {
  const { val, btn } = mount();
  flashRegenerated(val, btn);
  expect(btn.style.visibility).toBe('hidden');          // hidden, not display:none (slot keeps size)
  expect(btn.nextElementSibling?.className).toBe('new-badge'); // badge after the button, not the value
});

test('replaces a prior NEW badge rather than stacking on a repeat flash', () => {
  const { val } = mount();
  flashRegenerated(val);
  flashRegenerated(val);
  expect(val.parentElement.querySelectorAll('.new-badge').length).toBe(1);
});

test('after the fade window the badge is removed and the button restored', () => {
  jest.useFakeTimers();
  try {
    const { val, btn } = mount();
    flashRegenerated(val, btn);
    expect(btn.parentElement.querySelector('.new-badge')).not.toBeNull();
    jest.advanceTimersByTime(1400 + 500);
    expect(btn.parentElement.querySelector('.new-badge')).toBeNull();
    expect(btn.style.visibility).toBe('');
  } finally {
    jest.useRealTimers();
  }
});
