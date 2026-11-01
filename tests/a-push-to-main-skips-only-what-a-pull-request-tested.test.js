// A push to main skips the CI jobs only where a pull request's successful run
// already tested the very same tree, and runs every job otherwise.
//
// Two halves. The workflow's shape: every job hangs on the one that decides,
// and asks `!cancelled()`, so a job added later cannot run beside the decision
// and a failed lookup runs the jobs rather than skips them. And the decision
// itself: `.github/scripts/tree-tested-by-a-pull-request.sh` run against a
// stand-in for `gh` that answers the GitHub API from canned responses and
// applies the script's own `--jq` filters with jq, so the filters are tested
// with the rest.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORKFLOW = join(ROOT, '.github/workflows/ci.yml');
const SCRIPT = join(ROOT, '.github/scripts/tree-tested-by-a-pull-request.sh');

const DECIDING_JOB = 'tested-before';
const SKIP_CONDITION = "${{ !cancelled() && needs.tested-before.outputs.tested != 'true' }}";

const REPO = 'owner/repo';
const SHA = 'c0ffee0000000000000000000000000000000000';
const TREE = '7ree000000000000000000000000000000000000';
const HEAD = 'bead000000000000000000000000000000000000';

describe('the CI workflow', () => {
    const { jobs } = parse(readFileSync(WORKFLOW, 'utf8'));

    test('has the job that decides, and others beside it', () => {
        assert.ok(jobs[DECIDING_JOB], `${DECIDING_JOB} is missing`);
        assert.ok(Object.keys(jobs).length > 1);
    });

    test('lets a lookup that fails run every job without failing the run', () => {
        const lookup = jobs[DECIDING_JOB].steps.find((step) => step.id === 'lookup');
        assert.ok(lookup, 'the lookup step is missing');
        assert.equal(lookup['continue-on-error'], true);
    });

    test('hangs every other job on that decision, run unless it says the tree was tested', () => {
        const loose = Object.entries(jobs)
            .filter(([name]) => name !== DECIDING_JOB)
            .filter(([, job]) => job.needs !== DECIDING_JOB || job.if !== SKIP_CONDITION)
            .map(([name]) => name);
        assert.deepEqual(loose, []);
    });
});

/** The API as the stand-in answers it: the raw JSON per path, or a failure. */
function cannedApi({ pulls = [], runs = {}, artifacts = {}, failOn = null } = {}) {
    const responses = {
        [`repos/${REPO}/commits/${SHA}/pulls`]: pulls,
    };
    for (const [head, runIds] of Object.entries(runs)) {
        responses[
            `repos/${REPO}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${head}&status=success&per_page=20`
        ] = { workflow_runs: runIds.map((id) => ({ id })) };
    }
    for (const [runId, names] of Object.entries(artifacts)) {
        responses[`repos/${REPO}/actions/runs/${runId}/artifacts`] = {
            artifacts: names.map((name) =>
                typeof name === 'string' ? { name, expired: false } : name,
            ),
        };
    }
    return { responses, failOn };
}

/** A `gh` that answers `gh api <path> --jq <filter>` from `api`, filtering with jq. */
function standInGh(directory, api) {
    const answers = join(directory, 'answers.json');
    writeFileSync(answers, JSON.stringify(api));
    const gh = join(directory, 'gh');
    writeFileSync(
        gh,
        [
            '#!/usr/bin/env bash',
            'set -euo pipefail',
            '[ "$1" = api ] || { echo "unexpected: gh $*" >&2; exit 2; }',
            'path=$2; filter=$4',
            `fail=$(jq -r '.failOn // ""' '${answers}')`,
            'if [ -n "$fail" ] && [ "${path#*"$fail"}" != "$path" ]; then echo "HTTP 502" >&2; exit 1; fi',
            `jq -e --arg p "$path" '.responses | has($p)' '${answers}' >/dev/null || { echo "HTTP 404: $path" >&2; exit 1; }`,
            `jq -r --arg p "$path" ".responses[\\$p] | $filter" '${answers}'`,
        ].join('\n'),
    );
    chmodSync(gh, 0o755);
}

/** Runs the script against `api`; what it wrote to its output and how it ended. */
function decide(api) {
    const directory = mkdtempSync(join(tmpdir(), 'tree-tested-'));
    standInGh(directory, api);
    const output = join(directory, 'output');
    writeFileSync(output, '');
    const run = spawnSync('bash', [SCRIPT], {
        encoding: 'utf8',
        env: {
            PATH: `${directory}:${process.env.PATH}`,
            REPO,
            SHA,
            TREE,
            GITHUB_OUTPUT: output,
        },
    });
    return {
        status: run.status,
        output: readFileSync(output, 'utf8'),
        log: run.stdout + run.stderr,
    };
}

const merged = (head) => ({ merged_at: '2026-11-01T12:00:00Z', head: { sha: head } });

describe('the decision on a push to main', () => {
    test('skips where a successful run of the merged pull request recorded this tree', () => {
        const result = decide(
            cannedApi({
                pulls: [merged(HEAD)],
                runs: { [HEAD]: [41] },
                artifacts: { 41: [`tested-tree-${TREE}`] },
            }),
        );
        assert.equal(result.status, 0, result.log);
        assert.equal(result.output, 'tested=true\n');
    });

    test('looks past a run that recorded another tree to one that recorded this', () => {
        const result = decide(
            cannedApi({
                pulls: [merged(HEAD)],
                runs: { [HEAD]: [42, 41] },
                artifacts: { 42: ['tested-tree-0ther'], 41: [`tested-tree-${TREE}`] },
            }),
        );
        assert.equal(result.output, 'tested=true\n', result.log);
    });

    const runsEveryJob = [
        ['a commit no pull request brought', { pulls: [] }],
        [
            'a pull request that was closed rather than merged',
            {
                pulls: [{ merged_at: null, head: { sha: HEAD } }],
                runs: { [HEAD]: [41] },
                artifacts: { 41: [`tested-tree-${TREE}`] },
            },
        ],
        ['a pull request with no successful run', { pulls: [merged(HEAD)], runs: { [HEAD]: [] } }],
        [
            'a run that recorded another tree, as when main moved after it',
            {
                pulls: [merged(HEAD)],
                runs: { [HEAD]: [41] },
                artifacts: { 41: ['tested-tree-0ther'] },
            },
        ],
        [
            'a run from before the record existed',
            { pulls: [merged(HEAD)], runs: { [HEAD]: [41] }, artifacts: { 41: ['jscpd-report'] } },
        ],
        [
            'a record whose name only begins with this tree',
            {
                pulls: [merged(HEAD)],
                runs: { [HEAD]: [41] },
                artifacts: { 41: [`tested-tree-${TREE}0`] },
            },
        ],
        [
            'a record that has expired',
            {
                pulls: [merged(HEAD)],
                runs: { [HEAD]: [41] },
                artifacts: { 41: [{ name: `tested-tree-${TREE}`, expired: true }] },
            },
        ],
    ];

    for (const [what, api] of runsEveryJob) {
        test(`runs every job for ${what}`, () => {
            const result = decide(cannedApi(api));
            assert.equal(result.status, 0, result.log);
            assert.equal(result.output, 'tested=false\n');
        });
    }

    test('fails rather than answer where it cannot ask, so the workflow runs every job', () => {
        const result = decide(cannedApi({ pulls: [merged(HEAD)], failOn: '/runs?' }));
        assert.notEqual(result.status, 0);
        assert.equal(result.output, '');
    });
});
