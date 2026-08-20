import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

// The two boundaries inside `@saasicat/nest`, asked as behaviour rather than
// read off the config file.
//
// This exists because of how the rules nearly shipped. They were written as two
// config objects — one for the barrel ban over the whole package, one for the
// platform-direction ban over everything but `platform/` and `testing/`. Flat
// config REPLACES a rule's options when a later object sets the same rule; it
// does not merge them. So the second object deleted the first, `eslint .`
// stayed green, and half the guard was gone. The counter-check on the broken
// state found it; nothing else would have.
//
// A test that grepped `eslint.config.mjs` for the patterns would have passed
// through that bug unchanged, because both patterns were in the file. So this
// asks ESLint to lint text at a path and reports what it says — the only
// question whose answer is the thing being promised.

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const NEST_SRC = 'packages/saas-platform-nest/src';

const eslint = new ESLint({ cwd: REPO_ROOT });

/** Rule ids ESLint reports for `source` treated as `relativePath`. */
async function lint(relativePath, source) {
    const [result] = await eslint.lintText(source, {
        filePath: `${REPO_ROOT}${relativePath}`,
        warnIgnored: false,
    });
    return (result?.messages ?? []).map((m) => m.ruleId);
}

/**
 * Whether the boundary rule fired — and only it.
 *
 * The probes import a symbol they do not use, so `no-unused-vars` fires on
 * every one of them. Asserting "no messages at all" would make the negative
 * cases about that instead, which is how a test ends up pinned to a rule it
 * was not written for.
 */
const boundaryFired = (ruleIds) => ruleIds.includes('no-restricted-imports');

const BARREL_IMPORT =
    "import { Thing } from '../entitlement/index.js';\nexport const x: number = 1;\n";
const NESTED_BARREL_IMPORT =
    "import { Thing } from '../../entitlement/index.js';\nexport const x: number = 1;\n";
const PLATFORM_IMPORT =
    "import type { Thing } from '../platform/saas-platform.module.js';\nexport const x: number = 1;\n";
const DIRECT_IMPORT =
    "import { EntitlementService } from '../entitlement/service.js';\nexport const x: number = 1;\n";

describe('no barrel-to-barrel imports across nest domains', () => {
    // Every group the two config objects between them are supposed to cover.
    // `platform/` and `testing/` are listed explicitly because they are the two
    // the second object exists for, and the ones a restructuring would drop.
    const EVERY_AREA = [
        `${NEST_SRC}/billing/probe.ts`,
        `${NEST_SRC}/catalog/probe.ts`,
        `${NEST_SRC}/core/probe.ts`,
        `${NEST_SRC}/platform/probe.ts`,
        `${NEST_SRC}/testing/probe.ts`,
    ];

    for (const path of EVERY_AREA) {
        test(`${path} may not import a sibling barrel`, async () => {
            assert.ok(
                boundaryFired(await lint(path, BARREL_IMPORT)),
                `${path} was allowed to import '../entitlement/index.js'`,
            );
        });
    }

    test('a barrel one directory deeper is caught too', async () => {
        assert.ok(
            boundaryFired(await lint(`${NEST_SRC}/catalog/dto/probe.ts`, NESTED_BARREL_IMPORT)),
        );
    });

    test('importing the declaring module is what the rule asks for', async () => {
        // The other half of the promise: the rule must leave the correct form
        // alone, or it is not a boundary but a ban on cross-domain imports.
        assert.equal(
            boundaryFired(await lint(`${NEST_SRC}/billing/probe.ts`, DIRECT_IMPORT)),
            false,
        );
    });
});

describe('domains do not import platform/', () => {
    for (const domain of ['billing', 'catalog', 'entitlement', 'promo', 'setup']) {
        test(`${domain}/ may not reach back into platform/`, async () => {
            assert.ok(
                boundaryFired(await lint(`${NEST_SRC}/${domain}/probe.ts`, PLATFORM_IMPORT)),
                `${domain}/ was allowed to import from platform/`,
            );
        });
    }

    test('testing/ may, because it sits downstream of platform/', async () => {
        // Not a hole in the rule — it is the arrow's direction. `testing/`
        // hands out `StaticFeatureGuard` and the test-module factory, both of
        // which are platform composition.
        assert.equal(
            boundaryFired(await lint(`${NEST_SRC}/testing/probe.ts`, PLATFORM_IMPORT)),
            false,
        );
    });

    test('platform/ may import its own neighbours', async () => {
        assert.equal(
            boundaryFired(await lint(`${NEST_SRC}/platform/probe.ts`, PLATFORM_IMPORT)),
            false,
        );
    });
});

describe('the boundaries hold on the tree as it stands', () => {
    test('no file in the package violates either rule', async () => {
        // The rules landed with no exemption list, and this is what says so. If
        // one is ever genuinely needed it belongs in the config with its
        // reason, and this test is where its absence stops being true.
        const results = await eslint.lintFiles([`${NEST_SRC}/**/*.ts`]);
        const violations = results.flatMap((r) =>
            r.messages
                .filter((m) => m.ruleId === 'no-restricted-imports')
                .map((m) => `${r.filePath}:${m.line}`),
        );
        assert.deepEqual(violations, []);
        assert.ok(results.length > 100, `only ${results.length} files linted — glob went wrong`);
    });
});
