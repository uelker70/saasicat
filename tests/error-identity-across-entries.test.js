import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A package with more than one entry hands out more than one copy of a class.
//
// esbuild code-splits ESM but not CJS, so `@saasicat/ui-vue`'s `.` and
// `./client` entries share their ESM chunks and duplicate their CJS output. An
// app that reaches the package through both — which is ordinary, since `.`
// re-exports the whole client layer — then holds two `AdminError` classes, and
// `instanceof` is false between them.
//
// That matters because `toAdminError()` decides what to do with an error by
// recognising it. A copy it fails to recognise is re-wrapped as an unknown
// thrown value, which drops the `status`, `code` and `body` it was carrying —
// the exact loss the type exists to prevent. `AdminError` therefore carries a
// `Symbol.for` brand, and this is where that claim is checked.
//
// It lives here rather than in the package's own suite for a measured reason:
// the package's suites are what the coverage ratchet measures, and loading both
// CJS bundles pulls ~11,000 lines of duplicated output into the report — it
// took ui-vue's function coverage from 76.6 % to 35.3 %, a measurement artefact
// rather than a thinner suite. A repo-level test is not measured, and this is
// a packaging invariant anyway: it is about what an installed package hands
// out, which is what every test in this directory looks at.

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const UI_VUE = join(REPO_ROOT, 'packages', 'saas-platform-ui-vue');

/** Resolves an entry's `require` target through the package's export map. */
function requireTarget(subpath) {
    const pkg = JSON.parse(readFileSync(join(UI_VUE, 'package.json'), 'utf8'));
    const target = pkg.exports[subpath]?.require?.default;
    assert.ok(target, `${subpath} has no require condition in the export map`);
    return join(UI_VUE, target);
}

const require = createRequire(import.meta.url);
const main = require(requireTarget('.'));
const client = require(requireTarget('./client'));

describe('AdminError across the CJS entries of @saasicat/ui-vue', () => {
    test('the two entries really do hand out separate classes', () => {
        // Not a defect to fix here — it is the condition the brand answers.
        // Should a future build merge the CJS entries into one identity (as
        // `@saasicat/nest` does through its `_entries.cjs` bundle), this fails
        // and the brand can be reconsidered on purpose rather than by drift.
        assert.notEqual(
            main.AdminError,
            client.AdminError,
            'the CJS entries now share one class — revisit whether the brand is still needed',
        );
    });

    test('instanceof does not survive the split', () => {
        const err = new client.AdminError({ status: 404 });
        assert.equal(err instanceof main.AdminError, false);
    });

    test('the brand does, and the error keeps everything it carried', () => {
        const err = new client.AdminError({
            status: 409,
            code: 'PLAN_VERSION_ALREADY_PUBLISHED',
            body: { code: 'PLAN_VERSION_ALREADY_PUBLISHED' },
            detail: 'Version already published',
        });
        assert.equal(main.isAdminError(err), true);

        const seen = main.toAdminError(err);
        assert.equal(seen, err, 'a recognised error is passed through, not re-wrapped');
        assert.equal(seen.status, 409);
        assert.equal(seen.code, 'PLAN_VERSION_ALREADY_PUBLISHED');
        assert.equal(seen.detail, 'Version already published');
    });

    test('a foreign error is still wrapped, so the brand is not a blanket pass', () => {
        const wrapped = main.toAdminError(new Error('not ours'));
        assert.equal(wrapped.status, 0);
        assert.equal(wrapped.detail, 'not ours');
    });
});
