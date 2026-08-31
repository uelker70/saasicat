// The pages under `docs/reference/` are derived, and this is what keeps them so.
//
// Same pattern as `codegen-drift` and `options-reference-is-generated`, for the
// same reason: a reference page maintained by hand describes what somebody
// remembered on the day they wrote it. The gap between that and the code is
// invisible — nothing renders it, nothing compiles it — right up until a reader
// passes an option that does nothing or catches a code that is never thrown.
//
// The generators also refuse to produce a page when their input has moved: a
// ports directory that yields nothing, an `src/ui` group with no heading, a
// role declared in one theme only. That failure is the point. A generator that
// quietly writes an empty page turns a rename into a silently emptied document.

// @requirement SC-READ-007 — Reference documentation is generated from the implementation

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderAll } from '../scripts/gen-docs/index.mjs';
import { declarations } from '../scripts/gen-docs/design-tokens.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Rendered on first use, not in the `describe` callback.
//
// `node --test` exits 0 when a describe body throws — the suite is marked ✖ and
// the run still reports success, which is how a generator that refused to
// render was carried past a local gate and only caught in CI. Awaited inside a
// test, the same throw is a test failure and the exit code says so.
let pending;
const pages = () => (pending ??= renderAll());

describe('the reference pages are generated, not maintained', () => {
    test('the generators produce every page they claim to', async () => {
        const rendered = await pages();
        // Vacuously true on an empty map, which is what a bad import produces.
        assert.ok(rendered.size >= 4, `only ${rendered.size} pages rendered`);
        for (const [target, text] of rendered) {
            assert.ok(text.split('\n').length > 20, `${target} rendered ${text.length} characters`);
        }
    });

    test('every page on disk is what the generator produces', async () => {
        // One test over all four rather than one test each: the per-page shape
        // needed the render at collection time, which meant awaiting in the
        // describe body — and a throw there leaves the run green. The page name
        // is in the message instead of in the test title.
        for (const [target, text] of await pages()) {
            assert.equal(
                readFileSync(join(ROOT, target), 'utf8'),
                text,
                `${target} differs from its source.\n` +
                    'Run: node scripts/gen-docs/index.mjs --write',
            );
        }
    });
});

describe('the token scanner reads the file, not the prose about it', () => {
    // A comment that names a token used to hide every declaration after it.
    // The scanner skipped a rejected candidate by jumping to its next colon,
    // and a name inside prose has its colon somewhere far below — so four roles
    // vanished from the light theme's table and twenty from the dark one's, and
    // the generator then refused the page for a role "declared in light only".
    // The bug arrived with one sentence of documentation.

    const CSS = `
:root {
    --sa-color-first: #111111;
    /* Prose about --sa-color-first and why it is not --sa-color-second:
     * the reason takes a few lines and mentions --sa-color-third. */
    --sa-color-second: #222222;
    --sa-color-third: var(--sa-color-first);
    --sa-color-fourth: #444444;
}
`;

    test('every declaration is found, whatever the comments say', () => {
        assert.deepEqual(
            declarations(CSS).map((d) => d.name),
            [
                '--sa-color-first',
                '--sa-color-second',
                '--sa-color-third',
                // After a `var()` reference on purpose. A rejected candidate
                // used to advance the scan to its next colon, which is this
                // line's — so the declaration right after a reference was the
                // one that disappeared. With nothing following the reference,
                // that half of the fix is unguarded, and it was.
                '--sa-color-fourth',
            ],
        );
    });

    test('a var() reference is still not a declaration', () => {
        // The counter-check for the fix: widening the scanner until comments
        // pass would also let `var(--sa-x)` through, and the table would then
        // list a token twice with the wrong value.
        const values = new Map(declarations(CSS).map((d) => [d.name, d.value]));
        assert.equal(values.get('--sa-color-third'), 'var(--sa-color-first)');
        assert.equal(values.size, 4);
    });

    test('a token name outside a declaration does not hide the next one', () => {
        // The other half of the fix, and the one that needed a reachable case
        // to be worth anything. A `var(--sa-x)` inside a value is never a
        // candidate — an accepted declaration consumes its whole value — so the
        // rejected path is reached only by a `--sa-` that begins nothing: in a
        // selector, an attribute value, a media query. Advancing to its next
        // colon then lands past the following declaration.
        const css = `
:root { --sa-color-a: #111111; }
[data-token='--sa-color-bogus'] { --sa-color-b: #222222; }
`;
        assert.deepEqual(
            declarations(css).map((d) => d.name),
            ['--sa-color-a', '--sa-color-b'],
        );
    });

    test('an unterminated comment swallows the rest rather than the scanner', () => {
        // `/*` with no close is a broken file. Reading past it would invent
        // declarations out of prose; the right answer is what precedes it.
        assert.deepEqual(
            declarations(':root { --sa-color-a: #111; /* --sa-color-b: #222; }').map((d) => d.name),
            ['--sa-color-a'],
        );
    });
});
