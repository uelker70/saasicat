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

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderAll } from '../scripts/gen-docs/index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('the reference pages are generated, not maintained', async () => {
    const rendered = await renderAll();

    test('the generators produce every page they claim to', () => {
        // Vacuously true on an empty map, which is what a bad import produces.
        assert.ok(rendered.size >= 4, `only ${rendered.size} pages rendered`);
        for (const [target, text] of rendered) {
            assert.ok(text.split('\n').length > 20, `${target} rendered ${text.length} characters`);
        }
    });

    for (const [target, text] of rendered) {
        test(`${target} is what the generator produces`, () => {
            const committed = readFileSync(join(ROOT, target), 'utf8');
            assert.equal(
                committed,
                text,
                `${target} differs from its source.\n` +
                    'Run: node scripts/gen-docs/index.mjs --write',
            );
        });
    }
});
