import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { jest } from '@jest/globals';
import { makeStoreDeps } from './store-deps.js';
import {
  parseArgs,
  assertProdGate,
  isProductionTarget,
  requireConfirm,
  createRoutes,
  createHttpServer,
  BIND_ADDRESS,
} from '../ops/server.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OPS_DIR = join(HERE, '..', 'ops');

const ENV = { GOOGLE_APPLICATION_CREDENTIALS_JSON: '{"x":1}', TELEGRAM_UID_SECRET: 's' };

describe('parseArgs', () => {
  test('reads project, port, region and the prod flags', () => {
    const opts = parseArgs(['--project', 'demo', '--port', '9999', '--prod-project', 'live', '--i-know-this-is-prod'], ENV);
    expect(opts.projectId).toBe('demo');
    expect(opts.port).toBe(9999);
    expect(opts.prodProject).toBe('live');
    expect(opts.prodAcknowledged).toBe(true);
  });

  test('defaults the port and the region', () => {
    const opts = parseArgs(['--project', 'demo'], ENV);
    expect(opts.port).toBe(8787);
    expect(opts.region).toBe('europe-west1');
  });

  test('derives the regional database URL', () => {
    expect(parseArgs(['--project', 'demo'], ENV).databaseURL)
      .toBe('https://demo-default-rtdb.europe-west1.firebasedatabase.app');
  });

  test('us-central1 uses the legacy host', () => {
    expect(parseArgs(['--project', 'demo', '--region', 'us-central1'], ENV).databaseURL)
      .toBe('https://demo-default-rtdb.firebaseio.com');
  });

  test('throws without --project', () => {
    expect(() => parseArgs([], ENV)).toThrow(/--project/);
  });

  test('throws without the service-account env', () => {
    expect(() => parseArgs(['--project', 'demo'], {})).toThrow(/GOOGLE_APPLICATION_CREDENTIALS_JSON/);
  });

  test('a missing uid secret is allowed but recorded', () => {
    const opts = parseArgs(['--project', 'demo'], { GOOGLE_APPLICATION_CREDENTIALS_JSON: '{"x":1}' });
    expect(opts.uidSecret).toBeNull();
  });

  // An unparseable port must not silently become NaN and then a random OS port.
  test('refuses a port that is not a number', () => {
    expect(() => parseArgs(['--project', 'demo', '--port', 'eight'], ENV)).toThrow(/--port/);
  });

  test('refuses a port outside the legal range', () => {
    expect(() => parseArgs(['--project', 'demo', '--port', '99999'], ENV)).toThrow(/--port/);
  });

  // An env var set to the empty string (or whitespace) is NOT a declaration of
  // which project is production — it is an unparseable environment, and the
  // gate below has to see it as "unknown" rather than as a real project name
  // that happens to match nothing.
  test('an empty or whitespace prod-project reads as unknown, not as a project name', () => {
    expect(parseArgs(['--project', 'demo'], { ...ENV, PROD_PROJECT: '   ' }).prodProject).toBeNull();
    expect(parseArgs(['--project', 'demo', '--prod-project', ''], ENV).prodProject).toBeNull();
  });
});

describe('assertProdGate', () => {
  test('refuses the prod project without the acknowledgement flag', () => {
    expect(() => assertProdGate({ projectId: 'live', prodProject: 'live', prodAcknowledged: false }))
      .toThrow(/--i-know-this-is-prod/);
  });

  test('allows the prod project with the flag', () => {
    expect(() => assertProdGate({ projectId: 'live', prodProject: 'live', prodAcknowledged: true })).not.toThrow();
  });

  test('allows any non-prod project', () => {
    expect(() => assertProdGate({ projectId: 'demo', prodProject: 'live', prodAcknowledged: false })).not.toThrow();
  });

  // FAIL CLOSED. If nothing declares which project is production, the panel
  // does not know that this one is not — and "we do not know" must resolve to
  // "assume production", never to "assume safe".
  test('an undeclared production project is treated as production', () => {
    expect(() => assertProdGate({ projectId: 'demo', prodProject: null, prodAcknowledged: false }))
      .toThrow(/--i-know-this-is-prod/);
  });

  test('an undeclared production project still runs with the acknowledgement', () => {
    expect(() => assertProdGate({ projectId: 'demo', prodProject: null, prodAcknowledged: true })).not.toThrow();
  });

  test('isProductionTarget is true for the declared prod project and for an undeclared one', () => {
    expect(isProductionTarget({ projectId: 'live', prodProject: 'live' })).toBe(true);
    expect(isProductionTarget({ projectId: 'demo', prodProject: null })).toBe(true);
    expect(isProductionTarget({ projectId: 'demo', prodProject: 'live' })).toBe(false);
  });
});

describe('requireConfirm', () => {
  test('rejects a body whose typed uid does not match', () => {
    expect(() => requireConfirm({ confirmUid: 'wrong', nonce: 'n1' }, 'right', 'n1')).toThrow(/confirm/i);
  });

  test('rejects a stale nonce', () => {
    expect(() => requireConfirm({ confirmUid: 'right', nonce: 'old' }, 'right', 'n1')).toThrow(/nonce/i);
  });

  test('accepts a matching uid and nonce', () => {
    expect(() => requireConfirm({ confirmUid: 'right', nonce: 'n1' }, 'right', 'n1')).not.toThrow();
  });

  test('rejects when no preview has been issued at all', () => {
    expect(() => requireConfirm({ confirmUid: 'right', nonce: 'n1' }, 'right', null)).toThrow(/nonce/i);
  });
});

// --- route harness ---------------------------------------------------------

/**
 * A fake audit fs that records the ORDER of every durability operation into a
 * shared event log, so the dump-then-write sequencing can be asserted against
 * the destructive update rather than assumed.
 */
function makeAuditFs(events) {
  /** @type {Record<string, string>} */
  const files = {};
  /** @type {Record<number, string>} */
  const openFds = {};
  let nextFd = 1;
  /** @type {Error | null} */
  let writeFailure = null;
  const fs = {
    mkdirSync: () => {},
    writeFileSync: (path, body, opts) => {
      if (writeFailure) throw writeFailure;
      if (opts && opts.flag === 'wx' && Object.prototype.hasOwnProperty.call(files, path)) {
        const err = new Error(`EEXIST: file already exists, open '${path}'`);
        err.code = 'EEXIST';
        throw err;
      }
      files[path] = body;
      events.push(`write:${path}`);
    },
    appendFileSync: (path, body) => {
      if (writeFailure) throw writeFailure;
      files[path] = (files[path] || '') + body;
      events.push(`append:${path}`);
    },
    openSync: (path) => { const fd = nextFd; nextFd += 1; openFds[fd] = path; return fd; },
    fsyncSync: (fd) => { events.push(`fsync:${openFds[fd]}`); },
    closeSync: (fd) => { delete openFds[fd]; },
  };
  return { fs, files, failWrites: (err) => { writeFailure = err; } };
}

const NOW = 1_750_000_000_000;

// Loser L / survivor S, lifted from ops-merge.test.js: every node carries real
// content because store-deps prunes `{}` to absent on read.
function world(extra = {}) {
  return {
    'users/L': {
      presence: { code: 'LLL111', status: 'unavailable', availableUntil: null, lastSeen: 9000 },
      followers: { shared: 'SHR001', onlyL: 'ONL001' },
      followerNames: { shared: 'Shared', onlyL: 'OnlyL' },
      groups: { g1: { lastVisited: 5000 }, g2: { lastVisited: 100 } },
      invites: { tokL: { redemptionsUsed: 2 } },
    },
    'users/S': {
      presence: { code: 'SSS222', status: 'unavailable', availableUntil: null, lastSeen: 1000 },
      followers: { shared: 'SHR001' },
      followerNames: { shared: 'Shared' },
      groups: { g1: { lastVisited: 200 } },
    },
    'users/shared': { presence: { code: 'SHR001' }, followers: { L: 'LLL111', S: 'SSS222' }, followerNames: { L: 'LoserPublished', S: 'SurvivorPublished' } },
    'users/onlyL': { presence: { code: 'ONL001' }, followers: { L: 'LLL111' }, followerNames: { L: 'LoserPublished' } },
    'userPrefs/L': {
      following: { shared: { code: 'SHR001', label: 'Shared' }, onlyL: { code: 'ONL001', label: 'Only L' } },
      favorites: ['loser-combo'],
      notifyChannel: 'push',
    },
    'userPrefs/S': {
      following: { shared: { code: 'SHR001', label: 'Shared (survivor)' } },
      favorites: ['survivor-combo'],
      notifyChannel: 'push',
    },
    'userPrefs/shared': { following: { L: { code: 'LLL111', label: 'the loser' }, S: { code: 'SSS222', label: 'the survivor' } } },
    'userPrefs/onlyL': { following: { L: { code: 'LLL111', label: 'my name for them' } } },
    'groups/g1': {
      name: 'Shared Group',
      ownerId: 'other',
      members: { L: { role: 'member', displayName: 'LoserName' }, S: { role: 'member', displayName: 'SurvivorName' }, other: { role: 'owner' } },
    },
    'groups/g2': { name: 'Loser Owns', ownerId: 'L', members: { L: { role: 'owner', displayName: 'LoserName' } } },
    'codeIndex/LLL111': 'L',
    'codeIndex/SSS222': 'S',
    'inviteIndex/tokL': { ownerPath: 'users/L/invites/tokL', ownerUid: 'L' },
    'pushTokens/L': { tokenL: { createdAt: 1, lastSeen: 9000 } },
    'pushTokens/S': { tokenS: { createdAt: 1, lastSeen: 1000 } },
    'knocks/L': { shared: { count: 1, ts: 500 } },
    'pendingInvites/L': { g3: { from: 'other', ts: 400 } },
    ...extra,
  };
}

const AUTH_USERS = [
  { uid: 'L', email: null, createdAt: 10 },
  { uid: 'S', email: null, createdAt: 20 },
  { uid: 'shared', email: null, createdAt: 30 },
  { uid: 'onlyL', email: null, createdAt: 40 },
];

function harness({ store = world(), canvasKeys = ['L_shared'], listCanvasKeys } = {}) {
  /** @type {string[]} */
  const events = [];
  const deps = makeStoreDeps(store);
  const rawUpdate = deps.update;
  deps.update = jest.fn(async (path, obj) => { events.push('rootUpdate'); return rawUpdate(path, obj); });
  deps.now = () => NOW;
  const io = {
    listCanvasKeys: listCanvasKeys || (async () => canvasKeys),
    listAuthUsers: async () => AUTH_USERS,
    now: () => NOW,
  };
  const opts = {
    projectId: 'demo',
    saJson: '{"x":1}',
    region: 'europe-west1',
    databaseURL: 'https://demo-default-rtdb.europe-west1.firebasedatabase.app',
    port: 8787,
    prodProject: 'live',
    prodAcknowledged: false,
    uidSecret: null,
    auditDir: '.audit',
  };
  const audit = makeAuditFs(events);
  const routes = createRoutes({ deps, io, opts, fs: audit.fs });
  return { routes, deps, events, audit, store, opts };
}

/** rootUpdate's projection, re-derived independently of the modules under test. */
function wirePayload(writes) {
  const keys = Object.keys(writes).sort();
  /** @type {Record<string, unknown>} */
  const kept = {};
  keys.forEach((key, i) => {
    const ancestor = keys.slice(0, i).reverse().find((k) => key.startsWith(`${k}/`));
    if (ancestor === undefined) kept[key] = writes[key];
  });
  return kept;
}

const preImageRecords = (audit) => Object.entries(audit.files)
  .filter(([path]) => path.endsWith('.json'))
  .map(([, body]) => JSON.parse(body));

const jsonlLines = (audit) => (audit.files['.audit/audit.jsonl'] || '')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('read routes', () => {
  test('GET /api/snapshot returns rows and the project banner state', async () => {
    const { routes } = harness();
    const res = await routes['GET /api/snapshot'](new URLSearchParams());
    expect(res.project).toBe('demo');
    expect(res.isProd).toBe(false);
    expect(res.rows.map((r) => r.uid).sort()).toEqual(['L', 'S', 'onlyL', 'shared']);
  });

  test('GET /api/detail returns the detail plus a nonce', async () => {
    const { routes } = harness();
    const res = await routes['GET /api/detail'](new URLSearchParams({ uid: 'L' }));
    expect(res.detail.uid).toBe('L');
    expect(res.detail.groups.map((g) => g.displayName)).toContain('LoserName');
    expect(typeof res.nonce).toBe('string');
  });

  test('GET /api/detail refuses an unknown uid', async () => {
    const { routes } = harness();
    await expect(routes['GET /api/detail'](new URLSearchParams({ uid: 'nope' }))).rejects.toThrow(/no account/);
  });

  test('GET /api/integrity renders findings', async () => {
    const { routes } = harness();
    const res = await routes['GET /api/integrity'](new URLSearchParams());
    expect(Array.isArray(res.findings)).toBe(true);
  });
});

// --- INHERITED REQUIREMENT 1 & 2 ------------------------------------------
describe('the pre-image dump is complete and flushed BEFORE the destructive write', () => {
  test('every audit file write and fsync happens before rootUpdate', async () => {
    const { routes, events } = harness();
    const { nonce } = await routes['POST /api/purge/preview']({ uid: 'L' });
    await routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'L', nonce });

    const at = events.indexOf('rootUpdate');
    expect(at).toBeGreaterThan(-1);
    const before = events.slice(0, at);
    // the pre-image file, fsynced
    expect(before.filter((e) => e.startsWith('write:.audit/'))).toHaveLength(1);
    expect(before.some((e) => e.startsWith('fsync:.audit/') && e.endsWith('.json'))).toBe(true);
    // the JSONL log, fsynced
    expect(before).toContain('append:.audit/audit.jsonl');
    expect(before).toContain('fsync:.audit/audit.jsonl');
    // the containing directory, fsynced
    expect(before).toContain('fsync:.audit');
    // the outcome line is the only thing that may land afterwards
    expect(events.slice(at + 1)).toEqual(expect.arrayContaining(['append:.audit/audit.jsonl']));
  });

  test('the pre-write record is marked pending and the outcome is appended after', async () => {
    const { routes, audit } = harness();
    const { nonce } = await routes['POST /api/purge/preview']({ uid: 'L' });
    await routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'L', nonce });

    expect(preImageRecords(audit)[0].outcome).toMatch(/pending/);
    const lines = jsonlLines(audit);
    expect(lines).toHaveLength(2);
    expect(lines[0].outcome).toMatch(/pending/);
    expect(lines[1].outcome).toBe('ok');
    expect(lines[1].preImageFile).toBe(lines[0].preImageFile);
  });

  test('a dump I/O failure is FATAL — the destructive write is never issued', async () => {
    const { routes, events, audit, deps, store } = harness();
    const { nonce } = await routes['POST /api/purge/preview']({ uid: 'L' });
    audit.failWrites(new Error('EIO: i/o error, write'));

    await expect(routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'L', nonce })).rejects.toThrow(/EIO/);
    expect(events).not.toContain('rootUpdate');
    expect(deps.update).not.toHaveBeenCalled();
    expect(store['users/L']).toBeDefined();
  });

  test('a failed apply is recorded as a failed outcome and rethrown', async () => {
    const { routes, deps, audit } = harness();
    const { nonce } = await routes['POST /api/purge/preview']({ uid: 'L' });
    deps.update = jest.fn(async () => { throw new Error('rtdb exploded'); });

    await expect(routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'L', nonce })).rejects.toThrow(/rtdb exploded/);
    const lines = jsonlLines(audit);
    expect(lines[lines.length - 1].outcome).toMatch(/^failed: .*rtdb exploded/);
  });
});

// --- INHERITED REQUIREMENT 3 ----------------------------------------------
describe('capturePreImage receives the FULL plan.writes key set', () => {
  test('the dump covers every previewed path, including the ones rootUpdate drops', async () => {
    const { routes, audit } = harness();
    const { plan, nonce } = await routes['POST /api/purge/preview']({ uid: 'L' });
    await routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'L', nonce });

    const dumped = Object.keys(preImageRecords(audit)[0].preImage).sort();
    expect(dumped).toEqual(Object.keys(plan.writes).sort());

    // and that is strictly more than the wire payload: the redundant
    // descendants rootUpdate drops are exactly the values that die silently.
    const payload = Object.keys(wirePayload(plan.writes));
    const dropped = dumped.filter((p) => !payload.includes(p));
    expect(dropped.length).toBeGreaterThan(0);
    for (const p of dropped) expect(dumped).toContain(p);
  });
});

// --- INHERITED REQUIREMENT 4 ----------------------------------------------
describe('snapshot.canvasKeys reaches purge and link-impact', () => {
  test('purge preview names the canvas by key rather than reporting it unenumerable', async () => {
    const { routes } = harness({ canvasKeys: ['L_shared'] });
    const { plan } = await routes['POST /api/purge/preview']({ uid: 'L' });
    expect(plan.losses.some((l) => l.includes('canvases/L_shared'))).toBe(true);
    expect(plan.losses.some((l) => l.includes('could not be enumerated'))).toBe(false);
  });

  test('link impact names the canvas by key rather than reporting it unenumerable', async () => {
    const { routes } = harness({ canvasKeys: ['L_shared'] });
    const impact = await routes['POST /api/link/impact']({ derivedUid: 'L' });
    expect(impact.losses.some((l) => l.includes('canvases/L_shared'))).toBe(true);
    expect(impact.losses.some((l) => l.includes('could not be enumerated'))).toBe(false);
  });

  test('an empty key list asserts "no canvases" — no canvas loss line at all', async () => {
    const { routes } = harness({ canvasKeys: [] });
    const { plan } = await routes['POST /api/purge/preview']({ uid: 'L' });
    expect(plan.losses.some((l) => l.includes('canvas'))).toBe(false);
  });
});

// --- INHERITED REQUIREMENT 5 ----------------------------------------------
describe('canvasKeys omitted vs empty are different facts', () => {
  const failing = async () => { throw new Error('shallow canvases read failed: 503'); };

  test('an unreadable key list degrades loudly instead of taking the panel down', async () => {
    const { routes } = harness({ listCanvasKeys: failing });
    const res = await routes['GET /api/snapshot'](new URLSearchParams());
    expect(res.canvasKeys.examined).toBe(false);
    expect(res.canvasKeys.count).toBeNull();
    expect(res.canvasKeys.error).toMatch(/503/);
  });

  test('an empty key list is reported as examined with a count of zero', async () => {
    const { routes } = harness({ canvasKeys: [] });
    const res = await routes['GET /api/snapshot'](new URLSearchParams());
    expect(res.canvasKeys).toEqual({ examined: true, count: 0, error: null });
  });

  test('detail carries the same distinction', async () => {
    const examined = await harness({ canvasKeys: [] }).routes['GET /api/detail'](new URLSearchParams({ uid: 'L' }));
    expect(examined.canvasKeys.examined).toBe(true);
    const unknown = await harness({ listCanvasKeys: failing }).routes['GET /api/detail'](new URLSearchParams({ uid: 'L' }));
    expect(unknown.canvasKeys.examined).toBe(false);
  });

  test('a not-examined list is passed to purge as UNDEFINED, so the loss report says so', async () => {
    const { routes } = harness({ listCanvasKeys: failing });
    const { plan, canvasKeys } = await routes['POST /api/purge/preview']({ uid: 'L' });
    expect(canvasKeys.examined).toBe(false);
    expect(plan.losses.some((l) => l.includes('could not be enumerated'))).toBe(true);
  });

  test('a not-examined list makes link impact lossy rather than safe', async () => {
    const { routes } = harness({ listCanvasKeys: failing });
    const impact = await routes['POST /api/link/impact']({ derivedUid: 'L' });
    expect(impact.canvasKeys.examined).toBe(false);
    expect(impact.losses.some((l) => l.includes('could not be enumerated'))).toBe(true);
  });

  test('the panel renders the two states with different text', () => {
    const page = readFileSync(join(OPS_DIR, 'panel.html'), 'utf8');
    // "no canvases" and "not examined" must not share a rendering.
    expect(page).toContain('not examined');
    expect(page).toMatch(/canvasKeys\.examined/);
    // the table cell branches on it too, not just a banner
    expect(page).toMatch(/canvasCell/);
  });
});

// --- confirmation, nonces --------------------------------------------------
describe('every execute route is gated', () => {
  test('purge execute refuses a mistyped uid', async () => {
    const { routes, events } = harness();
    const { nonce } = await routes['POST /api/purge/preview']({ uid: 'L' });
    await expect(routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'l', nonce })).rejects.toThrow(/confirm/i);
    expect(events).not.toContain('rootUpdate');
  });

  test('purge execute refuses a stale nonce', async () => {
    const { routes, events } = harness();
    await routes['POST /api/purge/preview']({ uid: 'L' });
    await expect(routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'L', nonce: 'stale' })).rejects.toThrow(/nonce/i);
    expect(events).not.toContain('rootUpdate');
  });

  test('purge execute refuses with no preview at all', async () => {
    const { routes } = harness();
    await expect(routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'L', nonce: 'n1-L' })).rejects.toThrow(/nonce/i);
  });

  test('a nonce is single-use', async () => {
    const { routes } = harness();
    const { nonce } = await routes['POST /api/purge/preview']({ uid: 'L' });
    await routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'L', nonce });
    await expect(routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'L', nonce })).rejects.toThrow(/nonce/i);
  });

  test('merge execute is gated on the loser uid', async () => {
    const { routes, events } = harness();
    await routes['POST /api/merge/preview']({ loserUid: 'L', survivorUid: 'S' });
    await expect(routes['POST /api/merge/execute']({ loserUid: 'L', survivorUid: 'S', confirmUid: 'S', nonce: 'x' }))
      .rejects.toThrow(/confirm|nonce/i);
    expect(events).not.toContain('rootUpdate');
  });
});

// --- R6: one options block for preview and execute -------------------------
describe('merge preview and execute cannot drift', () => {
  test('execute applies exactly the write-set the preview showed', async () => {
    const a = harness();
    const preview = await a.routes['POST /api/merge/preview']({ loserUid: 'L', survivorUid: 'S', adoptGroupNames: ['Loser Owns'], telegramRepoint: false });
    await a.routes['POST /api/merge/execute']({
      loserUid: 'L', survivorUid: 'S', adoptGroupNames: ['Loser Owns'], telegramRepoint: false, confirmUid: 'L', nonce: preview.nonce,
    });
    const dumped = Object.keys(preImageRecords(a.audit)[0].preImage).sort();
    expect(dumped).toEqual(Object.keys(preview.plan.writes).sort());
  });

  // adoptGroupNames keys on the GID and changes a VALUE, not the key set, so
  // an execute that dropped it would look identical by path and write a
  // different name into a shared group. This is the drift R6 exists to stop.
  test('adoptGroupNames reaches the executed plan, not just the preview', async () => {
    const withAdopt = harness();
    const p1 = await withAdopt.routes['POST /api/merge/preview']({ loserUid: 'L', survivorUid: 'S', adoptGroupNames: ['g1'] });
    const p2 = await harness().routes['POST /api/merge/preview']({ loserUid: 'L', survivorUid: 'S' });
    expect(p1.plan.writes['groups/g1/members/S/displayName']).toBe('LoserName');
    expect(p2.plan.writes['groups/g1/members/S/displayName']).toBeUndefined();

    await withAdopt.routes['POST /api/merge/execute']({
      loserUid: 'L', survivorUid: 'S', adoptGroupNames: ['g1'], confirmUid: 'L', nonce: p1.nonce,
    });
    expect(withAdopt.store['groups/g1/members/S/displayName']).toBe('LoserName');
    expect(Object.keys(preImageRecords(withAdopt.audit)[0].preImage).sort())
      .toEqual(Object.keys(p1.plan.writes).sort());
  });

  test('a merge execute actually mutates and invalidates the cached snapshot', async () => {
    const { routes, store } = harness();
    const { nonce } = await routes['POST /api/merge/preview']({ loserUid: 'L', survivorUid: 'S' });
    const res = await routes['POST /api/merge/execute']({ loserUid: 'L', survivorUid: 'S', confirmUid: 'L', nonce });
    expect(res.ok).toBe(true);
    expect(store['users/L']).toBeNull();
    const snap = await routes['GET /api/snapshot'](new URLSearchParams());
    expect(snap.rows.map((r) => r.uid)).not.toContain('L');
  });
});

// --- the bind address ------------------------------------------------------
describe('the HTTP server', () => {
  test('BIND_ADDRESS is the loopback address', () => {
    expect(BIND_ADDRESS).toBe('127.0.0.1');
  });

  test('server.js never mentions the wildcard address', () => {
    expect(readFileSync(join(OPS_DIR, 'server.js'), 'utf8')).not.toContain('0.0.0.0');
  });

  test('the listening socket is bound to 127.0.0.1 only, and serves the page and the routes', async () => {
    const { routes } = harness();
    const server = createHttpServer({ routes, page: '<h1>panel</h1>' });
    await new Promise((resolve) => { server.listen(0, BIND_ADDRESS, () => resolve(undefined)); });
    try {
      const addr = server.address();
      expect(addr.address).toBe('127.0.0.1');

      const base = `http://127.0.0.1:${addr.port}`;
      const page = await fetch(`${base}/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toBe('<h1>panel</h1>');

      const snap = await (await fetch(`${base}/api/snapshot`)).json();
      expect(snap.project).toBe('demo');

      const missing = await fetch(`${base}/api/nope`);
      expect(missing.status).toBe(404);

      const bad = await fetch(`${base}/api/detail?uid=nope`);
      expect(bad.status).toBe(400);
      expect((await bad.json()).error).toMatch(/no account/);

      const preview = await fetch(`${base}/api/purge/preview`, { method: 'POST', body: JSON.stringify({ uid: 'L' }) });
      expect((await preview.json()).nonce).toBeTruthy();

      const malformed = await fetch(`${base}/api/purge/preview`, { method: 'POST', body: '{not json' });
      expect(malformed.status).toBe(400);
    } finally {
      await new Promise((resolve) => { server.close(() => resolve(undefined)); });
    }
  });
});
