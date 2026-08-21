import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Does a generated project import things that exist?
//
// The scaffolder's templates name `@saasicat/ui-vue` subpaths as literal
// strings. Nothing compiles them, nothing type-checks them, and the export map
// they refer to is in another package — so when the 1.0 surface cut renamed
// `./pages/AdminLayout.vue` to `./layouts/AdminLayout.vue`, the template kept
// pointing at the old name and every freshly generated project would have
// failed to build. Found by reading, which is not a method.
//
// Resolved against the real export map here, the way a bundler resolves it.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const UI_VUE = join(ROOT, 'packages', 'saas-platform-ui-vue');
const exports_ = JSON.parse(readFileSync(join(UI_VUE, 'package.json'), 'utf8')).exports;

/** Every file under a directory, recursively. */
function filesUnder(dir) {
    const found = [];
    const walk = (d) => {
        for (const entry of readdirSync(d)) {
            const full = join(d, entry);
            if (statSync(full).isDirectory()) walk(full);
            else found.push(full);
        }
    };
    if (existsSync(dir)) walk(dir);
    return found;
}

/** What `@saasicat/ui-vue/<subpath>` resolves to, or null. */
function resolveSubpath(subpath) {
    const key = `./${subpath}`;
    const exact = exports_[key];
    if (exact !== undefined) return typeof exact === 'string' ? exact : 'dist';

    for (const [pattern, target] of Object.entries(exports_)) {
        if (!pattern.includes('*')) continue;
        const [head, tail] = pattern.split('*');
        if (!key.startsWith(head) || !key.endsWith(tail)) continue;
        const middle = key.slice(head.length, key.length - tail.length || undefined);
        return typeof target === 'string' ? target.replace('*', middle) : 'dist';
    }
    return null;
}

// Templates AND documentation. Both name subpaths as literal strings that
// nothing compiles, and both are read as instructions: a template by a
// generator, a document by a person following it. A wrong path costs the same
// either way — the difference is only how long it takes to find out.
const SOURCES = [
    join(ROOT, 'packages', 'create-saasicat-admin', 'templates'),
    join(ROOT, 'packages', 'saas-platform-cli', 'templates'),
    join(ROOT, 'docs'),
    join(ROOT, 'README.md'),
    join(ROOT, 'packages', 'saas-platform-ui-vue', 'README.md'),
];

/** A placeholder in prose, not a path anyone imports. */
const isPlaceholder = (subpath) => subpath.includes('...') || subpath.endsWith('/');

const SPECIFIER = /@saasicat\/ui-vue\/([A-Za-z0-9/_.-]+)/g;

describe('every ui-vue subpath a template or document names can be imported', () => {
    const used = [];
    for (const source of SOURCES) {
        const files =
            existsSync(source) && statSync(source).isDirectory()
                ? filesUnder(source)
                : existsSync(source)
                  ? [source]
                  : [];
        for (const file of files) {
            for (const [, subpath] of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
                if (isPlaceholder(subpath)) continue;
                used.push({ file: relative(ROOT, file), subpath });
            }
        }
    }

    test('the templates name some subpaths', () => {
        // Without this the check below passes on a scaffolder that imports
        // nothing, which is the shape of a guard with no subject.
        assert.ok(used.length >= 8, `only ${used.length} ui-vue subpaths found`);
    });

    test('each one resolves through the export map', () => {
        const unresolvable = used
            .filter(({ subpath }) => resolveSubpath(subpath) === null)
            .map(({ file, subpath }) => `${file}: @saasicat/ui-vue/${subpath}`);

        assert.deepEqual(
            unresolvable,
            [],
            'A generated project would not build: these subpaths are not exported.',
        );
    });

    test('and the file behind it is really there', () => {
        // Resolving is not enough — a glob resolves happily to a path that
        // does not exist, which is the same broken build one step later.
        const missing = used
            .map(({ file, subpath }) => ({ file, subpath, target: resolveSubpath(subpath) }))
            .filter(({ target }) => target && target.startsWith('./src/'))
            .filter(({ target }) => !existsSync(join(UI_VUE, target.slice(2))))
            .map(({ file, subpath, target }) => `${file}: ${subpath} → ${target}`);

        assert.deepEqual(missing, [], 'the export map resolves it, but the file is not there');
    });
});
