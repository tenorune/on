import { classifyProvenance } from '../ops/provenance.js';
import { deriveTelegramUid } from '../telegram-auth.js';

const SECRET = 'test-uid-secret';
const TG_ID = '42';
const DERIVED = deriveTelegramUid(TG_ID, SECRET);
const PHRASE = 'a'.repeat(32);

/** Minimal snapshot carrying only the nodes provenance reads. */
function snap({ telegramUsers = {}, telegramByUid = {}, userPrefs = {} } = {}) {
  return { telegramUsers, telegramByUid, userPrefs };
}

describe('classifyProvenance', () => {
  test('a uid equal to the HMAC of its tgId is telegram-derived, exactly', () => {
    const s = snap({
      telegramUsers: { [TG_ID]: { uid: DERIVED, chatId: TG_ID, createdAt: 1000 } },
      telegramByUid: { [DERIVED]: { tgId: TG_ID, chatId: TG_ID } },
    });
    expect(classifyProvenance(DERIVED, s, SECRET)).toEqual({ kind: 'telegram-derived', exact: true, tgId: TG_ID });
  });

  test('no telegram mapping at all is a plain phrase account, exactly', () => {
    expect(classifyProvenance(PHRASE, snap(), SECRET)).toEqual({ kind: 'phrase', exact: true, tgId: null });
  });

  test('prefs linkedAt older than the mapping linkedAt reads as graduated (heuristic)', () => {
    const s = snap({
      telegramUsers: { [TG_ID]: { uid: PHRASE, chatId: TG_ID, linkedAt: 5000 } },
      telegramByUid: { [PHRASE]: { tgId: TG_ID, chatId: TG_ID } },
      // graduation copies the prefs subtree wholesale, so linkedAt is the
      // ORIGINAL bootstrap time — strictly older than the mapping's.
      userPrefs: { [PHRASE]: { telegram: { tgId: TG_ID, linkedAt: 1000 } } },
    });
    expect(classifyProvenance(PHRASE, s, SECRET)).toEqual({ kind: 'graduated', exact: false, tgId: TG_ID });
  });

  test('equal linkedAt values read as a linked phrase account (heuristic)', () => {
    const s = snap({
      telegramUsers: { [TG_ID]: { uid: PHRASE, chatId: TG_ID, linkedAt: 5000 } },
      telegramByUid: { [PHRASE]: { tgId: TG_ID, chatId: TG_ID } },
      userPrefs: { [PHRASE]: { telegram: { tgId: TG_ID, linkedAt: 5000 } } },
    });
    expect(classifyProvenance(PHRASE, s, SECRET)).toEqual({ kind: 'phrase-linked', exact: false, tgId: TG_ID });
  });

  test('a missing uid secret degrades to unknown rather than guessing', () => {
    const s = snap({
      telegramUsers: { [TG_ID]: { uid: DERIVED } },
      telegramByUid: { [DERIVED]: { tgId: TG_ID } },
    });
    expect(classifyProvenance(DERIVED, s, null)).toEqual({ kind: 'unknown', exact: false, tgId: TG_ID });
  });

  test('a linked uid with no prefs timestamp is reported inexactly, not as graduated', () => {
    const s = snap({
      telegramUsers: { [TG_ID]: { uid: PHRASE, linkedAt: 5000 } },
      telegramByUid: { [PHRASE]: { tgId: TG_ID } },
      userPrefs: { [PHRASE]: {} },
    });
    expect(classifyProvenance(PHRASE, s, SECRET)).toEqual({ kind: 'phrase-linked', exact: false, tgId: TG_ID });
  });
});
