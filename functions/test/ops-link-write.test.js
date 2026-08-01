import { makeStoreDeps } from './store-deps.js';
import { performLink, deriveTelegramUid } from '../telegram-auth.js';
import {
  buildLinkWrites, buildMappingTeardown, readMapping, LINK_NODE_FIELDS,
} from '../ops/link-write.js';

const NOW = 1_750_000_000_000;
const SECRET = 'test-uid-secret';

/**
 * The shipped handler surface performLink needs, over the shared RTDB mock.
 * `now` and `mintToken` are the only extras; everything else it touches is a
 * read or the one rootUpdate.
 * @param {Record<string, unknown>} seed
 */
function shipped(seed) {
  const deps = makeStoreDeps({ ...seed });
  return {
    ...deps,
    store: deps.store,
    now: () => NOW,
    uidSecret: SECRET,
    mintToken: async () => 'token',
  };
}

/**
 * Run the SHIPPED performLink and return the write-map it actually sent. This
 * is the parity oracle: not a transcription of what performLink is believed to
 * write, but what it writes when executed.
 * @param {ReturnType<typeof shipped>} deps
 * @param {string} uid
 * @param {string} tgId
 */
async function shippedWrites(deps, uid, tgId) {
  await performLink(deps, uid, { id: tgId });
  const calls = deps.update.mock.calls;
  return calls[calls.length - 1][1];
}

/** The same world, twice, so the two implementations never see each other's writes. */
function worlds(seed) {
  return [shipped(seed), makeStoreDeps({ ...seed })];
}

// The defect this module exists to close: performLink's write block had THREE
// hand-written copies (shipped, ops/merge.js, ops/purge.js) that had already
// drifted three ways. There are two copies now, and this suite fails if they
// stop agreeing — it runs the shipped function rather than restating it.
describe('parity with the shipped performLink', () => {
  const base = {
    'users/P': { presence: { code: 'PPP111' } },
    'userPrefs/P': { notifyChannel: 'push' },
  };

  test('a fresh tgId produces byte-identical writes', async () => {
    const [ship, ops] = worlds(base);
    const expected = await shippedWrites(ship, 'P', '42');
    const { writes } = await buildLinkWrites(ops, { tgId: '42', uid: 'P', now: NOW });
    expect(writes).toEqual(expected);
    // and the block really is the five keys, not an empty agreement
    expect(Object.keys(writes).sort()).toEqual([
      'telegramByUid/P', 'telegramUsers/42',
      'userPrefs/P/notifyChannel', 'userPrefs/P/telegram/linkedAt', 'userPrefs/P/telegram/tgId',
    ]);
  });

  test('an existing mapping the same account holds keeps performLink chatId precedence', async () => {
    const seed = { ...base, 'telegramUsers/42': { uid: 'P', chatId: '777', createdAt: 100 } };
    const [ship, ops] = worlds(seed);
    const expected = await shippedWrites(ship, 'P', '42');
    const { writes } = await buildLinkWrites(ops, { tgId: '42', uid: 'P', now: NOW });
    expect(writes).toEqual(expected);
    // the prior chatId wins over the tgId fallback in BOTH
    expect(writes['telegramUsers/42']).toEqual({ uid: 'P', chatId: '777', linkedAt: NOW });
  });

  test('a mapping held by another phrase account gets performLink direct-relink reset', async () => {
    const seed = {
      ...base,
      'users/X': { presence: { code: 'XXX111' } },
      'telegramUsers/42': { uid: 'X', chatId: '42' },
      'telegramByUid/X': { tgId: '42', chatId: '42' },
      'userPrefs/X': { notifyChannel: 'telegram', telegram: { tgId: '42', linkedAt: 5 } },
    };
    const [ship, ops] = worlds(seed);
    const expected = await shippedWrites(ship, 'P', '42');
    // X is a real phrase account, not the tgId's derived uid — so performLink
    // takes the reset branch rather than the expunge branch.
    expect(deriveTelegramUid('42', SECRET)).not.toBe('X');
    const { writes, conflicts, losses } = await buildLinkWrites(ops, { tgId: '42', uid: 'P', now: NOW });
    expect(writes).toEqual(expected);
    // the writes match, and unlike production the ops path SAYS whose they are
    expect(conflicts.some((c) => c.kind === 'telegram-relink' && c.detail.includes('X'))).toBe(true);
    expect(losses.some((l) => l.includes('X') && l.includes('push'))).toBe(true);
  });

  test('the ONE deviation is the reverse-index chatId fallback, and only when there is no mapping', async () => {
    const [ship, ops] = worlds(base);
    const expected = await shippedWrites(ship, 'P', '42');
    // performLink has no reverse index to consult and invents chatId = tgId.
    expect(expected['telegramUsers/42']).toEqual({ uid: 'P', chatId: '42', linkedAt: NOW });
    const { writes } = await buildLinkWrites(ops, { tgId: '42', uid: 'P', now: NOW, fallbackChatId: '777' });
    expect(writes['telegramUsers/42']).toEqual({ uid: 'P', chatId: '777', linkedAt: NOW });
    expect(writes['telegramByUid/P']).toEqual({ tgId: '42', chatId: '777' });
  });

  test('ownUids suppresses the reset for an account the caller is already handling', async () => {
    // performLink EXPUNGES a prior holder that is the tgId's own derived uid.
    // The ops callers expunge it themselves (purge) or null its reverse index
    // themselves (merge), so the builder must not also emit a prefs reset for
    // an account whose whole userPrefs node is being deleted.
    const derived = deriveTelegramUid('42', SECRET);
    const ops = makeStoreDeps({ ...base, 'telegramUsers/42': { uid: derived, chatId: '42' } });
    const { writes, conflicts } = await buildLinkWrites(ops, {
      tgId: '42', uid: 'P', now: NOW, ownUids: [derived],
    });
    expect(writes[`userPrefs/${derived}/notifyChannel`]).toBeUndefined();
    expect(writes[`telegramByUid/${derived}`]).toBeUndefined();
    expect(conflicts).toEqual([]);
    // without the exemption the same world DOES produce the reset
    const bare = await buildLinkWrites(makeStoreDeps({ ...base, 'telegramUsers/42': { uid: derived, chatId: '42' } }), { tgId: '42', uid: 'P', now: NOW });
    expect(bare.writes[`userPrefs/${derived}/notifyChannel`]).toBe('push');
  });
});

describe('the mapping node is replaced wholesale, and every dropped field is named', () => {
  test('a field outside LINK_NODE_FIELDS produces a loss line', async () => {
    const ops = makeStoreDeps({ 'telegramUsers/42': { uid: 'P', chatId: '42', createdAt: 100, nickname: 'zed' } });
    const { losses } = await buildLinkWrites(ops, { tgId: '42', uid: 'P', now: NOW });
    expect(losses.some((l) => l.includes('createdAt') && l.includes('100'))).toBe(true);
    expect(losses.some((l) => l.includes('nickname') && l.includes('zed'))).toBe(true);
    expect(losses.filter((l) => LINK_NODE_FIELDS.some((f) => l.includes(`.${f} `)))).toEqual([]);
  });
});

describe('buildMappingTeardown — a global key is never deleted unread', () => {
  test('deletes a mapping the account actually owns', async () => {
    const deps = makeStoreDeps({ 'telegramUsers/42': { uid: 'D', chatId: '42' } });
    const { writes, conflicts, losses } = await buildMappingTeardown(deps, { tgId: '42', owner: 'D', context: 'D is purged' });
    expect(writes).toEqual({ 'telegramUsers/42': null });
    expect(conflicts).toEqual([]);
    expect(losses).toEqual([]);
    expect(deps.getVal).toHaveBeenCalledWith('telegramUsers/42');
  });

  test('refuses to delete a mapping that belongs to someone else, and names them', async () => {
    const deps = makeStoreDeps({ 'telegramUsers/42': { uid: 'X', chatId: '42' } });
    const { writes, conflicts, losses } = await buildMappingTeardown(deps, { tgId: '42', owner: 'D', context: 'D is purged' });
    expect(writes).toEqual({});
    expect(conflicts).toEqual([{
      kind: 'telegram-mapping-not-owned',
      path: 'telegramUsers/42',
      detail: expect.stringContaining('X'),
      resolution: expect.stringContaining('not part of this operation'),
    }]);
    expect(losses.some((l) => l.includes('NOT deleted') && l.includes('X'))).toBe(true);
  });

  test('an absent mapping is still nulled — a no-op null, not a conflict', async () => {
    const { writes, conflicts } = await buildMappingTeardown(makeStoreDeps({}), { tgId: '42', owner: 'D', context: 'D is purged' });
    expect(writes).toEqual({ 'telegramUsers/42': null });
    expect(conflicts).toEqual([]);
  });

  test('a mapping node carrying no uid is refused rather than assumed ours', async () => {
    const deps = makeStoreDeps({ 'telegramUsers/42': { chatId: '42' } });
    const { writes, conflicts } = await buildMappingTeardown(deps, { tgId: '42', owner: 'D', context: 'D is purged' });
    expect(writes).toEqual({});
    expect(conflicts[0].kind).toBe('telegram-mapping-not-owned');
  });
});

describe('readMapping', () => {
  test('normalises a numeric uid and reports absence as null', async () => {
    const deps = makeStoreDeps({ 'telegramUsers/42': { uid: 'D' } });
    expect(await readMapping(deps, '42')).toEqual({ prior: { uid: 'D' }, priorUid: 'D' });
    expect(await readMapping(deps, '99')).toEqual({ prior: null, priorUid: null });
  });
});
