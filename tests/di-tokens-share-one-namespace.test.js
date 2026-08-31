// @requirement SC-COMP-001 — All packages carry one version number and move together

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// One namespace for every registry key: `saasicat/<package>/<Name>` (AP1 §1.4).
//
// `Symbol.for` reads from a process-wide registry keyed by string, so the
// string is a runtime contract between the platform and every consumer app —
// which is why CONTRIBUTING.md forbids renaming a key. Four prefixes had grown
// before 1.0 (`saas-platform/`, `saas-platform-nest/`, `saas-platform-cli/`,
// `@saasicat/ui-vue/`), and 1.0 renamed them all, once. This test is what
// makes a fifth prefix a build failure rather than a review comment.
//
// The expected prefix is derived, not listed: the package directory IS the npm
// name without its scope (5.1), so a key declared under `packages/<dir>/src/`
// must begin with `saasicat/<dir>/`. A key is read from the source, not from
// the built entries, because a token that is never exported still reaches the
// registry — and a consumer may `Symbol.for` the same string themselves.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = join(ROOT, 'packages');
const SOURCE = /\.(ts|mts|vue)$/;
const SKIP = new Set(['node_modules', 'dist']);

/** Every `Symbol.for('…')` argument in a text, with its line. A `${}` is reported as such. */
export function findRegistryKeys(text) {
    const keys = [];
    const re = /Symbol\.for\(\s*(['"`])([^'"`]*)\1/g;
    for (const match of text.matchAll(re)) {
        const line = text.slice(0, match.index).split('\n').length;
        keys.push({ line, key: match[2], template: match[1] === '`' });
    }
    return keys;
}

/** The prefix a key in `packages/<dir>/…` has to carry. */
export function expectedPrefix(relativePath) {
    return `saasicat/${relativePath.split('/')[0]}/`;
}

function* sources(dir) {
    for (const entry of readdirSync(dir)) {
        if (SKIP.has(entry)) continue;
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) yield* sources(path);
        else if (SOURCE.test(entry)) yield path;
    }
}

describe('registry keys share one namespace', () => {
    const found = [];
    for (const dir of readdirSync(PACKAGES)) {
        const src = join(PACKAGES, dir, 'src');
        let entries;
        try {
            entries = [...sources(src)];
        } catch {
            continue; // a package that ships no src/ (the pointer package)
        }
        for (const file of entries) {
            for (const hit of findRegistryKeys(readFileSync(file, 'utf8'))) {
                found.push({ ...hit, path: relative(PACKAGES, file) });
            }
        }
    }

    test('the scan found the tokens', () => {
        assert.ok(found.length >= 70, `only ${found.length} Symbol.for calls found`);
        assert.ok(
            new Set(found.map((f) => f.path.split('/')[0])).size >= 4,
            'tokens found in fewer than four packages',
        );
    });

    test('every key starts with saasicat/<package>/', () => {
        const wrong = found
            .filter((f) => f.template || !f.key.startsWith(expectedPrefix(f.path)))
            .map((f) => `${f.path}:${f.line} ${f.template ? '(template literal)' : f.key}`);
        assert.deepEqual(
            wrong,
            [],
            'a registry key outside its package namespace — the string is a consumer contract, ' +
                'and the namespace was unified exactly once, at 1.0 (CONTRIBUTING.md)',
        );
    });

    test('no two declarations share a key', () => {
        // Two tokens with one string are one symbol: whichever provider
        // registers last wins, silently.
        const byKey = new Map();
        for (const f of found) {
            if (!byKey.has(f.key)) byKey.set(f.key, []);
            byKey.get(f.key).push(`${f.path}:${f.line}`);
        }
        const shared = [...byKey].filter(
            ([, sites]) => new Set(sites.map((s) => s.split(':')[0])).size > 1,
        );
        assert.deepEqual(shared, []);
    });
});

describe('the scanner itself', () => {
    test('reads single- and multi-line calls, and reports template literals', () => {
        const keys = findRegistryKeys(
            "a = Symbol.for('saasicat/nest/A');\nb = Symbol.for(\n    'saasicat/nest/B',\n);\nc = Symbol.for(`saasicat/${x}`);",
        );
        assert.deepEqual(
            keys.map((k) => [k.line, k.key, k.template]),
            [
                [1, 'saasicat/nest/A', false],
                [2, 'saasicat/nest/B', false],
                [5, 'saasicat/${x}', true],
            ],
        );
    });

    test('derives the prefix from the package directory', () => {
        assert.equal(expectedPrefix('nest/src/admin/admin.tokens.ts'), 'saasicat/nest/');
        assert.equal(expectedPrefix('ui-vue/src/vue/x.ts'), 'saasicat/ui-vue/');
        assert.ok(!'saas-platform/MfaPort'.startsWith(expectedPrefix('nest/src/x.ts')));
    });
});
