import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Shipped source used to cite documents that live in a *private* repository:
// `handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P1`, `SPEC_V2 §4.2`,
// `METAMODELL §17a`. Two of those citations had even reached API error messages
// and the SuperAdmin UI, so an operator was pointed at a file no one outside
// the original team could open.
//
// A reference a reader cannot follow is worse than no reference: it implies a
// rule exists somewhere and hides where. This test keeps them out.

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Documents that only ever existed in the private planning repo. */
const FORBIDDEN = [
    { pattern: /\bhandoff\//, what: 'handoff/ (private planning repo)' },
    { pattern: /\bSPEC_V2\b/, what: 'SPEC_V2' },
    { pattern: /\bSPEC_V3\b/, what: 'SPEC_V3' },
    { pattern: /\bMETAMODELL\b/, what: 'METAMODELL' },
    { pattern: /\bSUPERADMIN_TENANT_METAMODELL\b/, what: 'SUPERADMIN_TENANT_METAMODELL' },
];

/** This file names the forbidden documents in order to forbid them. */
const SELF = fileURLToPath(import.meta.url);

const SCAN_ROOTS = ['packages', 'examples', 'docs'];
const SCAN_FILES = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md'];
const SCAN_EXTENSIONS = ['.ts', '.js', '.mjs', '.cjs', '.vue', '.md', '.json', '.yaml', '.yml'];

const SKIP_DIRS = new Set([
    'node_modules',
    'dist',
    '.git',
    'coverage',
    'test-results',
    'playwright-report',
    '.integration-tmp',
    '.jscpd-report',
    // Not published, and the whole point of it is to plan this cleanup.
    'handoff',
]);

function* walk(dir) {
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        return;
    }
    for (const entry of entries) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            yield* walk(full);
        } else if (full !== SELF && SCAN_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
            yield full;
        }
    }
}

function collectFiles() {
    const files = [];
    for (const root of SCAN_ROOTS) files.push(...walk(join(REPO_ROOT, root)));
    for (const file of SCAN_FILES) {
        const full = join(REPO_ROOT, file);
        try {
            statSync(full);
            files.push(full);
        } catch {
            /* optional */
        }
    }
    return files;
}

test('the sweep actually reaches the source tree', () => {
    // Without this, a wrong cwd or a renamed directory turns the test below
    // into a vacuous pass — it would check zero files and report success.
    const files = collectFiles();
    assert.ok(
        files.length > 400,
        `expected to scan the whole source tree, but found only ${files.length} files`,
    );
});

test('no shipped file cites a document from the private planning repo', () => {
    const violations = [];

    for (const file of collectFiles()) {
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, index) => {
            for (const { pattern, what } of FORBIDDEN) {
                if (pattern.test(line)) {
                    violations.push(
                        `${relative(REPO_ROOT, file)}:${index + 1} cites ${what}\n      ${line.trim()}`,
                    );
                }
            }
        });
    }

    assert.deepEqual(
        violations,
        [],
        `Found ${violations.length} reference(s) to documents that are not part of this repository.\n` +
            `Replace each with a link into docs/, a GitHub issue number, or drop it — the\n` +
            `surrounding sentence is usually complete without the citation.\n\n` +
            violations.join('\n'),
    );
});
