// @requirement SC-PLAN-011 — A published version says which day it applies from
// @requirement SC-PLAN-018 — The version that applies is the one valid on the day of the purchase

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildActivePlanVersionWhere, isVersionActiveAt, startOfUtcDay } from '../dist/index.js';

const ASOF = new Date('2026-06-03T12:00:00Z');
const ASOF_DAY_START = new Date('2026-06-03T00:00:00Z');

describe('buildActivePlanVersionWhere', () => {
    test('requires publishedAt IS NOT NULL', () => {
        const where = buildActivePlanVersionWhere(ASOF);
        assert.deepEqual(where.publishedAt, { not: null });
    });

    test('tolerates validFrom IS NULL ("valid since forever") alongside validFrom <= asOf', () => {
        const where = buildActivePlanVersionWhere(ASOF);
        const validFromClause = where.AND.find((c) => c.OR.some((o) => 'validFrom' in o));
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

// @requirement SC-SUB-020 — A newer version is offered, classified against the version bound
describe('isVersionActiveAt — the same window, for a row already read', () => {
    test('validFrom is inclusive to the millisecond', () => {
        assert.equal(isVersionActiveAt({ validFrom: ASOF }, ASOF), true);
        assert.equal(isVersionActiveAt({ validFrom: new Date(ASOF.getTime() + 1) }, ASOF), false);
    });

    test('validUntil is inclusive of its whole day', () => {
        assert.equal(isVersionActiveAt({ validUntil: ASOF_DAY_START }, ASOF), true);
        const dayBefore = new Date('2026-06-02T00:00:00Z');
        assert.equal(isVersionActiveAt({ validUntil: dayBefore }, ASOF), false);
    });

    test('endsAt is exclusive: a version ended at the moment takes nothing', () => {
        assert.equal(isVersionActiveAt({ endsAt: ASOF }, ASOF), false);
        assert.equal(isVersionActiveAt({ endsAt: new Date(ASOF.getTime() + 1) }, ASOF), true);
    });

    test('an absent date does not close the window, and dates may come as strings', () => {
        assert.equal(isVersionActiveAt({}, ASOF), true);
        assert.equal(isVersionActiveAt({ validFrom: '2026-06-03', endsAt: null }, ASOF), true);
    });

    test('agrees with the WHERE clause on every combination around the boundaries', () => {
        // The clause read the way the database reads it, so the two
        // formulations of one window cannot drift apart unnoticed.
        const where = buildActivePlanVersionWhere(ASOF, { withEndsAt: true });
        const holds = (row, clause) => {
            const [[field, bound]] = Object.entries(clause);
            if (bound === null) return row[field] === null;
            if (row[field] === null) return false;
            if (bound.lte) return row[field] <= bound.lte;
            if (bound.gte) return row[field] >= bound.gte;
            return row[field] > bound.gt;
        };
        const matches = (row) => where.AND.every(({ OR }) => OR.some((c) => holds(row, c)));
        const around = (at) => [null, new Date(at.getTime() - 1), at, new Date(at.getTime() + 1)];
        for (const validFrom of around(ASOF)) {
            for (const validUntil of around(ASOF_DAY_START)) {
                for (const endsAt of around(ASOF)) {
                    const row = { validFrom, validUntil, endsAt };
                    assert.equal(isVersionActiveAt(row, ASOF), matches(row), JSON.stringify(row));
                }
            }
        }
    });
});
