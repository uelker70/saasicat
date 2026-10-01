// @requirement SC-PLAN-018 — The version that applies is the one valid on the day of the purchase

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { countPlans, resolvePlans } from '../dist/client/index.js';

// The plan listing and the counts above it come from this one derivation, so a
// rule that changes here changes both at once. That is the point: they used to
// be the same sixty lines in two components, free to drift.
//
// `now` is injected so the sale rules can be tested at all — with the real
// date, every assertion about "scheduled" or "expired" would rot.

const NOW = new Date('2026-06-15T12:00:00Z');

function plan(planKey, sortOrder = 0) {
    return { id: `p-${planKey}`, planKey, label: planKey, sortOrder };
}

function version(id, over = {}) {
    return { id, publishedAt: '2026-01-01', validFrom: null, validUntil: null, ...over };
}

function resolve(plans, versionsByPlanId, tenantCountsByPlanKey = {}) {
    return resolvePlans({ plans, versionsByPlanId, tenantCountsByPlanKey, now: NOW });
}

describe('resolvePlans', () => {
    it('picks the version on sale', () => {
        const [row] = resolve([plan('PRO')], {
            'p-PRO': [
                version('v1', { validFrom: '2026-01-01', validUntil: '2026-06-01' }),
                version('v2', { validFrom: '2026-06-01' }),
            ],
        });

        assert.equal(row.onSale.id, 'v2');
        assert.equal(row.primary.id, 'v2');
    });

    it('falls back to the next scheduled version when nothing is on sale', () => {
        const [row] = resolve([plan('PRO')], {
            'p-PRO': [
                version('later', { validFrom: '2026-09-01' }),
                version('sooner', { validFrom: '2026-07-01' }),
            ],
        });

        assert.equal(row.onSale, null);
        assert.equal(row.primary.id, 'sooner', 'the nearer date wins');
    });

    it('gives a plan with only drafts a row without a version', () => {
        const [row] = resolve([plan('PRO')], {
            'p-PRO': [version('d1', { publishedAt: null })],
        });

        assert.equal(row.primary, null);
        assert.equal(row.draft.id, 'd1');
        assert.equal(row.allExpired, false, 'a draft is not an expired plan');
    });

    it('marks a plan expired only when nothing is left to come', () => {
        const expired = version('old', { validUntil: '2026-01-01' });

        const [gone] = resolve([plan('OLD')], { 'p-OLD': [expired] });
        assert.equal(gone.allExpired, true);

        const [withDraft] = resolve([plan('OLD')], {
            'p-OLD': [expired, version('d', { publishedAt: null })],
        });
        assert.equal(withDraft.allExpired, false, 'an open draft keeps the plan listed');

        const [withFuture] = resolve([plan('OLD')], {
            'p-OLD': [expired, version('next', { validFrom: '2026-12-01' })],
        });
        assert.equal(withFuture.allExpired, false, 'a scheduled version keeps it listed');
    });

    it('lists sub-rows without repeating the parent', () => {
        const [row] = resolve([plan('PRO')], {
            'p-PRO': [
                version('live', { validFrom: '2026-01-01' }),
                version('future', { validFrom: '2026-08-01' }),
                version('draft', { publishedAt: null }),
            ],
        });

        assert.equal(row.primary.id, 'live');
        assert.deepEqual(
            row.subRows.map((v) => v.id),
            ['future', 'draft'],
            'scheduled first, drafts last, parent not repeated',
        );
    });

    it('sells a superseded predecessor until its successor starts', () => {
        // Published on 10 June with a start on 1 July: the predecessor is
        // superseded and carries 30 June as its last day, so it is still the
        // version on sale today.
        const [row] = resolve([plan('PRO')], {
            'p-PRO': [
                version('v1', {
                    validFrom: '2026-01-01',
                    validUntil: '2026-06-30',
                    supersededAt: '2026-06-10',
                }),
                version('v2', { validFrom: '2026-07-01' }),
            ],
        });

        assert.equal(row.onSale.id, 'v1');
        assert.deepEqual(
            row.subRows.map((v) => v.id),
            ['v2'],
        );
    });

    it('sells a version on the whole of its last day', () => {
        const [row] = resolve([plan('PRO')], {
            'p-PRO': [version('v1', { validFrom: '2026-01-01', validUntil: '2026-06-15' })],
        });

        assert.equal(row.onSale.id, 'v1');
    });

    it('does not sell a version superseded without a last day', () => {
        const [row] = resolve([plan('OLD')], {
            'p-OLD': [version('v0', { supersededAt: '2026-03-01' })],
        });

        assert.equal(row.onSale, null);
        assert.equal(row.allExpired, true, 'nothing left: hidden from the listing');
    });

    it('does not sell a version that has ended, and hides a plan with nothing else', () => {
        const [row] = resolve([plan('OLD')], {
            'p-OLD': [version('v1', { validFrom: '2026-01-01', endsAt: '2026-06-01T00:00:00Z' })],
        });

        assert.equal(row.onSale, null);
        assert.equal(row.allExpired, true);
    });

    it('sorts by sortOrder, then by key', () => {
        const rows = resolve([plan('B', 2), plan('A', 2), plan('C', 1)], {});

        assert.deepEqual(
            rows.map((r) => r.planKey),
            ['C', 'A', 'B'],
        );
    });
});

describe('countPlans', () => {
    it('counts what the tiles above the list show', () => {
        const resolved = resolve(
            [plan('LIVE'), plan('DRAFT'), plan('EMPTY')],
            {
                'p-LIVE': [version('v', { validFrom: '2026-01-01' })],
                'p-DRAFT': [version('d', { publishedAt: null })],
            },
            { LIVE: 3, DRAFT: 1 },
        );

        assert.deepEqual(countPlans(resolved), {
            plans: 3,
            onSale: 1,
            drafts: 1,
            tenants: 4,
        });
    });
});
