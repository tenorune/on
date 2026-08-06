// functions/test/ops-audit-dir.test.js — where a pre-image dump lands, and
// whether git will publish it.
//
// A purge/merge pre-image holds full account data: push tokens, Telegram chat
// id, coarse location cells, and — with the Auth-delete box ticked — the email
// address. It is the only path back from an irreversible write, so it is
// written to disk on purpose; the danger is that a `git add -A` then commits
// it and a push to `dev` publishes it.
//
// Both halves of that guarantee are checked here as BEHAVIOUR rather than as
// source text. `.gitignore` is asked through git itself — the rule used to be
// anchored (`functions/.ops-audit/`) and so covered the dump only when the
// panel happened to be launched from `functions/`, which is not the only way
// the launcher permits it to start.
import { execFileSync } from 'node:child_process';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../ops/server.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS = join(HERE, '..');
const REPO = join(FUNCTIONS, '..');
const ENV = { GOOGLE_APPLICATION_CREDENTIALS_JSON: '{"x":1}' };

/** Does git ignore this repo-relative path? Asks git, so the answer is real. */
function ignored(relPath) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', relPath], { cwd: REPO, stdio: 'ignore' });
    return true;
  } catch (e) {
    // 1 = "not ignored"; anything else is a broken invocation, not an answer.
    if (/** @type {{ status?: number }} */ (e).status === 1) return false;
    throw e;
  }
}

describe('a pre-image dump is git-ignored wherever the panel is launched from', () => {
  // The launcher accepts `node functions/ops/server.js` from the repo root as
  // readily as `node ops/server.js` from functions/, and a relative audit dir
  // follows the CWD. The anchored rule matched only the second.
  test.each([
    '.ops-audit/purge-L.json',
    'functions/.ops-audit/purge-L.json',
    'functions/ops/.ops-audit/purge-L.json',
    '.ops-audit/audit.jsonl',
  ])('%s is ignored', (path) => {
    expect(ignored(path)).toBe(true);
  });

  // The rule must stay a rule about the dump directory, not a blanket one.
  test('an ordinary file is still tracked', () => {
    expect(ignored('functions/ops/server.js')).toBe(false);
    expect(ignored('docs/HANDOFF.md')).toBe(false);
  });
});

describe('the default audit directory does not depend on the launch directory', () => {
  // Belt to the .gitignore braces: pinning the dump to the module's own tree
  // means an operator who starts the panel from the repo root (or from
  // anywhere else) still gets their dumps in one predictable place.
  test('it is absolute, and anchored to functions/', () => {
    const { auditDir } = parseArgs(['--project', 'demo'], ENV);
    expect(isAbsolute(auditDir)).toBe(true);
    expect(auditDir).toBe(join(FUNCTIONS, '.ops-audit'));
  });

  test('an explicit --audit-dir still wins', () => {
    expect(parseArgs(['--project', 'demo', '--audit-dir', '/tmp/dumps'], ENV).auditDir).toBe('/tmp/dumps');
  });
});
