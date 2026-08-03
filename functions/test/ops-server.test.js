import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { jest } from '@jest/globals';
import { makeStoreDeps } from './store-deps.js';
import {
  parseArgs,
  withEnvFile,
  assertProdGate,
  isProductionTarget,
  requireConfirm,
  createRoutes,
  createHttpServer,
  originRefusal,
  BIND_ADDRESS,
  ALLOWED_HOSTS,
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

// The panel is a plain `node ops/server.js`, not a Firebase CLI invocation, so
// nothing auto-loads functions/.env — yet that file is exactly where
// functions/.env.example tells the operator TELEGRAM_UID_SECRET lives. Reading
// it here closes that gap. It stays SCOPED to the two variables the panel
// documents: this process holds a database-admin credential, and a dotenv file
// that can set arbitrary variables in it is a wider blast radius than the
// problem being fixed.
describe('withEnvFile', () => {
  test('supplies a panel variable the process environment does not have', () => {
    const { env } = withEnvFile({}, 'TELEGRAM_UID_SECRET=from-file');
    expect(env.TELEGRAM_UID_SECRET).toBe('from-file');
  });

  // The inline prefix is how the README and the smoke test both invoke this,
  // and it is how an operator points one run at a different project. A file on
  // disk must never quietly beat what the operator typed.
  test('the process environment wins over the file', () => {
    const { env } = withEnvFile({ TELEGRAM_UID_SECRET: 'inline' }, 'TELEGRAM_UID_SECRET=from-file');
    expect(env.TELEGRAM_UID_SECRET).toBe('inline');
  });

  // Same reasoning as the prod-project gate above: '' is an unparseable
  // environment, not a declaration, so the file is still the better answer.
  test('an empty or whitespace inline value does not beat the file', () => {
    expect(withEnvFile({ TELEGRAM_UID_SECRET: '' }, 'TELEGRAM_UID_SECRET=from-file').env.TELEGRAM_UID_SECRET)
      .toBe('from-file');
    expect(withEnvFile({ TELEGRAM_UID_SECRET: '  ' }, 'TELEGRAM_UID_SECRET=from-file').env.TELEGRAM_UID_SECRET)
      .toBe('from-file');
  });

  test('ignores variables outside the panel scope', () => {
    const { env } = withEnvFile({}, 'TELEGRAM_BOT_TOKEN=123:secret\nFUNCTIONS_REGION=us-central1');
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(env.FUNCTIONS_REGION).toBeUndefined();
  });

  test('ignores comments and blank lines', () => {
    const { env } = withEnvFile({}, '# TELEGRAM_UID_SECRET=commented-out\n\n   \nTELEGRAM_UID_SECRET=real');
    expect(env.TELEGRAM_UID_SECRET).toBe('real');
  });

  test('strips surrounding quotes but keeps the value intact', () => {
    expect(withEnvFile({}, 'TELEGRAM_UID_SECRET="quoted"').env.TELEGRAM_UID_SECRET).toBe('quoted');
    expect(withEnvFile({}, "TELEGRAM_UID_SECRET='quoted'").env.TELEGRAM_UID_SECRET).toBe('quoted');
  });

  // A secret is an arbitrary byte string. Anything that looks like dotenv
  // syntax inside it — '#', '=' — is part of the secret, not markup, and
  // trimming it would derive every Telegram uid wrong while looking healthy.
  test('does not treat # or = inside a value as syntax', () => {
    expect(withEnvFile({}, 'TELEGRAM_UID_SECRET=a#b=c').env.TELEGRAM_UID_SECRET).toBe('a#b=c');
  });

  test('names which variables came from the file, so startup can say so', () => {
    const { loaded } = withEnvFile(
      { GOOGLE_APPLICATION_CREDENTIALS_JSON: '{"x":1}' },
      'TELEGRAM_UID_SECRET=from-file\nGOOGLE_APPLICATION_CREDENTIALS_JSON={"y":2}',
    );
    expect(loaded).toEqual(['TELEGRAM_UID_SECRET']);
  });

  test('a missing file changes nothing', () => {
    const { env, loaded } = withEnvFile({ TELEGRAM_UID_SECRET: 'inline' }, null);
    expect(env.TELEGRAM_UID_SECRET).toBe('inline');
    expect(loaded).toEqual([]);
  });

  test('does not mutate the environment it was handed', () => {
    const original = {};
    withEnvFile(original, 'TELEGRAM_UID_SECRET=from-file');
    expect(original.TELEGRAM_UID_SECRET).toBeUndefined();
  });

  // The whole point of the change: the value reaches parseArgs, so the panel
  // stops reporting "unset" for a secret the operator did set.
  test('a file-supplied secret reaches parseArgs', () => {
    const { env } = withEnvFile(
      { GOOGLE_APPLICATION_CREDENTIALS_JSON: '{"x":1}' },
      'TELEGRAM_UID_SECRET=from-file',
    );
    expect(parseArgs(['--project', 'demo'], env).uidSecret).toBe('from-file');
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
  /** @type {Error | null} */
  let appendFailure = null;
  let appendsBeforeFailure = 0;
  let appends = 0;
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
      appends += 1;
      if (appendFailure && appends > appendsBeforeFailure) throw appendFailure;
      files[path] = (files[path] || '') + body;
      events.push(`append:${path}`);
    },
    openSync: (path) => { const fd = nextFd; nextFd += 1; openFds[fd] = path; return fd; },
    fsyncSync: (fd) => { events.push(`fsync:${openFds[fd]}`); },
    closeSync: (fd) => { delete openFds[fd]; },
  };
  return {
    fs,
    files,
    failWrites: (err) => { writeFailure = err; },
    // writeAuditRecord appends the `pending` line first; appendAuditOutcome
    // appends the resolution second. failAppendsAfter(1) therefore breaks the
    // OUTCOME append only, leaving the pre-image dump intact.
    failAppendsAfter: (n, err) => { appendsBeforeFailure = n; appendFailure = err; },
  };
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

// A purge that leaves the account's session alive does not stick: the client
// keeps its cached state and republishes it into the database the purge just
// cleared (observed on dev, 2026-08-02 — userPrefs/{uid} came back holding the
// same `following` keys and none of the other fields). So the routes need an
// Admin-SDK auth handle, and the stub records call ORDER alongside the write.
function makeAuthStub(events, { failRevoke = false, failDelete = false, noAuthRecord = false, record = { uid: 'L', email: 'l@example.com', metadata: { creationTime: '2026-01-01T00:00:00Z' } } } = {}) {
  return {
    revokeRefreshTokens: jest.fn(async (uid) => {
      events.push(`revoke:${uid}`);
      // What the real SDK throws for a uid Firebase Auth has never seen. The
      // message is the one an operator reads on the panel, so it is verbatim.
      if (noAuthRecord) {
        throw Object.assign(
          new Error('There is no user record corresponding to the provided identifier.'),
          { code: 'auth/user-not-found' },
        );
      }
      if (failRevoke) throw new Error('revoke boom');
    }),
    getUser: jest.fn(async (uid) => {
      events.push(`getUser:${uid}`);
      if (!record) throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
      return record;
    }),
    deleteUser: jest.fn(async (uid) => {
      events.push(`deleteUser:${uid}`);
      if (failDelete) throw new Error('delete boom');
    }),
  };
}

function harness({
  store = world(), canvasKeys = ['L_shared'], listCanvasKeys, auth: authOverride, omitAuth = false,
} = {}) {
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
  const auth = omitAuth ? undefined : (authOverride || makeAuthStub(events));
  const routes = createRoutes({ deps, io, opts, fs: audit.fs, auth });
  return { routes, deps, events, audit, store, opts, auth };
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

// A purge deletes database state. It did NOT, until now, do anything about the
// session holding that state: the Auth record survives (G2/D5), its custom-token
// session stays valid, and the client republishes its cache into the nodes the
// purge just cleared. Rules allow that session to write users/{uid},
// userPrefs/{uid} AND its own rows in every peer's followers/followerNames, so
// the resurrection reaches cross-user residue too.
describe('purge ends the purged account\'s session', () => {
  test('refresh tokens are revoked BEFORE the destructive write, closing the race', async () => {
    const { routes, events, auth } = harness();
    const { nonce } = await routes['POST /api/purge/preview']({ uid: 'L' });
    await routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'L', nonce });

    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('L');
    // Order is the point: a revoke after the write leaves a window in which the
    // client can put back exactly what was just deleted.
    expect(events.indexOf('revoke:L')).toBeLessThan(events.indexOf('rootUpdate'));
  });

  // Fail closed. A purge whose session cannot be ended does not stick, and a
  // tool that reports success for a write the client will undo is worse than
  // one that refuses.
  test('a revoke failure refuses the purge, and nothing is written', async () => {
    /** @type {string[]} */
    const evs = [];
    const h = harness({ auth: makeAuthStub(evs, { failRevoke: true }) });
    const { nonce } = await h.routes['POST /api/purge/preview']({ uid: 'L' });
    await expect(h.routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'L', nonce }))
      .rejects.toThrow(/revoke/i);
    expect(h.events).not.toContain('rootUpdate');
  });

  // G8, found on dev 2026-08-03. The revoke was unguarded, so a uid Firebase
  // Auth has never seen — every account ops/seed-merge-fixture.js writes, and
  // every synthetic account the runbook tells you to seed — aborted the purge
  // before it wrote anything. That refuses the SAFEST case: no Auth record means
  // no session, so there is nothing to outlive the write and nothing to republish
  // its cache. It also made the one documented mitigation for G3 and G6 —
  // purge accounts no client ever held — impossible to carry out through the
  // panel. server.js:525 already applies this principle to the Auth DELETE
  // ("already absent is not a failure"); the revoke never got it.
  test('an account with no Auth record is purged, not refused — there is no session to end', async () => {
    /** @type {string[]} */
    const evs = [];
    const h = harness({ auth: makeAuthStub(evs, { noAuthRecord: true }) });
    const { nonce } = await h.routes['POST /api/purge/preview']({ uid: 'L' });
    const res = await h.routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'L', nonce });

    expect(h.events).toContain('rootUpdate');
    // And it is not silent: an operator who sees no revocation must be told why,
    // or "the session was ended" is a claim nobody made and everybody assumes.
    expect(res.sessionNote).toMatch(/no auth record/i);
  });

  // The allowlist is the point — only user-not-found is benign. Anything else is
  // a revoke that SHOULD have worked and did not, which is the G2 case.
  test('a revoke that fails for any other reason still refuses, and nothing is written', async () => {
    /** @type {string[]} */
    const evs = [];
    const auth = makeAuthStub(evs, {});
    auth.revokeRefreshTokens = jest.fn(async () => {
      throw Object.assign(new Error('backend unavailable'), { code: 'auth/internal-error' });
    });
    const h = harness({ auth });
    const { nonce } = await h.routes['POST /api/purge/preview']({ uid: 'L' });
    await expect(h.routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'L', nonce }))
      .rejects.toThrow(/revoke|session/i);
    expect(h.events).not.toContain('rootUpdate');
  });

  // Ticking the box on an RTDB-only account is now reachable, so it has to
  // behave: there is no record to delete, and calling deleteUser anyway would
  // fail and print "the Auth record could not be deleted" — a false alarm about
  // a record that never existed, on exactly the accounts G8 unblocks.
  test('deleting the Auth record of an account that has none is a no-op, not a warning', async () => {
    /** @type {string[]} */
    const evs = [];
    const h = harness({ auth: makeAuthStub(evs, { noAuthRecord: true, record: null }) });
    const { nonce } = await h.routes['POST /api/purge/preview']({ uid: 'L' });
    const res = await h.routes['POST /api/purge/execute']({
      uid: 'L', confirmUid: 'L', nonce, deleteAuthRecord: true,
    });

    expect(h.events).toContain('rootUpdate');
    // `evs` is the AUTH stub's log; h.events is the store's. Asserting the
    // absence of an auth call against the store's array passes vacuously.
    expect(evs).toContain('revoke:L');
    expect(evs.some((e) => e.startsWith('deleteUser:'))).toBe(false);
    expect(res.authWarning).toBeUndefined();
    expect(res.sessionNote).toMatch(/no auth record/i);
  });

  // The route returning a note is worth nothing if the page never shows it —
  // the same "tested the function, never checked the wiring" shape the ops/**
  // import guard hit twice. panel.html has no DOM harness, so this is a source
  // check: weak, but it fails when someone adds a field the page ignores.
  test('panel.html surfaces the session note rather than dropping it', () => {
    const page = readFileSync(new URL('../ops/panel.html', import.meta.url), 'utf8');
    expect(page).toMatch(/res\.sessionNote/);
  });

  test('a purge that DID revoke says nothing about a missing record', async () => {
    const { routes } = harness();
    const { nonce } = await routes['POST /api/purge/preview']({ uid: 'L' });
    const res = await routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'L', nonce });
    expect(res.sessionNote).toBeUndefined();
  });

  test('purge refuses outright when no auth handle is wired', async () => {
    const { routes, events } = harness({ omitAuth: true });
    const { nonce } = await routes['POST /api/purge/preview']({ uid: 'L' });
    await expect(routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'L', nonce }))
      .rejects.toThrow(/auth/i);
    expect(events).not.toContain('rootUpdate');
  });
});

// D5, opt-in. Deleting an Auth record is the one destruction the pre-image
// cannot cover — a dumped RTDB subtree can be replayed, a deleted Auth user
// cannot — so it is off by default and never implied by the purge confirm.
describe('purge --delete-auth-record (opt in)', () => {
  test('the Auth record is NOT deleted by default', async () => {
    const { routes, auth } = harness();
    const { nonce } = await routes['POST /api/purge/preview']({ uid: 'L' });
    await routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'L', nonce });
    expect(auth.deleteUser).not.toHaveBeenCalled();
  });

  test('the flag deletes it, AFTER the recoverable write has succeeded', async () => {
    const { routes, events, auth } = harness();
    const { nonce } = await routes['POST /api/purge/preview']({ uid: 'L' });
    const res = await routes['POST /api/purge/execute']({
      uid: 'L', confirmUid: 'L', nonce, deleteAuthRecord: true,
    });

    expect(auth.deleteUser).toHaveBeenCalledWith('L');
    // Irreversible last: if the RTDB write fails there is nothing to be sorry
    // about, and the pre-image still describes a live account.
    expect(events.indexOf('deleteUser:L')).toBeGreaterThan(events.indexOf('rootUpdate'));
    expect(res.authRecordDeleted).toBe(true);
  });

  // No pre-image can restore an Auth record, so the fields that identify it are
  // read and recorded before it goes.
  test('the Auth identity is captured before the delete', async () => {
    const { routes, events, auth } = harness();
    const { nonce } = await routes['POST /api/purge/preview']({ uid: 'L' });
    await routes['POST /api/purge/execute']({
      uid: 'L', confirmUid: 'L', nonce, deleteAuthRecord: true,
    });
    expect(auth.getUser).toHaveBeenCalledWith('L');
    expect(events.indexOf('getUser:L')).toBeLessThan(events.indexOf('deleteUser:L'));
  });

  // Same rule as the audit-outcome append: past the write, nothing may turn a
  // completed purge into a failed request.
  test('a delete failure warns rather than reporting the purge as failed', async () => {
    /** @type {string[]} */
    const evs = [];
    const h = harness({ auth: makeAuthStub(evs, { failDelete: true }) });
    const { nonce } = await h.routes['POST /api/purge/preview']({ uid: 'L' });
    const res = await h.routes['POST /api/purge/execute']({
      uid: 'L', confirmUid: 'L', nonce, deleteAuthRecord: true,
    });
    expect(res.authRecordDeleted).toBe(false);
    expect(res.authWarning).toMatch(/delete boom/);
    expect(h.events).toContain('rootUpdate');
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

  // panel.html cannot be imported, so these are source assertions — the only
  // reachable check that the page did not keep a private copy of a rule. The
  // behaviour itself is covered in ops-project/ops-format.
  test('the panel formats no durations of its own', () => {
    const page = readFileSync(join(OPS_DIR, 'panel.html'), 'utf8');
    // The old inline formatter, and the two raw-seconds renders beside it.
    expect(page).not.toMatch(/\/\s*60000/);
    expect(page).not.toMatch(/fixAge\s*\/\s*1000/);
    expect(page).toMatch(/createdAtLabel/);
    expect(page).toMatch(/lastSeenLabel/);
    expect(page).toMatch(/fixAgeLabel/);
  });

  // The bug the operator hit: a table full of accounts reading "available"
  // that had not been seen in weeks. The cell must render the computed label,
  // never the stored string.
  test('the status cell renders the computed label, not the stored status', () => {
    const page = readFileSync(join(OPS_DIR, 'panel.html'), 'utf8');
    expect(page).toMatch(/statusLabel/);
    expect(page).not.toMatch(/esc\(r\.status\b/);
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

// --- FINDING 1: unguessable nonces ----------------------------------------
describe('nonces', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  test('a nonce is a random UUID, not derivable from the uid', async () => {
    const { routes } = harness();
    const a = await routes['POST /api/purge/preview']({ uid: 'L' });
    expect(a.nonce).toMatch(UUID);
    expect(a.nonce).not.toContain('L');
    const b = await routes['POST /api/purge/preview']({ uid: 'L' });
    expect(b.nonce).not.toBe(a.nonce);
  });

  test('two servers do not share a nonce sequence', async () => {
    const a = await harness().routes['POST /api/purge/preview']({ uid: 'L' });
    const b = await harness().routes['POST /api/purge/preview']({ uid: 'L' });
    expect(a.nonce).not.toBe(b.nonce);
  });
});

// --- FINDING 2: the executed plan must be the approved plan -----------------
describe('an execute must apply the plan the operator approved', () => {
  test('an unchanged plan proceeds', async () => {
    const { routes, store } = harness();
    const { nonce } = await routes['POST /api/purge/preview']({ uid: 'L' });
    const res = await routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'L', nonce });
    expect(res.ok).toBe(true);
    expect(store['users/L']).toBeNull();
  });

  test('a plan that diverged after the preview is REFUSED and writes nothing', async () => {
    const { routes, store, events, deps } = harness();
    const { nonce } = await routes['POST /api/purge/preview']({ uid: 'L' });

    // someone follows L between the preview and the execute: a new contact
    // loss and a new write path the operator never read
    store['users/newPeer'] = { presence: { code: 'NEW001' }, followers: { L: 'LLL111' } };
    store['userPrefs/newPeer'] = { following: { L: { code: 'LLL111', label: 'L' } } };
    store['users/L'].followers.newPeer = 'NEW001';

    await expect(routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'L', nonce }))
      .rejects.toThrow(/the plan you approved is not the plan this would apply/);
    expect(events).not.toContain('rootUpdate');
    expect(deps.update).not.toHaveBeenCalled();
    expect(store['users/L']).toBeDefined();
  });

  test('the refusal names what changed and tells the operator to preview again', async () => {
    const { routes, store } = harness();
    const { nonce } = await routes['POST /api/purge/preview']({ uid: 'L' });
    store['users/newPeer'] = { presence: { code: 'NEW001' }, followers: { L: 'LLL111' } };
    store['userPrefs/newPeer'] = { following: { L: { code: 'LLL111', label: 'L' } } };
    store['users/L'].followers.newPeer = 'NEW001';

    await expect(routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'L', nonce }))
      .rejects.toThrow(/Preview again[\s\S]*newPeer/);
  });

  test('a merge whose plan diverged is refused too', async () => {
    const { routes, events, store } = harness();
    const { nonce } = await routes['POST /api/merge/preview']({ loserUid: 'L', survivorUid: 'S' });
    store['users/L'].groups.g3 = { lastVisited: 1 };
    store['groups/g3'] = { name: 'New Group', ownerId: 'other', members: { L: { role: 'member' }, other: { role: 'owner' } } };

    await expect(routes['POST /api/merge/execute']({ loserUid: 'L', survivorUid: 'S', confirmUid: 'L', nonce }))
      .rejects.toThrow(/not the plan this would apply/);
    expect(events).not.toContain('rootUpdate');
  });

  // A GET /api/detail nonce authorises no plan at all; spec §3.1 keys nonces by
  // uid, so without this it would have carried a purge through.
  test('a nonce from a detail view cannot execute anything', async () => {
    const { routes, events } = harness();
    const { nonce } = await routes['GET /api/detail'](new URLSearchParams({ uid: 'L' }));
    await expect(routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'L', nonce }))
      .rejects.toThrow(/did not come from a preview/);
    expect(events).not.toContain('rootUpdate');
  });
});

// --- FINDING 3: the production-link route gets the same treatment ----------
const LINKED = (extra = {}) => world({
  'telegramByUid/L': { tgId: '55', chatId: '99' },
  'telegramUsers/55': { uid: 'L', chatId: '99', createdAt: 7 },
  ...extra,
});

describe('POST /api/link/production/execute', () => {
  const linkHarness = () => harness({ store: LINKED() });

  test('previews, then executes, and destroys the derived account', async () => {
    const { routes, store } = linkHarness();
    const { plan, nonce } = await routes['POST /api/link/production/preview']({ derivedUid: 'L', phraseUid: 'S' });
    expect(plan.writes['telegramUsers/55']).toEqual({ uid: 'S', chatId: '99', linkedAt: NOW });
    const res = await routes['POST /api/link/production/execute']({ derivedUid: 'L', phraseUid: 'S', confirmUid: 'L', nonce });
    expect(res.ok).toBe(true);
    expect(store['users/L']).toBeNull();
    expect(store['telegramUsers/55']).toEqual({ uid: 'S', chatId: '99', linkedAt: NOW });
  });

  test('dumps and flushes the pre-image BEFORE the destructive write', async () => {
    const { routes, events } = linkHarness();
    const { nonce } = await routes['POST /api/link/production/preview']({ derivedUid: 'L', phraseUid: 'S' });
    await routes['POST /api/link/production/execute']({ derivedUid: 'L', phraseUid: 'S', confirmUid: 'L', nonce });

    const at = events.indexOf('rootUpdate');
    expect(at).toBeGreaterThan(-1);
    const before = events.slice(0, at);
    expect(before.filter((e) => e.startsWith('write:.audit/'))).toHaveLength(1);
    expect(before.some((e) => e.startsWith('fsync:.audit/') && e.endsWith('.json'))).toBe(true);
    expect(before).toContain('append:.audit/audit.jsonl');
    expect(before).toContain('fsync:.audit/audit.jsonl');
    expect(before).toContain('fsync:.audit');
  });

  test('a dump I/O failure is FATAL on this route too', async () => {
    const { routes, events, audit, deps, store } = linkHarness();
    const { nonce } = await routes['POST /api/link/production/preview']({ derivedUid: 'L', phraseUid: 'S' });
    audit.failWrites(new Error('EIO: i/o error, write'));
    await expect(routes['POST /api/link/production/execute']({ derivedUid: 'L', phraseUid: 'S', confirmUid: 'L', nonce }))
      .rejects.toThrow(/EIO/);
    expect(events).not.toContain('rootUpdate');
    expect(deps.update).not.toHaveBeenCalled();
    expect(store['users/L']).toBeDefined();
  });

  test('the dump covers the FULL plan.writes key set, including dropped descendants', async () => {
    const { routes, audit } = linkHarness();
    const { plan, nonce } = await routes['POST /api/link/production/preview']({ derivedUid: 'L', phraseUid: 'S' });
    await routes['POST /api/link/production/execute']({ derivedUid: 'L', phraseUid: 'S', confirmUid: 'L', nonce });
    const dumped = Object.keys(preImageRecords(audit)[0].preImage).sort();
    expect(dumped).toEqual(Object.keys(plan.writes).sort());
    const payload = Object.keys(wirePayload(plan.writes));
    expect(dumped.filter((p) => !payload.includes(p)).length).toBeGreaterThan(0);
  });

  test('snapshot.canvasKeys reaches buildProductionLinkPlan', async () => {
    const named = await harness({ store: LINKED(), canvasKeys: ['L_shared'] })
      .routes['POST /api/link/production/preview']({ derivedUid: 'L', phraseUid: 'S' });
    expect(named.plan.losses.some((l) => l.includes('canvases/L_shared'))).toBe(true);

    const unknown = await harness({ store: LINKED(), listCanvasKeys: async () => { throw new Error('503'); } })
      .routes['POST /api/link/production/preview']({ derivedUid: 'L', phraseUid: 'S' });
    expect(unknown.canvasKeys.examined).toBe(false);
    expect(unknown.plan.losses.some((l) => l.includes('could not be enumerated'))).toBe(true);
  });

  // R6 for linkOptions: preview and execute must build the same arguments, and
  // a phraseUid swapped between them must not quietly go through.
  test('linkOptions is shared — the executed plan matches the previewed one', async () => {
    const { routes, audit } = linkHarness();
    const { plan, nonce } = await routes['POST /api/link/production/preview']({ derivedUid: 'L', phraseUid: 'S' });
    await routes['POST /api/link/production/execute']({ derivedUid: 'L', phraseUid: 'S', confirmUid: 'L', nonce });
    expect(Object.keys(preImageRecords(audit)[0].preImage).sort()).toEqual(Object.keys(plan.writes).sort());
  });

  test('a phraseUid swapped between preview and execute is refused', async () => {
    const { routes, events } = harness({
      store: LINKED({ 'users/other': { presence: { code: 'OTH001', lastSeen: 1 } } }),
    });
    const { nonce } = await routes['POST /api/link/production/preview']({ derivedUid: 'L', phraseUid: 'S' });
    await expect(routes['POST /api/link/production/execute']({ derivedUid: 'L', phraseUid: 'other', confirmUid: 'L', nonce }))
      .rejects.toThrow(/not the plan this would apply/);
    expect(events).not.toContain('rootUpdate');
  });

  test('is gated on the derived uid and a nonce', async () => {
    const { routes, events } = linkHarness();
    const { nonce } = await routes['POST /api/link/production/preview']({ derivedUid: 'L', phraseUid: 'S' });
    await expect(routes['POST /api/link/production/execute']({ derivedUid: 'L', phraseUid: 'S', confirmUid: 'S', nonce }))
      .rejects.toThrow(/confirm/i);
    await expect(routes['POST /api/link/production/execute']({ derivedUid: 'L', phraseUid: 'S', confirmUid: 'L', nonce: 'x' }))
      .rejects.toThrow(/nonce/i);
    expect(events).not.toContain('rootUpdate');
  });
});

// --- FINDING 4: a completed write is never reported as a failure ------------
describe('an outcome-append failure does not mis-report a completed write', () => {
  test('the operation still succeeds, loudly, when the outcome line cannot be written', async () => {
    const { routes, audit, store } = harness();
    const { nonce } = await routes['POST /api/purge/preview']({ uid: 'L' });
    audit.failAppendsAfter(1, new Error('ENOSPC: no space left on device, write'));

    const res = await routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'L', nonce });
    expect(res.ok).toBe(true);
    expect(res.auditWarning).toMatch(/THE WRITE SUCCEEDED/);
    expect(res.auditWarning).toMatch(/ENOSPC/);
    // the write really did land, and the panel is not still serving stale rows
    expect(store['users/L']).toBeNull();
    const snap = await routes['GET /api/snapshot'](new URLSearchParams());
    expect(snap.rows.map((r) => r.uid)).not.toContain('L');
  });

  test('a successful operation reports no warning', async () => {
    const { routes } = harness();
    const { nonce } = await routes['POST /api/purge/preview']({ uid: 'L' });
    expect((await routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'L', nonce })).auditWarning).toBeNull();
  });

  test('an outcome-append failure never masks the real apply error', async () => {
    const { routes, deps, audit } = harness();
    const { nonce } = await routes['POST /api/purge/preview']({ uid: 'L' });
    deps.update = jest.fn(async () => { throw new Error('rtdb exploded'); });
    audit.failAppendsAfter(1, new Error('ENOSPC: no space left on device, write'));

    await expect(routes['POST /api/purge/execute']({ uid: 'L', confirmUid: 'L', nonce }))
      .rejects.toThrow(/rtdb exploded/);
  });
});

// --- FINDING 1: the same-origin guard --------------------------------------
describe('originRefusal', () => {
  const req = (headers, localPort = 8787) => ({ headers, socket: { localPort } });

  test('accepts the loopback names this server binds', () => {
    for (const name of ALLOWED_HOSTS) {
      expect(originRefusal(req({ host: `${name}:8787` }))).toBeNull();
    }
  });

  test('refuses a rebinding-shaped Host', () => {
    expect(originRefusal(req({ host: 'evil.example.com:8787' }))).toMatch(/DNS-rebinding/);
    expect(originRefusal(req({ host: 'ops.internal:8787' }))).toMatch(/DNS-rebinding/);
    // a loopback name as a SUBDOMAIN of an attacker domain must not pass
    expect(originRefusal(req({ host: 'localhost.evil.example.com:8787' }))).toMatch(/DNS-rebinding/);
  });

  test('refuses a missing or malformed Host', () => {
    expect(originRefusal(req({}))).toMatch(/Host/);
    expect(originRefusal(req({ host: '' }))).toMatch(/Host/);
    expect(originRefusal(req({ host: '127.0.0.1:not-a-port' }))).toMatch(/Host/);
  });

  test('refuses a Host on a port this server is not listening on', () => {
    expect(originRefusal(req({ host: '127.0.0.1:9999' }))).toMatch(/Host/);
  });

  test('refuses a cross-origin caller', () => {
    expect(originRefusal(req({ host: '127.0.0.1:8787', origin: 'https://evil.example.com' }))).toMatch(/cross-origin/);
    expect(originRefusal(req({ host: '127.0.0.1:8787', origin: 'null' }))).toMatch(/cross-origin/);
    expect(originRefusal(req({ host: '127.0.0.1:8787', origin: 'http://127.0.0.1:9999' }))).toMatch(/cross-origin/);
  });

  // The panel's own POSTs are same-origin but STILL carry Origin (the Fetch
  // standard attaches it to every non-GET/HEAD request), so a blanket
  // Origin rejection would break the tool.
  test('accepts the panel page own same-origin Origin on a POST', () => {
    expect(originRefusal(req({ host: '127.0.0.1:8787', origin: 'http://127.0.0.1:8787' }))).toBeNull();
    expect(originRefusal(req({ host: 'localhost:8787', origin: 'http://localhost:8787' }))).toBeNull();
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

  // fetch() cannot set Host (a forbidden header name), so these go over a raw
  // socket — which is exactly what a rebinding browser or a curl would do.
  test('the guard runs before ANY routing, including the page', async () => {
    const { routes } = harness();
    const server = createHttpServer({ routes, page: '<h1>panel</h1>' });
    await new Promise((resolve) => { server.listen(0, BIND_ADDRESS, () => resolve(undefined)); });
    const { port } = server.address();
    const raw = (headers, path = '/', method = 'GET', body) => new Promise((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
    try {
      expect((await raw({ Host: `127.0.0.1:${port}` })).status).toBe(200);
      expect((await raw({ Host: `localhost:${port}` })).status).toBe(200);

      const rebound = await raw({ Host: `evil.example.com:${port}` });
      expect(rebound.status).toBe(403);
      expect(rebound.body).toMatch(/DNS-rebinding/);
      // the page itself is refused too, not just the API
      expect(rebound.body).not.toContain('<h1>panel</h1>');

      expect((await raw({ Host: `evil.example.com:${port}` }, '/api/snapshot')).status).toBe(403);
      expect((await raw({ Host: '127.0.0.1:9999' }, '/api/snapshot')).status).toBe(403);

      const crossOrigin = await raw(
        { Host: `127.0.0.1:${port}`, Origin: 'https://evil.example.com', 'Content-Type': 'text/plain' },
        '/api/purge/execute', 'POST', JSON.stringify({ uid: 'L', confirmUid: 'L', nonce: 'x' }),
      );
      expect(crossOrigin.status).toBe(403);
      expect(crossOrigin.body).toMatch(/cross-origin/);

      const sameOrigin = await raw(
        { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}` },
        '/api/purge/preview', 'POST', JSON.stringify({ uid: 'L' }),
      );
      expect(sameOrigin.status).toBe(200);
      expect(JSON.parse(sameOrigin.body).nonce).toBeTruthy();
    } finally {
      await new Promise((resolve) => { server.close(() => resolve(undefined)); });
    }
  });
});
