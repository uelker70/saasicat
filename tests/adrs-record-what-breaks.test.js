// An architecture decision record that only says what was decided is a note.
//
// The decisions in this repository are unusual enough to look like mistakes:
// `Symbol.for` for DI tokens, one CommonJS bundle behind re-export stubs, `.vue`
// files shipped as source. A reader who is not told why will "fix" them — that
// is not a hypothetical, it happened to the token rule and cost an outage.
//
// So every ADR carries the section that answers the question a reader actually
// has when they are about to break it: what happens then. This test holds the
// shape, and derives the set from the directory rather than a list.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADR_DIR = join(ROOT, 'docs/explanation/adr');

const REQUIRED_SECTIONS = [
    '## Context',
    '## Decision',
    '## Alternatives considered',
    '## Consequences',
    '## What breaks if you ignore this',
];

/** `0004-ui-vue-layer-boundaries.md` → `{ number: 4, file }`. */
export function records() {
    return readdirSync(ADR_DIR)
        .filter((name) => name.endsWith('.md'))
        .map((file) => {
            const [digits] = file.split('-');
            assert.match(digits, /^\d{4}$/, `${file} is not named NNNN-slug.md`);
            return { number: Number(digits), file };
        })
        .sort((a, b) => a.number - b.number);
}

describe('every architecture decision is recorded the same way', () => {
    const adrs = records();

    test('the sweep finds the records', () => {
        // Vacuously true on an empty directory, which is what a rename produces.
        assert.ok(adrs.length >= 5, `only ${adrs.length} ADRs found in ${ADR_DIR}`);
    });

    test('the numbering is unique and has no gaps', () => {
        assert.deepEqual(
            adrs.map((adr) => adr.number),
            adrs.map((_, index) => index + 1),
            'ADR numbers are the stable name a link uses — they run from 1 without gaps',
        );
    });

    test('each record carries a status, a date and the five sections', () => {
        const offenders = [];
        for (const { file } of adrs) {
            const text = readFileSync(join(ADR_DIR, file), 'utf8');
            if (!text.includes('**Status:**')) offenders.push(`${file}: no status`);
            if (!text.includes('**Date:**')) offenders.push(`${file}: no date`);
            for (const section of REQUIRED_SECTIONS) {
                if (!text.includes(`\n${section}\n`)) offenders.push(`${file}: no "${section}"`);
            }
        }
        assert.deepEqual(offenders, [], offenders.join('\n'));
    });

    test('the "what breaks" section says something', () => {
        const thin = [];
        for (const { file } of adrs) {
            const text = readFileSync(join(ADR_DIR, file), 'utf8');
            const section = text.split('## What breaks if you ignore this')[1] ?? '';
            const words = section.trim().split(/\s+/).filter(Boolean).length;
            if (words < 40) thin.push(`${file}: ${words} words`);
        }
        assert.deepEqual(thin, [], `A heading is not an answer.\n${thin.join('\n')}`);
    });
});
