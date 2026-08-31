import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    BUNDLE_VERSION_WINDOW_CODES,
    PLAN_VERSION_WINDOW_CODES,
    resolveValidityWindow,
} from '../dist/catalog/index.js';

// The six refusals a published version's window can meet, tested where they
// are now decided.
//
// They used to live twice — once in `BundlesService`, once in
// `PlanVersionsService` — and the tests followed that shape: three of the six
// refusals were exercised on the bundle side, two on the plan side, and
// `VALID_FROM_INVALID` and `VALID_UNTIL_INVALID` on neither. A rule that is
// covered on one caller and not the other is covered by accident, because
// nothing said the two were the same rule.

/** The `code` a refusal carries, or `null` when the call was accepted. */
function refusalOf(publishMeta, draft, previous, codes = BUNDLE_VERSION_WINDOW_CODES) {
    try {
        resolveValidityWindow(publishMeta, draft, previous, codes);
        return null;
    } catch (err) {
        return err.getResponse?.().code ?? null;
    }
}

const CODES = BUNDLE_VERSION_WINDOW_CODES;

// @requirement SC-PLAN-011 — A published version says which day it applies from
// @requirement SC-PLAN-012 — There is no gap and no overlap between two versions of a plan
describe('the window a version is published with', () => {
    test('the publish call wins over the draft for the start', () => {
        const { validFrom } = resolveValidityWindow(
            { validFrom: '2026-03-01' },
            { validFrom: '2026-01-01' },
            null,
            CODES,
        );

        assert.equal(validFrom.toISOString().slice(0, 10), '2026-03-01');
    });

    test('the draft carries the start when the call does not', () => {
        const { validFrom } = resolveValidityWindow({}, { validFrom: '2026-01-01' }, null, CODES);

        assert.equal(validFrom.toISOString().slice(0, 10), '2026-01-01');
    });

    test('an explicit null end means unbounded, not "ask the draft"', () => {
        // The one asymmetry in this function, and the reason it does not use
        // `??` for both fields: a caller who says `validUntil: null` is saying
        // the version does not end, and reading the draft's end there would
        // publish a window the caller refused.
        const { validUntil } = resolveValidityWindow(
            { validFrom: '2026-01-01', validUntil: null },
            { validFrom: '2026-01-01', validUntil: '2026-06-30' },
            null,
            CODES,
        );

        assert.equal(validUntil, null);
    });

    test('a silent call still takes the draft’s end', () => {
        const { validUntil } = resolveValidityWindow(
            { validFrom: '2026-01-01' },
            { validFrom: '2026-01-01', validUntil: '2026-06-30' },
            null,
            CODES,
        );

        assert.equal(validUntil?.toISOString().slice(0, 10), '2026-06-30');
    });
});

// @requirement SC-PLAN-016 — A version can be given an end date, and it lies in the future
// @requirement SC-PRIC-016 — A tax rate has a validity window
describe('the window a version is refused for', () => {
    test('no start at all', () => {
        assert.equal(refusalOf({}, {}, null), CODES.validFromRequired);
    });

    test('a start that is not a date', () => {
        assert.equal(refusalOf({ validFrom: 'someday' }, {}, null), CODES.validFromInvalid);
    });

    test('a start on or before the predecessor’s', () => {
        const previous = { validFrom: '2026-03-01' };

        assert.equal(
            refusalOf({ validFrom: '2026-02-01' }, {}, previous),
            CODES.validFromNotAfterPrevious,
        );
        assert.equal(
            refusalOf({ validFrom: '2026-03-01' }, {}, previous),
            CODES.validFromNotAfterPrevious,
        );
    });

    test('a start that leaves a gap after a predecessor that ends', () => {
        // The predecessor ends on the 31st, so the successor starts on the 1st.
        // A day later is a day with no valid version; a day earlier is a day
        // with two.
        const previous = { validFrom: '2026-01-01', validUntil: '2026-03-31' };

        assert.equal(refusalOf({ validFrom: '2026-04-01' }, {}, previous), null);
        assert.equal(
            refusalOf({ validFrom: '2026-04-02' }, {}, previous),
            CODES.validFromNotGapless,
        );
        // A day INSIDE the predecessor's window is refused by the same rule,
        // not by the ordering one: "strictly after" is measured against the
        // predecessor's start, and the 31st is after the 1st of January. The
        // seam is what catches the overlap.
        assert.equal(
            refusalOf({ validFrom: '2026-03-31' }, {}, previous),
            CODES.validFromNotGapless,
        );
    });

    test('a predecessor without an end imposes no seam', () => {
        const previous = { validFrom: '2026-01-01' };

        assert.equal(refusalOf({ validFrom: '2027-09-09' }, {}, previous), null);
    });

    test('an end that is not a date', () => {
        assert.equal(
            refusalOf({ validFrom: '2026-01-01', validUntil: 'someday' }, {}, null),
            CODES.validUntilInvalid,
        );
    });

    test('an end on or before the start', () => {
        assert.equal(
            refusalOf({ validFrom: '2026-03-01', validUntil: '2026-03-01' }, {}, null),
            CODES.validUntilBeforeFrom,
        );
    });

    test('the codes come from the caller, so a plan refuses as a plan', () => {
        // The whole point of the parameter: one rule, two vocabularies. A
        // consumer matching on `PLAN_VERSION_*` must not start receiving
        // `BUNDLE_VERSION_*` because the implementation moved.
        assert.equal(
            refusalOf({}, {}, null, PLAN_VERSION_WINDOW_CODES),
            PLAN_VERSION_WINDOW_CODES.validFromRequired,
        );
        assert.notEqual(
            PLAN_VERSION_WINDOW_CODES.validFromRequired,
            BUNDLE_VERSION_WINDOW_CODES.validFromRequired,
        );
    });

    test('the gapless refusal says which day it wanted', () => {
        // The message is what an operator acts on, and it names the day rather
        // than restating the rule.
        try {
            resolveValidityWindow(
                { validFrom: '2026-05-01' },
                {},
                { validFrom: '2026-01-01', validUntil: '2026-03-31' },
                CODES,
            );
            assert.fail('expected the publish to be refused');
        } catch (err) {
            const body = err.getResponse();
            assert.equal(body.requiredValidFrom, '2026-04-01');
            assert.equal(body.previousValidUntil, '2026-03-31');
            assert.match(body.message, /2026-04-01/);
        }
    });
});
