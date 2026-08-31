// @requirement SC-UI-002 — Mounting a shipped screen costs no wiring

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The barrel lists every page. A list, because a bundler needs literal
// `import()` specifiers to split them and a consumer needs to read what they
// get — but a list nobody checks is the defect this repository keeps finding
// one level up.
//
// So the directory is the truth and the barrel is held against it. Adding a
// page without listing it fails here, which is the moment it costs nothing.

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const PAGES = join(SRC, 'pages');
const barrel = readFileSync(join(PAGES, 'index.ts'), 'utf8');

/** The `.vue` files that sit in `src/pages/`. */
const onDisk = readdirSync(PAGES)
    .filter((name) => name.endsWith('.vue'))
    .map((name) => name.replace(/\.vue$/, ''))
    .sort();

/** The names `adminPages` maps, in the order they appear. */
const listed = [...barrel.matchAll(/^\s{4}(\w+): \(\) => import\('\.\/(\w+)\.vue'\)/gm)].map(
    ([, name, file]) => ({ name, file }),
);

describe('the pages barrel and the pages directory agree', () => {
    test('there are pages to compare', () => {
        assert.ok(onDisk.length >= 10, `only ${onDisk.length} pages found`);
    });

    test('every page on disk is in the barrel', () => {
        const missing = onDisk.filter((page) => !listed.some((e) => e.file === page));
        assert.deepEqual(missing, [], 'a page exists but nothing can import it through the barrel');
    });

    test('every entry in the barrel is a page on disk', () => {
        const phantom = listed.filter((e) => !onDisk.includes(e.file)).map((e) => e.file);
        assert.deepEqual(phantom, [], 'the barrel imports a file that is not there');
    });

    test('each name matches the file it loads', () => {
        // `DashboardPage: () => import('./TenantsPage.vue')` would compile,
        // pass both checks above, and mount the wrong screen.
        const mismatched = listed.filter((e) => e.name !== e.file);
        assert.deepEqual(mismatched, [], 'a barrel entry is named after a different file');
    });
});

describe('the standard routes point at pages that exist', () => {
    const routes = [...barrel.matchAll(/\{ path: '([^']+)', page: '(\w+)' \}/g)].map(
        ([, path, page]) => ({ path, page }),
    );

    test('there are routes to check', () => {
        assert.ok(routes.length >= 10, `only ${routes.length} standard routes`);
    });

    test('each names a page the barrel maps', () => {
        const unknown = routes.filter((r) => !listed.some((e) => e.name === r.page));
        assert.deepEqual(unknown, [], 'a standard route names a page the barrel does not have');
    });

    test('no two routes answer the same path', () => {
        const seen = new Set();
        const duplicates = routes.filter((r) => !seen.add(r.path) && true);
        assert.deepEqual(duplicates, [], 'two standard routes claim one path');
    });

    test('the error page is not among them', () => {
        // It lives at `/admin-error`, outside the layout and public. Mounting
        // it as a child of `/admin` puts a fail-closed screen behind the guard
        // whose failure it exists to report.
        assert.ok(
            !routes.some((r) => r.page === 'AdminManifestErrorPage'),
            'the manifest error page is mounted inside the layout it reports the failure of',
        );
    });
});
