import { createHmac } from 'crypto';
import { verifyInitData, deriveTelegramUid } from '../telegram-auth.js';

const BOT_TOKEN = '12345:TEST_TOKEN';

// Build a validly-signed initData string the same way Telegram does:
// data_check_string = sorted key=value lines (excluding hash), secret =
// HMAC_SHA256(botToken, key="WebAppData"), hash = HMAC_SHA256(dcs, secret) hex.
function makeInitData(fields, botToken = BOT_TOKEN) {
  const params = new URLSearchParams(fields);
  const pairs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort();
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

const NOW = 1_750_000_000_000;
const FRESH = { auth_date: String(Math.floor(NOW / 1000) - 60), user: JSON.stringify({ id: 42, first_name: 'Ada' }) };

describe('verifyInitData', () => {
  test('valid signature + fresh auth_date → parsed user', () => {
    const user = verifyInitData(makeInitData(FRESH), BOT_TOKEN, NOW);
    expect(user).toEqual({ id: 42, first_name: 'Ada' });
  });
  test('tampered payload → null', () => {
    const good = makeInitData(FRESH);
    const bad = good.replace(encodeURIComponent('"id":42'), encodeURIComponent('"id":43'));
    expect(verifyInitData(bad, BOT_TOKEN, NOW)).toBeNull();
  });
  test('signed with a different bot token → null', () => {
    expect(verifyInitData(makeInitData(FRESH, 'other:TOKEN'), BOT_TOKEN, NOW)).toBeNull();
  });
  test('stale auth_date → null', () => {
    const stale = { ...FRESH, auth_date: String(Math.floor(NOW / 1000) - 25 * 60 * 60) };
    expect(verifyInitData(makeInitData(stale), BOT_TOKEN, NOW)).toBeNull();
  });
  test('missing hash / empty / missing token → null', () => {
    expect(verifyInitData('auth_date=1', BOT_TOKEN, NOW)).toBeNull();
    expect(verifyInitData('', BOT_TOKEN, NOW)).toBeNull();
    expect(verifyInitData(makeInitData(FRESH), '', NOW)).toBeNull();
  });
  test('missing user field → null', () => {
    const noUser = { auth_date: FRESH.auth_date };
    expect(verifyInitData(makeInitData(noUser), BOT_TOKEN, NOW)).toBeNull();
  });
});

describe('deriveTelegramUid', () => {
  test('32 hex chars, deterministic, differs by tgId', () => {
    const a = deriveTelegramUid(42);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(deriveTelegramUid('42')).toBe(a);   // string/number agnostic
    expect(deriveTelegramUid(43)).not.toBe(a);
  });
});
