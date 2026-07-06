import { createHmac } from 'crypto';
import { jest } from '@jest/globals';
import { verifyInitData, deriveTelegramUid, ensureTelegramUser, validateTelegramHandler, linkTelegramHandler, unlinkTelegramHandler, expungeDerivedAccount, graduateAccountData, graduateTelegramHandler } from '../telegram-auth.js';

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

  test('first bootstrap stamps the anonymous synthetic Auth email', async () => {
    const deps = makeStoreDeps({});
    deps.setAuthEmail = jest.fn(async () => {});
    const { uid } = await ensureTelegramUser(deps, { id: 42 });
    expect(deps.setAuthEmail).toHaveBeenCalledTimes(1);
    expect(deps.setAuthEmail).toHaveBeenCalledWith(uid, `tg-${uid}@telegram.invalid`);
  });

  test('existing mapping → no email stamp', async () => {
    const deps = makeStoreDeps({});
    deps.setAuthEmail = jest.fn(async () => {});
    deps.store['telegramUsers/42'] = { uid: 'u-existing', chatId: '42' };
    deps.store['users/u-existing/presence'] = { code: 'AAAAAA', status: 'unavailable', availableUntil: null };
    await ensureTelegramUser(deps, { id: 42 });
    expect(deps.setAuthEmail).not.toHaveBeenCalled();
  });

  test('email stamp failure is non-fatal', async () => {
    const deps = makeStoreDeps({});
    deps.setAuthEmail = jest.fn(async () => { throw new Error('auth down'); });
    const { uid, created } = await ensureTelegramUser(deps, { id: 42 });
    expect(uid).toBeTruthy();
    expect(created).toBe(true);
  });

  test('setAuthEmail absent → bootstrap still works', async () => {
    const deps = makeStoreDeps({});
    delete deps.setAuthEmail;
    const { created } = await ensureTelegramUser(deps, { id: 42 });
    expect(created).toBe(true);
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
    appUrl: 'https://app.example',
    mintToken: jest.fn(async (uid) => `token-for-${uid}`),
    allowAttempt: jest.fn(async () => true),
    sendMessage: jest.fn(async () => ({})),
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

  test('first open (created) sends a one-time welcome DM with the Open button', async () => {
    const deps = makeHandlerDeps();
    await validateTelegramHandler({ data: { initData: freshInitData() } }, deps);
    expect(deps.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, extra] = deps.sendMessage.mock.calls[0];
    expect(chatId).toBe('42');
    expect(text).toMatch(/^Welcome to KnockKnock/);
    expect(extra.reply_markup.inline_keyboard[0][0].web_app.url).toBe('https://app.example');
  });

  test('returning open (not created) sends no welcome DM', async () => {
    const deps = makeHandlerDeps();
    await validateTelegramHandler({ data: { initData: freshInitData() } }, deps); // first → created
    deps.sendMessage.mockClear();
    await validateTelegramHandler({ data: { initData: freshInitData() } }, deps); // second → returning
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  test('a failing welcome DM is non-fatal — validate still returns the token', async () => {
    const deps = makeHandlerDeps();
    deps.sendMessage = jest.fn(async () => { throw new Error('forbidden: bot blocked'); });
    const res = await validateTelegramHandler({ data: { initData: freshInitData() } }, deps);
    expect(res.token).toBe(`token-for-${res.uid}`);
    expect(res.created).toBe(true);
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
    deps.store[`users/t1/followerNames/${derivedUid}`] = 'Shadow';
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
    expect(deps.store[`users/t1/followerNames/${derivedUid}`]).toBeNull();
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

// Seed a derived account with the full spread of residue the walker must move:
// own subtree (whole objects, as real RTDB getVal returns them), indexes,
// cross-user backrefs, canvases, group membership/ownership, mailboxes.
function seedGraduationResidue(deps, oldUid) {
  deps.store[`users/${oldUid}`] = {
    presence: { code: 'DERV01', status: 'unavailable', availableUntil: null },
    invites: { TOK1: { scope: 'personal', creatorLabel: 'Ada' } },
    followers: { f1: 'F1CODE' },
    followerNames: { f1: 'Fname' },
    groups: { G1: true, G2: true },
  };
  deps.store[`userPrefs/${oldUid}`] = {
    notifyChannel: 'telegram',
    telegram: { tgId: '42', linkedAt: 1 },
    following: { t1: { label: 't1' } },
    paletteKey: 'ocean',
  };
  deps.store['codeIndex/DERV01'] = oldUid;
  deps.store['inviteIndex/TOK1'] = oldUid;
  // Follower f1's backref into us:
  deps.store[`userPrefs/f1/following/${oldUid}`] = { label: 'shadow' };
  // Followee t1's backrefs to us:
  deps.store[`users/t1/followers/${oldUid}`] = 'DERVCODE';
  deps.store[`users/t1/followerNames/${oldUid}`] = 'Shadow';
  // Canvases with both peers:
  deps.store[`canvases/${oldUid}_f1`] = { strokes: [1] };
  deps.store[`canvases/t1_${oldUid}`] = { strokes: [2] };
  // Group G1 (member only) + G2 (owned):
  deps.store['groups/G1/ownerId'] = 'someoneElse';
  deps.store[`groups/G1/members/${oldUid}`] = true;
  deps.store[`pendingInvitesByGroup/G1/${oldUid}`] = true;
  deps.store['groups/G2/ownerId'] = oldUid;
  deps.store[`groups/G2/members/${oldUid}`] = { displayName: 'Me' };
  // Inbound mailbox that must not be orphaned by the rename:
  deps.store[`pendingInvites/${oldUid}`] = { G9: { from: 'x' } };
  deps.store[`knocks/${oldUid}`] = { from: 'someone' };
}

describe('graduateAccountData', () => {
  const OLD = deriveTelegramUid('42');
  const NEW = 'phraseuid000000000000000000000ab';

  test('moves own subtree, indexes, backrefs, canvases, groups and mailboxes old→new; leaves old own subtree for the caller to drop', async () => {
    const deps = makeStoreDeps();
    seedGraduationResidue(deps, OLD);
    await graduateAccountData(deps, OLD, NEW);

    // Own subtree copied verbatim to new; old still present (handler deletes it).
    expect(deps.store[`users/${NEW}`]).toEqual({
      presence: { code: 'DERV01', status: 'unavailable', availableUntil: null },
      invites: { TOK1: { scope: 'personal', creatorLabel: 'Ada' } },
      followers: { f1: 'F1CODE' },
      followerNames: { f1: 'Fname' },
      groups: { G1: true, G2: true },
    });
    expect(deps.store[`userPrefs/${NEW}`]).toEqual({
      notifyChannel: 'telegram',
      telegram: { tgId: '42', linkedAt: 1 },
      following: { t1: { label: 't1' } },
      paletteKey: 'ocean',
    });
    expect(deps.store[`users/${OLD}`]).not.toBeNull();

    // Indexes repointed:
    expect(deps.store['codeIndex/DERV01']).toBe(NEW);
    expect(deps.store['inviteIndex/TOK1']).toBe(NEW);

    // Follower backref moved:
    expect(deps.store[`userPrefs/f1/following/${OLD}`]).toBeNull();
    expect(deps.store[`userPrefs/f1/following/${NEW}`]).toEqual({ label: 'shadow' });

    // Followee backrefs moved:
    expect(deps.store[`users/t1/followers/${OLD}`]).toBeNull();
    expect(deps.store[`users/t1/followers/${NEW}`]).toBe('DERVCODE');
    expect(deps.store[`users/t1/followerNames/${OLD}`]).toBeNull();
    expect(deps.store[`users/t1/followerNames/${NEW}`]).toBe('Shadow');

    // Canvases moved:
    expect(deps.store[`canvases/${OLD}_f1`]).toBeNull();
    expect(deps.store[`canvases/${NEW}_f1`]).toEqual({ strokes: [1] });
    expect(deps.store[`canvases/t1_${OLD}`]).toBeNull();
    expect(deps.store[`canvases/t1_${NEW}`]).toEqual({ strokes: [2] });

    // Group G1: membership + pending moved, ownership untouched.
    expect(deps.store[`groups/G1/members/${OLD}`]).toBeNull();
    expect(deps.store[`groups/G1/members/${NEW}`]).toBe(true);
    expect(deps.store[`pendingInvitesByGroup/G1/${OLD}`]).toBeNull();
    expect(deps.store[`pendingInvitesByGroup/G1/${NEW}`]).toBe(true);
    expect(deps.store['groups/G1/ownerId']).toBe('someoneElse');

    // Group G2: ownership + membership rewritten to new.
    expect(deps.store['groups/G2/ownerId']).toBe(NEW);
    expect(deps.store[`groups/G2/members/${OLD}`]).toBeNull();
    expect(deps.store[`groups/G2/members/${NEW}`]).toEqual({ displayName: 'Me' });

    // Inbound mailboxes moved (no orphan residue):
    expect(deps.store[`pendingInvites/${OLD}`]).toBeNull();
    expect(deps.store[`pendingInvites/${NEW}`]).toEqual({ G9: { from: 'x' } });
    expect(deps.store[`knocks/${OLD}`]).toBeNull();
    expect(deps.store[`knocks/${NEW}`]).toEqual({ from: 'someone' });
  });

  test('empty account: no throw, nothing created at new', async () => {
    const deps = makeStoreDeps();
    await expect(graduateAccountData(deps, OLD, NEW)).resolves.toBeUndefined();
    expect(deps.store[`users/${NEW}`]).toBeFalsy();
  });
});

describe('graduateTelegramHandler', () => {
  const PHRASE = 'able-baker-charlie-delta';

  async function phraseUid() {
    const { deriveUid } = await import('../auth.js');
    return deriveUid(PHRASE);
  }

  function seedUnlinkedDerived(deps, oldUid) {
    deps.store['telegramUsers/42'] = { uid: oldUid, chatId: '42', createdAt: 1 };
    deps.store[`telegramByUid/${oldUid}`] = { tgId: '42', chatId: '42' };
    seedGraduationResidue(deps, oldUid);
  }

  test('unlinked account → renames to the phrase uid, repoints mapping, drops old subtree', async () => {
    const deps = makeHandlerDeps();
    const OLD = deriveTelegramUid('42');
    const NEW = await phraseUid();
    seedUnlinkedDerived(deps, OLD);

    const res = await graduateTelegramHandler({ data: { initData: freshInitData(), code: PHRASE } }, deps);
    expect(res).toEqual({ ok: true, uid: NEW });

    // Mapping repointed to the phrase uid, marked linked.
    expect(deps.store['telegramUsers/42']).toMatchObject({ uid: NEW, chatId: '42' });
    expect(deps.store['telegramUsers/42'].linkedAt).toBeTruthy();
    expect(deps.store[`telegramByUid/${OLD}`]).toBeNull();
    expect(deps.store[`telegramByUid/${NEW}`]).toEqual({ tgId: '42', chatId: '42' });

    // Account now lives at the new uid; old subtree gone.
    expect(deps.store[`users/${NEW}`].presence.code).toBe('DERV01');
    expect(deps.store[`userPrefs/${NEW}`].notifyChannel).toBe('telegram');
    expect(deps.store[`users/${OLD}`]).toBeNull();
    expect(deps.store[`userPrefs/${OLD}`]).toBeNull();
    expect(deps.store['codeIndex/DERV01']).toBe(NEW);
  });

  test('rate limiter is consulted on the NEW (phrase) uid', async () => {
    const deps = makeHandlerDeps();
    const OLD = deriveTelegramUid('42');
    const NEW = await phraseUid();
    seedUnlinkedDerived(deps, OLD);
    await graduateTelegramHandler({ data: { initData: freshInitData(), code: PHRASE } }, deps);
    expect(deps.allowAttempt).toHaveBeenCalledWith(NEW);
  });

  test('rate limited → resource-exhausted, no move', async () => {
    const deps = makeHandlerDeps();
    const OLD = deriveTelegramUid('42');
    seedUnlinkedDerived(deps, OLD);
    deps.allowAttempt = jest.fn(async () => false);
    await expect(graduateTelegramHandler({ data: { initData: freshInitData(), code: PHRASE } }, deps)).rejects.toThrow(/Too many/i);
    expect(deps.store[`users/${OLD}`]).not.toBeNull();
  });

  test('invalid code → invalid-argument', async () => {
    const deps = makeHandlerDeps();
    seedUnlinkedDerived(deps, deriveTelegramUid('42'));
    await expect(graduateTelegramHandler({ data: { initData: freshInitData(), code: 'nope' } }, deps)).rejects.toThrow(/Invalid recovery/i);
  });

  test('bad initData → unauthenticated', async () => {
    const deps = makeHandlerDeps();
    await expect(graduateTelegramHandler({ data: { initData: 'garbage', code: PHRASE } }, deps)).rejects.toThrow(/signature|Telegram/i);
  });

  test('no bot token configured → failed-precondition', async () => {
    const deps = { ...makeHandlerDeps(), botToken: null };
    await expect(graduateTelegramHandler({ data: { initData: freshInitData(), code: PHRASE } }, deps)).rejects.toThrow(/not configured/i);
  });

  test('already-linked mapping → failed-precondition (nothing to graduate)', async () => {
    const deps = makeHandlerDeps();
    // Mapping points at a phrase uid, not the derived uid → already linked.
    deps.store['telegramUsers/42'] = { uid: 'somephraseuid0000000000000000000', chatId: '42' };
    await expect(graduateTelegramHandler({ data: { initData: freshInitData(), code: PHRASE } }, deps)).rejects.toThrow(/not eligible|linked|precondition/i);
  });

  test('no mapping at all → failed-precondition', async () => {
    const deps = makeHandlerDeps();
    await expect(graduateTelegramHandler({ data: { initData: freshInitData(), code: PHRASE } }, deps)).rejects.toThrow(/not eligible|precondition/i);
  });

  test('target phrase uid already in use → already-exists, no move (retry with a new phrase)', async () => {
    const deps = makeHandlerDeps();
    const OLD = deriveTelegramUid('42');
    const NEW = await phraseUid();
    seedUnlinkedDerived(deps, OLD);
    // A real phrase account already occupies the target uid:
    deps.store[`users/${NEW}/presence`] = { code: 'TAKEN1', status: 'unavailable', availableUntil: null };
    await expect(graduateTelegramHandler({ data: { initData: freshInitData(), code: PHRASE } }, deps)).rejects.toThrow(/already|in use|exists/i);
    // Old account untouched — the client regenerates a phrase and retries.
    expect(deps.store[`users/${OLD}`]).not.toBeNull();
    expect(deps.store['telegramUsers/42']).toMatchObject({ uid: OLD });
  });
});
