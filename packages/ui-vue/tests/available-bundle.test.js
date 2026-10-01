import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { availableBundle } from '../dist/client/index.js';

// An add-on beside the plans, as the plan pages offer it. Its list of plans is
// what marks it bookable per plan column, and an empty list means every plan —
// so an add-on that cannot be booked at all must not be offered with one.

const NOW = new Date('2026-06-15T12:00:00Z');
const BUNDLE = { bundleKey: 'SMS', label: 'SMS pack' };

function version(fields) {
    return {
        version: 1,
        publishedAt: '2026-01-01T00:00:00.000Z',
        features: ['SMS'],
        compatibility: { planIds: ['PRO'] },
        ...fields,
    };
}

// @requirement SC-PLAN-028 — The admin says whether a version is on sale by the rule a booking follows
describe('an add-on offered beside the plans', () => {
    it('is offered at its version on sale, on the plans that version allows', () => {
        assert.deepEqual(availableBundle(BUNDLE, [version({})], NOW), {
            bundleKey: 'SMS',
            label: 'SMS pack',
            features: ['SMS'],
            compatiblePlanKeys: ['PRO'],
        });
    });

    it('is offered at its next version where none is on sale yet', () => {
        const next = version({ validFrom: '2026-09-01T00:00:00.000Z', features: ['SMS', 'MMS'] });
        assert.deepEqual(availableBundle(BUNDLE, [next], NOW).features, ['SMS', 'MMS']);
    });

    it('is not offered once its last version has ended', () => {
        assert.equal(availableBundle(BUNDLE, [version({ validUntil: '2026-05-31' })], NOW), null);
        assert.equal(
            availableBundle(BUNDLE, [version({ endsAt: '2026-06-01T00:00:00Z' })], NOW),
            null,
        );
        assert.equal(
            availableBundle(BUNDLE, [version({ supersededAt: '2026-03-01' })], NOW),
            null,
            'superseded without a last day',
        );
    });

    it('is not offered with only a draft', () => {
        assert.equal(availableBundle(BUNDLE, [version({ publishedAt: null })], NOW), null);
    });

    it('keeps an empty list of plans meaning every plan where the version says so', () => {
        const open = version({ compatibility: {} });
        assert.deepEqual(availableBundle(BUNDLE, [open], NOW).compatiblePlanKeys, []);
    });
});
