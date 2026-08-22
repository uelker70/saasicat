/**
 * The visual fixture provides every seam `createSuperAdminApp()` provides.
 *
 * The fixture is a hand-built shell: it wires Quasar, the router, the theme and
 * the injection keys itself, because the point of the baselines is to render a
 * page under controlled data rather than to boot the real app. That makes it a
 * second implementation of the bootstrap's provide list, and a second
 * implementation drifts.
 *
 * It had drifted twice by the time this test was written, and neither showed up
 * in a gate:
 *
 *   - `SUPER_ADMIN_RESOURCES_KEY` was never added when the pages moved onto the
 *     resource idiom. `useResource()` throws without it, so all thirteen
 *     migrated pages failed in `setup()` — measured: three failures on the
 *     dashboard case alone.
 *   - `SUPER_ADMIN_CONFIRM_KEY` and `SUPER_ADMIN_MANIFEST_CLEAR_CACHE_KEY` are
 *     still absent, which is fine only for as long as no case reaches a
 *     destructive action or the manifest-error page.
 *
 * The Playwright suite needs an environment and does not run in the default
 * gates, so the drift was invisible until someone ran it. This test needs no
 * environment: it reads both files with the TypeScript parser and compares the
 * two sets. A pattern would not do — the bootstrap's largest provide spans six
 * lines, and a `grep` for `app.provide(KEY` misses exactly the one that broke.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PACKAGE } from './support/vue-typescript-program.mjs';

const BOOTSTRAP = join(PACKAGE, 'src', 'quasar', 'create-super-admin-app.ts');
const FIXTURE = join(PACKAGE, 'tests-e2e', 'visual', 'main.ts');

/**
 * The injection keys a file installs, by the name it calls them.
 *
 * Syntax is enough here — every provide in both files names its key with an
 * identifier — so this reads the tree rather than resolving types, and costs
 * one parse per file instead of a program.
 */
function providedKeys(path, source = readFileSync(path, 'utf8')) {
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const keys = new Set();
    const visit = (node) => {
        if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === 'provide' &&
            node.arguments.length >= 1 &&
            ts.isIdentifier(node.arguments[0])
        ) {
            keys.add(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(file, visit);
    return keys;
}

describe('the visual fixture installs what createSuperAdminApp installs', () => {
    const fromBootstrap = providedKeys(BOOTSTRAP);
    const fromFixture = providedKeys(FIXTURE);

    test('both files were actually read', () => {
        // Without this the comparison passes by finding nothing on both sides.
        assert.ok(fromBootstrap.size >= 10, `bootstrap: only ${fromBootstrap.size} keys found`);
        assert.ok(fromFixture.size >= 10, `fixture: only ${fromFixture.size} keys found`);
    });

    test('no seam the bootstrap installs is missing from the fixture', () => {
        // No exemption list. A key the fixture installs some other way would
        // need one, and none does — inventing the hatch before the case exists
        // is how a rule ends up with an escape nobody remembers is open.
        const missing = [...fromBootstrap].filter((key) => !fromFixture.has(key)).sort();
        assert.deepEqual(
            missing,
            [],
            'the fixture renders pages without these, so a page that reads one fails in ' +
                'setup() and its baseline records the failure as the new truth',
        );
    });
});

describe('the reader sees what a pattern would miss', () => {
    // The counter-check. Both shapes exist in the real files, and the second is
    // the one that hid the resource registry from every `grep` written for it.
    const MULTILINE = `
        const app = createApp({});
        app.provide(ONE_LINE, 1);
        app.provide(
            SPREAD_OVER_LINES,
            createSomething({ deep: { nested: true } }),
        );
    `;

    test('a provide spread over several lines is found', () => {
        const keys = providedKeys('inline.ts', MULTILINE);
        assert.deepEqual([...keys].sort(), ['ONE_LINE', 'SPREAD_OVER_LINES']);
    });

    test('a missing key is reported rather than passed over', () => {
        const bootstrap = providedKeys('a.ts', 'app.provide(A, 1); app.provide(B, 2);');
        const fixture = providedKeys('b.ts', 'app.provide(A, 1);');
        const missing = [...bootstrap].filter((key) => !fixture.has(key));
        assert.deepEqual(missing, ['B']);
    });
});
