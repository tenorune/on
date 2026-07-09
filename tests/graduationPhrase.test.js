// tests/graduationPhrase.test.js — J#11 (#285): the local vault that lets a
// graduated Telegram account re-view its secret phrase. Keyed by the
// phrase-derived uid; only the current account's phrase is kept.
const { storeGraduatedPhrase, loadGraduatedPhrase } = require('../js/graduationPhrase.js');

beforeEach(() => localStorage.clear());

test('store then load round-trips the phrase for that uid', () => {
  storeGraduatedPhrase('uidA', 'able-baker-charlie-delta');
  expect(loadGraduatedPhrase('uidA')).toBe('able-baker-charlie-delta');
});

test('loadGraduatedPhrase for an unknown uid is null', () => {
  expect(loadGraduatedPhrase('nobody')).toBeNull();
});

test('storing a new phrase clears any prior account phrase (only the current one lingers)', () => {
  storeGraduatedPhrase('uidA', 'able-baker-charlie-delta');
  storeGraduatedPhrase('uidB', 'echo-foxtrot-golf-hotel');
  expect(loadGraduatedPhrase('uidA')).toBeNull();
  expect(loadGraduatedPhrase('uidB')).toBe('echo-foxtrot-golf-hotel');
});
