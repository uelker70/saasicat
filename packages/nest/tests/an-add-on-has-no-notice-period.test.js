import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { resolveBundleCancelEffectiveAt } from '../dist/billing/index.js';

// An add-on is cancellable at any time, effective at the end of its own period.
//
// Decided on 2026-08-27, and until then it was true only by omission: nothing
// in the bundle path had ever read the notice period, and nothing said whether
// that was the rule or an oversight. It is the rule. An add-on hangs off the
// plan that pays for it, its commitment is the minimum term, and a second
// waiting period on top would be one nobody could explain to a customer.
//
// Written as a guard rather than a sentence in the documentation, because the
// next person to touch this file will read the code and not the sentence.

const at = (s) => new Date(`${s}T00:00:00.000Z`);
const iso = (d) => d.toISOString().slice(0, 10);

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const EXPORT_KEYWORDS = new Set(['interface', 'function', 'const', 'type']);

/**
 * Every name a module exports, read line by line.
 *
 * One `split` on one character class rather than a pattern with `\s+ \{? \s*`
 * in it: two whitespace quantifiers with an optional group between them can
 * divide the same run of spaces in more than one way, which is the shape that
 * backtracks. This file is scanning our own source, so nothing hostile reaches
 * it — but the rule lives in the linter, and a ratchet that is stepped around
 * once is a ratchet.
 */
function exportedNames(text) {
    const names = [];
    for (const line of text.split('\n')) {
        if (!line.startsWith('export ')) continue;
        const words = line.split(/[^\w$]+/).filter(Boolean);
        if (words.length >= 3 && EXPORT_KEYWORDS.has(words[1])) names.push(words[2]);
    }
    return names;
}

// @requirement SC-BUN-011 — An add-on has no notice period
describe('the bundle path does not consult a notice period', () => {
    test('no source file on that path names anything that carries one', () => {
        // Structural on purpose: what has to stay true is that the concept
        // never enters here, and no behavioural test can assert the absence of
        // a term. Mounting and clicking would prove today's behaviour; this
        // proves the decision.
        //
        // The names come from the two files that own the concept rather than a
        // list written here — a list is the same defect one level up, and it
        // would miss a rename. The first attempt scanned for the WORD and
        // failed on a comment saying "no notice is needed", which is the
        // opposite of a violation: what is forbidden is reaching for the
        // machinery, not mentioning the idea.
        //
        // Every exported name is read and then filtered by the concept, rather
        // than matched by a shape: `CancellationNoticePeriods` is re-exported
        // (`export type { … }`) since the type moved to `@saasicat/core`, and a
        // pattern keyed to `export interface` stopped seeing it — the guard
        // went quiet on the day the surface changed, which is the day it was
        // most needed.
        const carriers = [
            ...exportedNames(src('../src/billing/cancellation.ts')),
            ...exportedNames(src('../src/billing/tenant-billing.tokens.ts')),
        ].filter((name) => /notice/i.test(name));
        assert.ok(carriers.length >= 3, `expected the notice machinery, found ${carriers}`);

        for (const file of [
            '../src/billing/subscription-bundles.service.ts',
            '../src/billing/subscription-bundle-preview.service.ts',
            '../src/billing/tenant-subscription-bundles.controller.ts',
        ]) {
            const text = src(file);
            const used = carriers.filter((name) => text.includes(name));
            assert.deepEqual(
                used,
                [],
                `${file} reaches for ${used.join(', ')} — an add-on has no notice period`,
            );
        }
    });

    test('the effective date is decided from the booking alone', () => {
        // Four facts, and none of them is a notice: when it was declared, the
        // booking's own period, its minimum term, and the plan's end.
        assert.deepEqual(
            Object.keys({
                canceledAt: 0,
                currentPeriodEnd: 0,
                minimumTermEndsAt: 0,
                parentEndsAt: 0,
            }).sort(),
            ['canceledAt', 'currentPeriodEnd', 'minimumTermEndsAt', 'parentEndsAt'],
        );
    });
});

// @requirement SC-BUN-009 — An add-on can be cancelled at any time and ends with the period it is in
// @requirement SC-BUN-011 — An add-on has no notice period
describe('cancelling an add-on', () => {
    const cancel = (overrides = {}) =>
        resolveBundleCancelEffectiveAt({
            canceledAt: at('2026-03-15'),
            currentPeriodEnd: at('2026-03-31'),
            minimumTermEndsAt: null,
            parentEndsAt: null,
            ...overrides,
        });

    test('on the last day of the period still ends with that period', () => {
        // The case a notice period would change, and the reason there is none:
        // a customer who decides on the 30th is not held for another month.
        assert.equal(iso(cancel({ canceledAt: at('2026-03-30') })), '2026-03-31');
    });

    test('on the first day of the period ends with the same period', () => {
        assert.equal(iso(cancel({ canceledAt: at('2026-03-01') })), '2026-03-31');
    });

    test('a minimum term still binds, because that is what was committed to', () => {
        assert.equal(iso(cancel({ minimumTermEndsAt: at('2026-09-30') })), '2026-09-30');
    });

    test('and the plan ending first caps it, because the add-on cannot outlive it', () => {
        assert.equal(
            iso(cancel({ minimumTermEndsAt: at('2026-09-30'), parentEndsAt: at('2026-05-31') })),
            '2026-05-31',
        );
    });

    test('a booking with no period of its own ends when it was declared', () => {
        // Nothing to wait for: no period, no term. Deferring to a date that
        // does not exist would be inventing one.
        assert.equal(
            iso(cancel({ currentPeriodEnd: null, canceledAt: at('2026-03-15') })),
            '2026-03-15',
        );
    });
});
