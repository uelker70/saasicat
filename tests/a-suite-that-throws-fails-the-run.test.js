// @requirement SC-READ-002 — A gap is named rather than papered over

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A suite whose body throws must fail the run, and `node --test` does not make
// that true on its own.
//
// Measured: a `test()` that throws exits 1; a `describe()` whose callback
// throws is printed with a ✖, counted as neither pass nor fail, and the process
// exits 0. So the whole file can do nothing while the gate reports success.
// That happened — `reference-pages-are-generated` awaited its generator in the
// describe body, the generator refused to render, `pnpm run test:repo` said OK
// locally, and CI was the first thing to notice.
//
// The fix is a shape, not a setting: do the async work inside a `test()`, where
// a rejection is a failure. This keeps the shape.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SUITES = ['tests', ...packageTestDirs()];

function packageTestDirs() {
    const packages = join(ROOT, 'packages');
    if (!existsSync(packages)) return [];
    return readdirSync(packages)
        .map((name) => join('packages', name, 'tests'))
        .filter((dir) => existsSync(join(ROOT, dir)));
}

/** Every test file under the suite directories, recursively. */
function testFiles() {
    const found = [];
    for (const dir of SUITES) {
        for (const entry of readdirSync(join(ROOT, dir), { recursive: true })) {
            const name = String(entry);
            if (name.endsWith('.test.js') || name.endsWith('.test.ts')) {
                found.push(join(dir, name));
            }
        }
    }
    return found;
}

/**
 * `describe(…, async …)` occurrences, with the file and line.
 *
 * Scanned by hand rather than by pattern: the repository forbids a regex whose
 * quantifiers can overlap on text it does not control, and `describe\(.*,\s*async`
 * is two of them around one literal.
 */
function asyncSuites(file, source) {
    const found = [];
    const lines = source.split('\n');
    for (const [at, line] of lines.entries()) {
        // Prose names the shape it forbids — this file's own comment does — and
        // a scanner that reads comments reports the documentation. The same
        // mistake emptied the design-token table one directory over, so the
        // same answer: a comment line is not code. What this does not see is a
        // `describe(` inside a template string, which no suite has.
        const opener = line.trimStart().slice(0, 2);
        if (opener === '//' || opener === '/*' || opener.startsWith('*')) continue;
        let from = 0;
        for (;;) {
            const call = line.indexOf('describe(', from);
            if (call === -1) break;
            from = call + 'describe('.length;
            const body = line.indexOf('{', from);
            const head = body === -1 ? line.slice(from) : line.slice(from, body);
            if (head.includes('async')) found.push(`${file}:${at + 1}`);
        }
    }
    return found;
}

describe('no suite hides its failure in a describe body', () => {
    const files = testFiles();

    test('the sweep finds the suites', () => {
        // The assertion below is "nothing was found". On an empty file list it
        // is true, and a moved test directory would read as a clean result.
        assert.ok(files.length > 50, `only ${files.length} test files found`);
        assert.ok(
            files.some((file) => file.startsWith('packages/')),
            'no package suites found — only the repo-wide ones were swept',
        );
    });

    test('no describe body is async', () => {
        const offenders = files.flatMap((file) =>
            asyncSuites(file, readFileSync(join(ROOT, file), 'utf8')),
        );
        assert.deepEqual(
            offenders,
            [],
            'await inside a `test()` instead: a throw in a describe body leaves ' +
                'the run green, and the suite silently runs no tests at all.',
        );
    });
});
