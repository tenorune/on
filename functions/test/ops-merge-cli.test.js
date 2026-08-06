// functions/test/ops-merge-cli.test.js — the merge leg's CLIs, exercised as
// CLIs.
//
// ops/merge-fixture.js is pure and well covered, and that says NOTHING about
// whether either CLI passes --mapping-shape through to it. The `ops/**` import
// guard passed against a planted violation twice for exactly this reason, and
// M9's opGuard was only trusted once it had been run from the command line. So
// the shape argument gets the same treatment: spawn the real entry point.
//
// These cases are the REFUSALS, which is what makes them runnable here — no
// session container has ever held a service-account credential, so a run that
// reaches makeOpsDeps cannot be tested. Refusing a bad argument BEFORE the
// credential is read is therefore both the better behaviour (a typo'd shape
// should not need a database connection to be caught) and the only part of
// these CLIs a test can reach.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureGids } from '../ops/merge-fixture.js';

const OPS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ops');

/**
 * Run a CLI and return its combined output plus exit status. The environment is
 * stripped of the credential deliberately: if a refusal ever starts depending on
 * one, this goes red instead of silently becoming untestable.
 * @param {string} script @param {string[]} args
 */
function run(script, args) {
  const env = { ...process.env };
  delete env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  try {
    const stdout = execFileSync('node', [path.join(OPS, script), ...args], {
      env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out: stdout };
  } catch (e) {
    const err = /** @type {{ status?: number, stdout?: string, stderr?: string }} */ (e);
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

const BASE = ['--project', 'devproj', '--prod-project', 'prodproj', '--tag', 'cli1'];

describe('seed-merge-fixture --mapping-shape', () => {
  test('an unknown shape is refused by name, and the valid ones are listed', () => {
    const { code, out } = run('seed-merge-fixture.js', [...BASE, '--telegram', '--mapping-shape', 'nonsense']);
    expect(code).not.toBe(0);
    expect(out).toContain('nonsense');
    expect(out).toContain('third-party');
  });

  test('the refusal happens before the credential is read — a typo needs no database', () => {
    const { out } = run('seed-merge-fixture.js', [...BASE, '--telegram', '--mapping-shape', 'nonsense']);
    expect(out).not.toContain('GOOGLE_APPLICATION_CREDENTIALS_JSON');
  });

  test('a shape without --telegram is refused rather than seeding the default', () => {
    const { code, out } = run('seed-merge-fixture.js', [...BASE, '--mapping-shape', 'third-party']);
    expect(code).not.toBe(0);
    expect(out).toMatch(/telegram/i);
  });
});

describe('verify-merge --mapping-shape', () => {
  test('a shape combined with --repoint is refused — those are the other branch', () => {
    const { code, out } = run('verify-merge.js', [...BASE, '--telegram', '--repoint', '--mapping-shape', 'survivor']);
    expect(code).not.toBe(0);
    // Not merely /repoint/ — every CLI echoes its own argv on the first line, so
    // that matches whether or not the flag is understood. Name the branch.
    expect(out).toContain('merge.js:351');
    expect(out).not.toContain('GOOGLE_APPLICATION_CREDENTIALS_JSON');
  });

  test('an unknown shape is refused before the credential is read', () => {
    const { code, out } = run('verify-merge.js', [...BASE, '--telegram', '--mapping-shape', 'nonsense']);
    expect(code).not.toBe(0);
    expect(out).toContain('nonsense');
    expect(out).not.toContain('GOOGLE_APPLICATION_CREDENTIALS_JSON');
  });
});

// --- M13 -------------------------------------------------------------------
// The read-back has to be told whether the operator ticked the shared group's
// adoption in the preview, or it reports a false failure on that one claim.
// `--adopt` is the fourth flag on this CLI and the flag surface is already what
// operators get wrong, so it gets the same pre-credential discipline as
// --mapping-shape: a plausible mistyping is refused by name rather than
// silently ignored.
describe('verify-merge --adopt', () => {
  test('a value after --adopt is refused — the neighbouring flags all take one, this does not', () => {
    const { GB } = fixtureGids('cli1');
    const { code, out } = run('verify-merge.js', [...BASE, '--adopt', GB]);
    expect(code).not.toBe(0);
    expect(out).toContain('--adopt');
    expect(out).toContain(GB);
    expect(out).not.toContain('GOOGLE_APPLICATION_CREDENTIALS_JSON');
  });

  test('--adopt alone is accepted, and gets as far as the credential', () => {
    const { code, out } = run('verify-merge.js', [...BASE, '--adopt']);
    expect(code).not.toBe(0);
    // The refusal it reaches is the MISSING CREDENTIAL, not a bad argument:
    // that is how far a container with no service account can drive this.
    expect(out).toContain('GOOGLE_APPLICATION_CREDENTIALS_JSON');
  });

  // What the two cases above cannot reach: whether the accepted flag is
  // actually handed to buildMergeAssertions. That needs a credential, and no
  // session container has ever held one. So the seam is pinned at the source —
  // naming the CALL, not the symbol, because a flag parsed and dropped on the
  // floor is exactly M8's shape (a control the page defined and never sent).
  test('the parsed flag reaches the claim builder rather than being parsed and dropped', () => {
    const src = readFileSync(path.join(OPS, 'verify-merge.js'), 'utf8');
    const call = src.match(/buildMergeAssertions\(\{[^}]*\}\)/);
    expect(call).not.toBeNull();
    expect(call[0]).toContain('adopt');
  });
});
