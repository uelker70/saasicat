// A part of the contract a harness leaves out fails, unless the adapter says so.
//
// A skip is easy to read past in a green run: a harness that forgot to wire a
// port the adapter ships reported eleven skipped scenarios and a passing suite,
// and checked none of them. So a missing part fails, a declared one skips, and
// a declaration that names a part the harness does provide fails too — or the
// list of gaps would outlive the gaps.

// @requirement SC-COMP-011 — Every data-access implementation is held to the same executable contract
// @requirement SC-COMP-012 — Where one implementation cannot do what another can, the gap is recorded

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('./fixtures/contract-with-gaps.js', import.meta.url));

/** Runs the fixture in one shape and reads the counts off its TAP report. */
function run(shape) {
    // `node --test` marks its children with NODE_TEST_CONTEXT and they report to
    // the parent instead of stdout; the fixture is a run of its own.
    const { NODE_TEST_CONTEXT: _parentRunner, ...env } = process.env;
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', FIXTURE], {
        env: { ...env, CONTRACT_GAP_SHAPE: shape },
        encoding: 'utf8',
    });
    const lines = result.stdout.split('\n');
    const count = (name) => {
        const prefix = `# ${name} `;
        const line = lines.find((l) => l.startsWith(prefix));
        return line === undefined ? Number.NaN : Number(line.slice(prefix.length));
    };
    return {
        pass: count('pass'),
        fail: count('fail'),
        skip: count('skipped'),
        output: result.stdout,
    };
}

describe('a part the harness does not provide', () => {
    const undeclared = run('undeclared');
    const declared = run('declared');

    test('the runs report counts at all', () => {
        for (const [shape, counts] of Object.entries({ undeclared, declared })) {
            assert.ok(
                Number.isInteger(counts.pass) && counts.pass > 0,
                `${shape}: ${counts.output}`,
            );
        }
    });

    test('fails its scenarios when it is not declared, naming the declaration', () => {
        assert.ok(undeclared.fail > 1, undeclared.output);
        assert.match(undeclared.output, /declare `gaps: \['appliedSettings'\]`/);
    });

    test('fails the declaration check too, naming every part left out', () => {
        assert.match(
            undeclared.output,
            /not wired into the harness and not declared as gaps: appliedSettings$/m,
        );
    });

    test('skips exactly those scenarios when it is declared', () => {
        // One failure of the undeclared run is the declaration check, which passes here.
        const failedScenarios = undeclared.fail - 1;
        assert.equal(declared.fail, 0, declared.output);
        assert.equal(declared.skip - undeclared.skip, failedScenarios);
        assert.equal(declared.pass, undeclared.pass + 1);
    });
});

describe('a group the capabilities rule out', () => {
    test('still skips when no gap is declared for it', () => {
        const undeclared = run('undeclared');
        assert.ok(
            undeclared.output.includes('# SKIP adapter declares no pessimistic-locking capability'),
            undeclared.output,
        );
    });
});

describe('a gap declared for a part the harness does provide', () => {
    test('fails the suite and names the part', () => {
        const stale = run('stale');
        assert.equal(stale.fail, 1, stale.output);
        assert.match(stale.output, /declared as gaps but wired into the harness: mfa/);
    });
});
