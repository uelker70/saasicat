// A recorded baseline is a claim about what a page looks like. A node that was
// on its way out when the reading was taken is not part of that.
//
// This is the cheap half of a lesson the expensive half taught twice: the
// visual collector used to sample while Quasar's refresh spinner was leaving,
// and `--update-snapshots` wrote the spinner into the baseline as the truth.
// After that the suite was green — against a recording of a transient state,
// which is the failure mode a baseline is least able to report on its own.
//
// The browser-side guard lives in `visual-baseline.spec.ts` and needs a
// browser. This one needs nothing, runs with `test:repo`, and answers the
// question the other cannot: is any baseline ALREADY polluted?

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SNAPSHOTS = fileURLToPath(
    new URL('../packages/ui-vue/tests/e2e/visual-baseline.spec.ts-snapshots/', import.meta.url),
);

/** Vue's class convention for an element the DOM has not finished removing. */
const DEPARTING = '-leave-active';

describe('recorded baselines', () => {
    test('none of them recorded a node that was leaving', () => {
        const files = readdirSync(SNAPSHOTS).filter((name) => name.endsWith('.txt'));

        // The sweep is worth nothing on an empty directory.
        assert.ok(files.length > 15, `only ${files.length} baselines found — the path is wrong`);

        const polluted = files
            .map((name) => ({
                name,
                lines: readFileSync(join(SNAPSHOTS, name), 'utf8').split('\n'),
            }))
            .flatMap(({ name, lines }) =>
                lines
                    .filter((line) => line.includes(DEPARTING))
                    .map((line) => `${name}: ${line.slice(0, line.indexOf(' '))}`),
            );

        assert.deepEqual(
            polluted,
            [],
            `these baselines recorded a page mid-transition:\n  ${polluted.join('\n  ')}`,
        );
    });
});
