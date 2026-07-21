import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildActivePlanVersionWhere, startOfUtcDay } from '../dist/index.js';

const ASOF = new Date('2026-06-03T12:00:00Z');
const ASOF_DAY_START = new Date('2026-06-03T00:00:00Z');

describe('buildActivePlanVersionWhere', () => {
    test('requires publishedAt IS NOT NULL', () => {
        const where = buildActivePlanVersionWhere(ASOF);
        assert.deepEqual(where.publishedAt, { not: null });
    });

    test('tolerates validFrom IS NULL ("valid since forever") alongside validFrom <= asOf', () => {
        const where = buildActivePlanVersionWhere(ASOF);
        const validFromClause = where.AND.find((c) =>
            c.OR.some((o) => 'validFrom' in o),
        );
        assert.ok(validFromClause, 'validFrom clause missing');
        assert.deepEqual(validFromClause.OR, [{ validFrom: null }, { validFrom: { lte: ASOF } }]);
    });

    test('validUntil day-inclusive: >= startOfDay(asOf), not > asOf', () => {
        const where = buildActivePlanVersionWhere(ASOF);
        const validUntilClause = where.AND.find((c) => c.OR.some((o) => 'validUntil' in o));
        // Day-inclusive: a version with validUntil = today 00:00 is still active
        // today (gte start of day), not only when > now.
        assert.deepEqual(validUntilClause.OR, [
            { validUntil: null },
            { validUntil: { gte: ASOF_DAY_START } },
        ]);
    });

    test('startOfUtcDay normalizes to 00:00 UTC', () => {
        assert.deepEqual(startOfUtcDay(ASOF), ASOF_DAY_START);
        assert.deepEqual(startOfUtcDay(new Date('2026-06-03T23:59:59Z')), ASOF_DAY_START);
    });

    test('without withEndsAt: no endsAt clause (CatalogPlanVersion)', () => {
        const where = buildActivePlanVersionWhere(ASOF);
        assert.equal(where.AND.length, 2);
        assert.ok(!where.AND.some((c) => c.OR.some((o) => 'endsAt' in o)));
    });

    test('withEndsAt: adds an endsAt clause (PlanVersion)', () => {
        const where = buildActivePlanVersionWhere(ASOF, { withEndsAt: true });
        assert.equal(where.AND.length, 3);
        const endsAtClause = where.AND.find((c) => c.OR.some((o) => 'endsAt' in o));
        assert.deepEqual(endsAtClause.OR, [{ endsAt: null }, { endsAt: { gt: ASOF } }]);
    });
});
