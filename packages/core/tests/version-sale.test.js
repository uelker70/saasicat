import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { versionOnSale, versionOnSaleOrNext, versionSale } from '../dist/index.js';

// Where a version stands — the state the admin shows and the platform decides
// by. Version 1 sells from January; version 2 is published on 10 June with a
// start on 1 July, which supersedes version 1 at once and gives it 30 June as
// its last day. Until then version 1 is the one a tenant books, so it is the one
// called on sale.

const at = (instant) => new Date(instant);

const V1 = {
    version: 1,
    publishedAt: '2026-01-01T00:00:00.000Z',
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2026-06-30T00:00:00.000Z',
    supersededAt: '2026-06-10T00:00:00.000Z',
};
const V2 = {
    version: 2,
    publishedAt: '2026-06-10T00:00:00.000Z',
    validFrom: '2026-07-01T00:00:00.000Z',
};

// @requirement SC-PLAN-028 — The admin says whether a version is on sale by the rule a booking follows
describe('the sale state of a version', () => {
    it('is on sale until its last day, though a successor has superseded it', () => {
        assert.deepEqual(versionSale(V1, at('2026-06-15T12:00:00Z')), {
            kind: 'on-sale',
            until: '2026-06-30',
        });
    });

    it('stays on sale for the whole of its last day', () => {
        assert.equal(versionSale(V1, at('2026-06-30T23:00:00Z')).kind, 'on-sale');
    });

    it('is off sale from the day after its last day', () => {
        assert.deepEqual(versionSale(V1, at('2026-07-01T00:00:00Z')), {
            kind: 'off-sale',
            since: '2026-07-01',
        });
    });

    it('is on sale from its first day before it starts', () => {
        assert.deepEqual(versionSale(V2, at('2026-06-15T12:00:00Z')), {
            kind: 'scheduled',
            from: '2026-07-01',
        });
        assert.deepEqual(versionSale(V2, at('2026-07-01T00:00:00Z')), {
            kind: 'on-sale',
            until: null,
        });
    });

    it('is off sale, with no day, when it was superseded without a last day', () => {
        const legacy = { publishedAt: '2026-01-01', supersededAt: '2026-03-01' };
        assert.deepEqual(versionSale(legacy, at('2026-06-15T12:00:00Z')), {
            kind: 'off-sale',
            since: null,
        });
    });

    it('is not announced when it was superseded before it ever started', () => {
        const never = {
            publishedAt: '2026-04-01',
            validFrom: '2026-07-01',
            validUntil: '2026-04-30',
            supersededAt: '2026-04-20',
        };
        assert.equal(versionSale(never, at('2026-04-25T12:00:00Z')).kind, 'off-sale');
    });

    it('ends at its end moment, and is on sale until the day before a midnight end', () => {
        const ending = {
            publishedAt: '2026-01-01',
            validFrom: '2026-01-01',
            endsAt: '2026-07-01T00:00:00Z',
        };
        assert.deepEqual(versionSale(ending, at('2026-06-15T12:00:00Z')), {
            kind: 'on-sale',
            until: '2026-06-30',
        });
        assert.deepEqual(versionSale(ending, at('2026-07-01T00:00:00Z')), {
            kind: 'off-sale',
            since: '2026-07-01',
        });
    });

    it('reads an end at the close of a day as that day sold in full', () => {
        // How the admin's terminate dialog writes an end.
        const ending = { publishedAt: '2026-01-01', endsAt: '2026-06-30T23:59:59.000Z' };
        assert.deepEqual(versionSale(ending, at('2026-06-30T12:00:00Z')), {
            kind: 'on-sale',
            until: '2026-06-30',
        });
        assert.deepEqual(versionSale(ending, at('2026-07-01T12:00:00Z')), {
            kind: 'off-sale',
            since: '2026-07-01',
        });
    });

    it('takes the earlier of a last day and an end', () => {
        const both = {
            publishedAt: '2026-01-01',
            validUntil: '2026-06-30',
            endsAt: '2026-06-20T00:00:00Z',
        };
        assert.equal(versionSale(both, at('2026-06-15T12:00:00Z')).until, '2026-06-19');
    });

    it('is a draft until it is published', () => {
        assert.deepEqual(versionSale({ publishedAt: null }, at('2026-06-15T12:00:00Z')), {
            kind: 'draft',
        });
    });
});

// @requirement SC-PLAN-028 — The admin says whether a version is on sale by the rule a booking follows
describe('the version on sale among several', () => {
    it('is the superseded predecessor until its successor starts, then the successor', () => {
        assert.equal(versionOnSale([V1, V2], at('2026-06-15T12:00:00Z')), V1);
        assert.equal(versionOnSale([V1, V2], at('2026-07-01T00:00:00Z')), V2);
    });

    it('prefers the latest start, a version without one last, then the highest number', () => {
        const undated = { version: 5, publishedAt: '2026-01-01' };
        const dated = { version: 3, publishedAt: '2026-01-01', validFrom: '2026-02-01' };
        assert.equal(versionOnSale([undated, dated], at('2026-06-15T12:00:00Z')), dated);
        const older = { version: 1, publishedAt: '2026-01-01' };
        assert.equal(versionOnSale([older, undated], at('2026-06-15T12:00:00Z')), undated);
    });

    it('is nobody when nothing is on sale', () => {
        assert.equal(versionOnSale([V2], at('2026-06-15T12:00:00Z')), null);
    });

    it('is, for a listing, the next one scheduled where nothing is on sale yet', () => {
        const later = { version: 3, publishedAt: '2026-06-12', validFrom: '2026-09-01' };
        assert.equal(versionOnSaleOrNext([later, V2], at('2026-06-15T12:00:00Z')), V2);
        assert.equal(versionOnSaleOrNext([V1, V2], at('2026-06-15T12:00:00Z')), V1);
        assert.equal(
            versionOnSaleOrNext([{ publishedAt: null }], at('2026-06-15T12:00:00Z')),
            null,
        );
    });
});
