import { createHmac } from 'crypto';
import { jest } from '@jest/globals';
import { verifyInitData, deriveTelegramUid, ensureTelegramUser, validateTelegramHandler, linkTelegramHandler, unlinkTelegramHandler, expungeDerivedAccount } from '../telegram-auth.js';

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
  test('auth_date 1 hour in the future → null', () => {
    const future = { ...FRESH, auth_date: String(Math.floor(NOW / 1000) + 60 * 60) };
    expect(verifyInitData(makeInitData(future), BOT_TOKEN, NOW)).toBeNull();
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

function makeStoreDeps(store = {}) {
  return {
    store,
    getVal: jest.fn(async (path) => store[path] ?? null),
    set: jest.fn(async (path, value) => { store[path] = value; }),
    update: jest.fn(async (path, obj) => {
      for (const [k, v] of Object.entries(obj)) store[`${path}/${k}`.replace(/\/+/g, '/')] = v;
    }),
    transaction: jest.fn(async (path, fn) => {
      const next = fn(store[path] ?? null);
      if (next === undefined) return { committed: false };
      store[path] = next;
      return { committed: true };
    }),
    now: () => 1000,
    generateCode: () => 'AAAAAA',
  };
}

describe('ensureTelegramUser', () => {
  test('first contact: creates mapping, reverse index, prefs, presence with claimed code', async () => {
    const deps = makeStoreDeps();
    const res = await ensureTelegramUser(deps, { id: 42, first_name: 'Ada' });
    expect(res.created).toBe(true);
    expect(res.linked).toBe(false);
    expect(res.uid).toMatch(/^[0-9a-f]{32}$/);
    expect(deps.store[`telegramUsers/42`]).toMatchObject({ uid: res.uid, chatId: '42' });
    expect(deps.store[`telegramByUid/${res.uid}`]).toEqual({ tgId: '42', chatId: '42' });
    expect(deps.store[`userPrefs/${res.uid}/notifyChannel`]).toBe('telegram');
    expect(deps.store[`users/${res.uid}/presence`]).toEqual({ code: 'AAAAAA', status: 'unavailable', availableUntil: null });
    expect(deps.store['codeIndex/AAAAAA']).toBe(res.uid);
  });
  test('returning user: no writes, created=false', async () => {
    const deps = makeStoreDeps();
    const first = await ensureTelegramUser(deps, { id: 42 });
    deps.set.mockClear(); deps.transaction.mockClear();
    const again = await ensureTelegramUser(deps, { id: 42 });
    expect(again).toEqual({ uid: first.uid, created: false, linked: false });
    expect(deps.set).not.toHaveBeenCalled();
    expect(deps.transaction).not.toHaveBeenCalled();
  });
  test('share-code collision retries with a fresh code', async () => {
    const deps = makeStoreDeps({ 'codeIndex/AAAAAA': 'someoneElse' });
    const codes = ['AAAAAA', 'BBBBBB'];
    deps.generateCode = () => codes.shift();
    const res = await ensureTelegramUser(deps, { id: 7 });
    expect(deps.store[`users/${res.uid}/presence`].code).toBe('BBBBBB');
  });
  test('linked mapping (phrase uid) is respected: linked=true, no presence bootstrap', async () => {
    const deps = makeStoreDeps({
      'telegramUsers/42': { uid: 'phraseuid00000000000000000000000', chatId: '42' },
      'users/phraseuid00000000000000000000000/presence': { code: 'ZZZZZZ', status: 'unavailable', availableUntil: null },
    });
    const res = await ensureTelegramUser(deps, { id: 42 });
    expect(res).toEqual({ uid: 'phraseuid00000000000000000000000', created: false, linked: true });
  });
});

function makeHandlerDeps(store = {}) {
  const deps = makeStoreDeps(store);
  return {
    ...deps,
    // freshInitData() stamps auth_date from the real wall clock, so
    // verifyInitData's freshness/future-skew check needs a matching `now`
    // (the fixed 1000 from makeStoreDeps would look wildly "future").
    now: () => Date.now(),
    botToken: BOT_TOKEN,
    mintToken: jest.fn(async (uid) => `token-for-${uid}`),
    allowAttempt: jest.fn(async () => true),
  };
}
const freshInitData = () => makeInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 42, first_name: 'Ada' }) });

describe('validateTelegramHandler', () => {
  test('valid initData → bootstraps account and mints token', async () => {
    const deps = makeHandlerDeps();
    const res = await validateTelegramHandler({ data: { initData: freshInitData() } }, deps);
    expect(res.token).toBe(`token-for-${res.uid}`);
    expect(res.created).toBe(true);
    expect(res.linked).toBe(false);
  });
  test('bad initData → unauthenticated', async () => {
    const deps = makeHandlerDeps();
    await expect(validateTelegramHandler({ data: { initData: 'garbage' } }, deps)).rejects.toThrow(/signature|Telegram/i);
  });
  test('no bot token configured → failed-precondition', async () => {
    const deps = { ...makeHandlerDeps(), botToken: null };
    await expect(validateTelegramHandler({ data: { initData: freshInitData() } }, deps)).rejects.toThrow(/not configured/i);
  });
});

describe('linkTelegramHandler', () => {
  const PHRASE = 'able-baker-charlie-delta';
  test('valid phrase with existing account → repoints mapping, cleans old reverse index, mints token', async () => {
    const deps = makeHandlerDeps();
    // Telegram user has already opened the Mini App once (derived account exists):
    const { uid: derivedUid } = await validateTelegramHandler({ data: { initData: freshInitData() } }, deps);
    // The phrase account exists:
    const { deriveUid } = await import('../auth.js');
    const phraseUid = await deriveUid(PHRASE);
    deps.store[`users/${phraseUid}/presence`] = { code: 'PHRAZ1', status: 'unavailable', availableUntil: null };
    const res = await linkTelegramHandler({ data: { initData: freshInitData(), code: PHRASE } }, deps);
    expect(res.token).toBe(`token-for-${phraseUid}`);
    expect(deps.store['telegramUsers/42']).toMatchObject({ uid: phraseUid, chatId: '42' });
    expect(deps.store[`telegramByUid/${phraseUid}`]).toEqual({ tgId: '42', chatId: '42' });
    expect(deps.store[`telegramByUid/${derivedUid}`]).toBeNull();
    expect(deps.store[`userPrefs/${phraseUid}/notifyChannel`]).toBe('telegram');
  });
  test('unknown phrase account → not-found; rate limiter consulted', async () => {
    const deps = makeHandlerDeps();
    await expect(linkTelegramHandler({ data: { initData: freshInitData(), code: PHRASE } }, deps)).rejects.toThrow(/No account/i);
    expect(deps.allowAttempt).toHaveBeenCalled();
  });
  test('rate limited → resource-exhausted', async () => {
    const deps = makeHandlerDeps();
    deps.allowAttempt = jest.fn(async () => false);
    await expect(linkTelegramHandler({ data: { initData: freshInitData(), code: PHRASE } }, deps)).rejects.toThrow(/Too many/i);
  });
  test('no bot token configured → failed-precondition', async () => {
    const deps = { ...makeHandlerDeps(), botToken: null };
    await expect(linkTelegramHandler({ data: { initData: freshInitData(), code: PHRASE } }, deps)).rejects.toThrow(/not configured/i);
  });
  test('direct relink (A→B without unlink) strands account A: mapping repoints to B, A is reset off telegram', async () => {
    const deps = makeHandlerDeps();
    const { deriveUid } = await import('../auth.js');
    const PHRASE_A = 'able-baker-charlie-delta';
    const PHRASE_B = 'echo-foxtrot-golf-hotel';
    const uidA = await deriveUid(PHRASE_A);
    const uidB = await deriveUid(PHRASE_B);
    deps.store[`users/${uidA}/presence`] = { code: 'PHRZ01', status: 'unavailable', availableUntil: null };
    deps.store[`users/${uidB}/presence`] = { code: 'PHRZ02', status: 'unavailable', availableUntil: null };
    // Link tg user 42 to phrase account A:
    await linkTelegramHandler({ data: { initData: freshInitData(), code: PHRASE_A } }, deps);
    // Link again directly to phrase account B, without ever unlinking:
    const res = await linkTelegramHandler({ data: { initData: freshInitData(), code: PHRASE_B } }, deps);
    expect(res.token).toBe(`token-for-${uidB}`);
    expect(deps.store['telegramUsers/42']).toMatchObject({ uid: uidB, chatId: '42' });
    expect(deps.store[`telegramByUid/${uidA}`]).toBeNull();
    expect(deps.store[`userPrefs/${uidA}/notifyChannel`]).toBe('push');
    expect(deps.store[`userPrefs/${uidA}/telegram`]).toBeNull();
    expect(deps.store[`userPrefs/${uidB}/notifyChannel`]).toBe('telegram');
  });
  test('linking when prior mapping is the derived account with residue: derived account is fully expunged', async () => {
    const deps = makeHandlerDeps();
    const { deriveUid } = await import('../auth.js');
    const derivedUid = deriveTelegramUid('42');
    const phraseUid = await deriveUid(PHRASE);

    // Seed the derived account as the current mapping, with residue:
    deps.store['telegramUsers/42'] = { uid: derivedUid, chatId: '42', createdAt: 1 };
    deps.store[`telegramByUid/${derivedUid}`] = { tgId: '42', chatId: '42' };
    deps.store[`users/${derivedUid}/presence`] = { code: 'SHDW01', status: 'unavailable', availableUntil: null };
    deps.store['codeIndex/SHDW01'] = derivedUid;
    deps.store[`userPrefs/${derivedUid}/notifyChannel`] = 'telegram';
    // Follower backref:
    deps.store[`users/${derivedUid}/followers`] = { f1: 'F1CODE' };
    deps.store[`userPrefs/f1/following/${derivedUid}`] = { label: 'shadow' };
    // Group membership (not owner):
    deps.store[`users/${derivedUid}/groups`] = { G1: true };
    deps.store['groups/G1/ownerId'] = 'someoneElse';
    deps.store[`groups/G1/members/${derivedUid}`] = true;
    // Own mailbox:
    deps.store[`knocks/${derivedUid}`] = { from: 'someone' };

    // The phrase account exists:
    deps.store[`users/${phraseUid}/presence`] = { code: 'PHRAZ1', status: 'unavailable', availableUntil: null };

    const res = await linkTelegramHandler({ data: { initData: freshInitData(), code: PHRASE } }, deps);

    expect(res.token).toBe(`token-for-${phraseUid}`);
    expect(deps.store['telegramUsers/42']).toMatchObject({ uid: phraseUid, chatId: '42' });

    // Derived account fully expunged:
    expect(deps.store[`users/${derivedUid}`]).toBeNull();
    expect(deps.store[`userPrefs/${derivedUid}`]).toBeNull();
    expect(deps.store['codeIndex/SHDW01']).toBeNull();
    expect(deps.store[`groups/G1/members/${derivedUid}`]).toBeNull();
    expect(deps.store[`telegramByUid/${derivedUid}`]).toBeNull();
    expect(deps.store[`userPrefs/f1/following/${derivedUid}`]).toBeNull();
    expect(deps.store[`knocks/${derivedUid}`]).toBeNull();

    // Phrase account: linked and token minted:
    expect(deps.store[`userPrefs/${phraseUid}/notifyChannel`]).toBe('telegram');
    expect(deps.store[`telegramByUid/${phraseUid}`]).toEqual({ tgId: '42', chatId: '42' });
  });
});

describe('unlinkTelegramHandler', () => {
  test('linked account unlink expunges the derived shadow account and its social residue, and cleans the phrase account', async () => {
    const deps = makeHandlerDeps();
    const { deriveUid } = await import('../auth.js');
    const phraseUid = await deriveUid('able-baker-charlie-delta');
    deps.store[`users/${phraseUid}/presence`] = { code: 'PHRAZ1', status: 'unavailable', availableUntil: null };
    // Telegram user opens the Mini App (derived shadow account is created)...
    const { uid: derivedUid } = await validateTelegramHandler({ data: { initData: freshInitData() } }, deps);
    // ...then links to the phrase account, leaving the derived account behind as a shadow.
    await linkTelegramHandler({ data: { initData: freshInitData(), code: 'able-baker-charlie-delta' } }, deps);

    // Seed residue on the derived shadow account:
    deps.store[`users/${derivedUid}/presence`] = { code: 'SHDW01', status: 'unavailable', availableUntil: null };
    deps.store['codeIndex/SHDW01'] = derivedUid;
    // Follower f1:
    deps.store[`users/${derivedUid}/followers`] = { f1: 'F1CODE' };
    deps.store[`userPrefs/f1/following/${derivedUid}`] = { label: 'shadow' };
    // Followee t1:
    deps.store[`userPrefs/${derivedUid}/following`] = { t1: { label: 't1' } };
    deps.store[`users/t1/followers/${derivedUid}`] = 'DERVCODE';
    // Canvases with both:
    deps.store[`canvases/${derivedUid}_f1`] = { strokes: [] };
    deps.store[`canvases/t1_${derivedUid}`] = { strokes: [] };
    // Membership in group G1 (not owner) + owned group G2:
    deps.store[`users/${derivedUid}/groups`] = { G1: true, G2: true };
    deps.store['groups/G1/ownerId'] = 'someoneElse';
    deps.store[`groups/G1/members/${derivedUid}`] = true;
    deps.store[`pendingInvitesByGroup/G1/${derivedUid}`] = true;
    deps.store['groups/G2/ownerId'] = derivedUid;
    // Invite token:
    deps.store[`users/${derivedUid}/invites`] = { TOK1: true };
    deps.store['inviteIndex/TOK1'] = derivedUid;
    // Own mailboxes/state:
    deps.store[`knocks/${derivedUid}`] = { from: 'someone' };
    deps.store[`pendingInvites/${derivedUid}`] = { tok: 'x' };

    deps.mintToken.mockClear();
    const res = await unlinkTelegramHandler({ data: { initData: freshInitData() } }, deps);

    expect(res).toEqual({ ok: true });
    expect(deps.mintToken).not.toHaveBeenCalled();

    // Mapping + reverse indexes gone:
    expect(deps.store['telegramUsers/42']).toBeNull();
    expect(deps.store[`telegramByUid/${phraseUid}`]).toBeNull();
    expect(deps.store[`telegramByUid/${derivedUid}`]).toBeNull();

    // Derived account itself gone:
    expect(deps.store[`users/${derivedUid}`]).toBeNull();
    expect(deps.store[`userPrefs/${derivedUid}`]).toBeNull();
    expect(deps.store['codeIndex/SHDW01']).toBeNull();
    expect(deps.store['inviteIndex/TOK1']).toBeNull();
    expect(deps.store[`knocks/${derivedUid}`]).toBeNull();
    expect(deps.store[`pendingInvites/${derivedUid}`]).toBeNull();

    // Cross-user residue cleaned:
    expect(deps.store[`userPrefs/f1/following/${derivedUid}`]).toBeNull();
    expect(deps.store[`users/t1/followers/${derivedUid}`]).toBeNull();
    expect(deps.store[`canvases/${derivedUid}_f1`]).toBeNull();
    expect(deps.store[`canvases/t1_${derivedUid}`]).toBeNull();

    // Non-owned group: membership cleaned, group itself intact:
    expect(deps.store[`groups/G1/members/${derivedUid}`]).toBeNull();
    expect(deps.store[`pendingInvitesByGroup/G1/${derivedUid}`]).toBeNull();
    expect(deps.store['groups/G1']).toBeUndefined();
    expect(deps.store['groups/G1/ownerId']).toBe('someoneElse');

    // Owned group: whole group + pending invites gone:
    expect(deps.store['groups/G2']).toBeNull();
    expect(deps.store['pendingInvitesByGroup/G2']).toBeNull();

    // Phrase account is untouched by the expunge, but was flipped off telegram per the
    // link/unlink "old identity gets reset" convention:
    expect(deps.store[`users/${phraseUid}/presence`]).toEqual({ code: 'PHRAZ1', status: 'unavailable', availableUntil: null });
    expect(deps.store[`userPrefs/${phraseUid}/notifyChannel`]).toBe('push');
    expect(deps.store[`userPrefs/${phraseUid}/telegram`]).toBeNull();
  });

  test('never-linked (derived-only) unlink expunges the derived account and mapping, leaves other accounts alone', async () => {
    const deps = makeHandlerDeps();
    const { uid: derivedUid } = await validateTelegramHandler({ data: { initData: freshInitData() } }, deps);
    deps.store['userPrefs/someoneElse/notifyChannel'] = 'push';

    deps.mintToken.mockClear();
    const res = await unlinkTelegramHandler({ data: { initData: freshInitData() } }, deps);

    expect(res).toEqual({ ok: true });
    expect(deps.mintToken).not.toHaveBeenCalled();
    expect(deps.store['telegramUsers/42']).toBeNull();
    expect(deps.store[`telegramByUid/${derivedUid}`]).toBeNull();
    expect(deps.store[`users/${derivedUid}`]).toBeNull();
    expect(deps.store[`userPrefs/${derivedUid}`]).toBeNull();
    expect(deps.store['userPrefs/someoneElse/notifyChannel']).toBe('push');
  });

  test('unlink with no mapping at all returns ok without throwing', async () => {
    const deps = makeHandlerDeps();
    const res = await unlinkTelegramHandler({ data: { initData: freshInitData() } }, deps);
    expect(res).toEqual({ ok: true });
    expect(deps.mintToken).not.toHaveBeenCalled();
  });

  test('no bot token configured → failed-precondition', async () => {
    const deps = { ...makeHandlerDeps(), botToken: null };
    await expect(unlinkTelegramHandler({ data: { initData: freshInitData() } }, deps)).rejects.toThrow(/not configured/i);
  });
});

describe('expungeDerivedAccount', () => {
  test('removes the account even when nothing exists yet (no throw)', async () => {
    const deps = makeStoreDeps();
    await expect(expungeDerivedAccount(deps, 'somederiveduid00000000000000000')).resolves.toBeUndefined();
    expect(deps.store['users/somederiveduid00000000000000000']).toBeNull();
    expect(deps.store['userPrefs/somederiveduid00000000000000000']).toBeNull();
  });
});
