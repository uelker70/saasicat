// The row -> record mappers both adapters share.
//
// They are the one place that decides what a canonical column becomes, so the
// cases worth pinning are the ones where a column can be absent, malformed, or
// carried in a shape only one adapter uses: a Prisma `Decimal` against a
// Drizzle numeric string, a JSON column holding something other than what it
// should, a schema without the validity columns at all.

// @requirement SC-COMP-010 — An integrator's own data access translates; it does not decide
// @requirement SC-COMP-011 — Every data-access implementation is held to the same executable contract

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    toContractLineItemRecord,
    toPlanRow,
    toPlanVersionRow,
    toSubscriptionContractRecord,
} from '../dist/index.js';

const CREATED = new Date('2026-01-01T00:00:00.000Z');
const UPDATED = new Date('2026-02-01T00:00:00.000Z');

function planRow(overrides = {}) {
    return {
        id: 'plan-1',
        planKey: 'STANDARD',
        label: 'Standard',
        description: null,
        icon: null,
        sortOrder: 0,
        createdAt: CREATED,
        updatedAt: UPDATED,
        deletedAt: null,
        ...overrides,
    };
}

function versionRow(overrides = {}) {
    return {
        id: 'version-1',
        version: 1,
        baseVersionId: null,
        features: ['CORE'],
        quotas: { users: 5 },
        monthlyNet: '19.90',
        yearlyNet: '199.00',
        marketed: true,
        publishedAt: CREATED,
        supersededAt: null,
        publishedChanges: null,
        changeNote: '',
        nonRegressive: true,
        validFrom: CREATED,
        validUntil: UPDATED,
        endsAt: null,
        createdByUserId: null,
        publishedByUserId: null,
        createdAt: CREATED,
        updatedAt: UPDATED,
        ...overrides,
    };
}

const WINDOWS = { validityWindows: true, endsAt: true };

describe('a plan row becomes a plan record', () => {
    test('dates leave as ISO strings, and an undeleted plan says so', () => {
        const row = toPlanRow(planRow());
        assert.equal(row.createdAt, '2026-01-01T00:00:00.000Z');
        assert.equal(row.updatedAt, '2026-02-01T00:00:00.000Z');
        assert.equal(row.deletedAt, null);
    });

    test('a soft-deleted plan carries the date it was deleted on', () => {
        const row = toPlanRow(planRow({ deletedAt: UPDATED }));
        assert.equal(row.deletedAt, '2026-02-01T00:00:00.000Z');
    });
});

describe('a plan version row becomes a version record', () => {
    test('the plan key is the one passed, not the one on the row', () => {
        // The canonical schema stores the key in `planId`, but an adapter
        // translating a schema with a real foreign key resolves it first.
        const row = toPlanVersionRow(versionRow(), 'PRO', WINDOWS);
        assert.equal(row.planId, 'PRO');
    });

    test('prices survive as strings, whatever the driver handed over', () => {
        // Prisma gives a Decimal, Drizzle a numeric string. Both must arrive as
        // the same string — a number here would round money on the way out.
        const asDecimal = { toString: () => '19.90' };
        const row = toPlanVersionRow(
            versionRow({ monthlyNet: asDecimal, yearlyNet: asDecimal }),
            'STANDARD',
            WINDOWS,
        );
        assert.equal(row.monthlyNet, '19.90');
        assert.equal(row.yearlyNet, '19.90');
    });

    test('a schema without validity windows reads them as null, not as dates', () => {
        // The columns may hold values from an adapter that does not maintain
        // them. Reporting those would state a booking window nobody keeps.
        const row = toPlanVersionRow(versionRow(), 'STANDARD', {
            validityWindows: false,
            endsAt: false,
        });
        assert.equal(row.validFrom, null);
        assert.equal(row.validUntil, null);
    });

    test('a schema without endsAt omits the field rather than saying null', () => {
        // Absent and null are different answers: "cannot say" against "not
        // terminated".
        const without = toPlanVersionRow(versionRow(), 'STANDARD', {
            validityWindows: true,
            endsAt: false,
        });
        assert.equal('endsAt' in without, false);
        const with_ = toPlanVersionRow(versionRow(), 'STANDARD', WINDOWS);
        assert.equal(with_.endsAt, null);
    });

    test('publishedChanges that is not an array reads as null', () => {
        assert.equal(
            toPlanVersionRow(versionRow({ publishedChanges: { not: 'an array' } }), 'X', WINDOWS)
                .publishedChanges,
            null,
        );
    });

    test('features and quotas drop entries of the wrong type', () => {
        const row = toPlanVersionRow(
            versionRow({ features: ['CORE', 7, null], quotas: { users: 5, seats: 'many' } }),
            'X',
            WINDOWS,
        );
        assert.deepEqual(row.features, ['CORE']);
        assert.deepEqual(row.quotas, { users: 5 });
    });

    test('a JSON column holding nothing usable reads as empty, not as a crash', () => {
        const row = toPlanVersionRow(versionRow({ features: null, quotas: null }), 'X', WINDOWS);
        assert.deepEqual(row.features, []);
        assert.deepEqual(row.quotas, {});
    });
});

function contractRow(overrides = {}) {
    return {
        id: 'contract-1',
        tenantId: 'tenant-1',
        status: 'active',
        effectiveFrom: CREATED,
        effectiveUntil: null,
        originalOfferId: null,
        originalPlanVersionId: null,
        originalBundleVersionIds: ['bundle-version-1'],
        entitlementSnapshot: { plan: 'STANDARD', features: ['CORE'], quotas: { users: 5 } },
        priceSnapshot: { currency: 'EUR', totalNet: 19.9 },
        promotionSnapshots: [],
        promoCodeSnapshots: [],
        termsSnapshot: { noticePeriodDays: 30 },
        createdAt: CREATED,
        updatedAt: UPDATED,
        ...overrides,
    };
}

function lineItemRow(overrides = {}) {
    return {
        id: 'line-1',
        contractId: 'contract-1',
        kind: 'plan',
        sourceKey: 'STANDARD',
        sourceVersionId: null,
        titleSnapshot: 'Standard',
        descriptionSnapshot: null,
        quantity: 1,
        unit: null,
        priceNet: '19.90',
        priceGross: '23.68',
        billingCycle: 'monthly',
        minimumTermUntil: null,
        featuresSnapshot: ['CORE'],
        quotaEffectsSnapshot: { users: 5 },
        metadata: null,
        createdAt: CREATED,
        ...overrides,
    };
}

describe('a contract row becomes a contract record', () => {
    test('dates stay Date objects — a contract record is not a wire format', () => {
        const record = toSubscriptionContractRecord(contractRow(), []);
        assert.ok(record.effectiveFrom instanceof Date);
        assert.equal(record.effectiveFrom.getTime(), CREATED.getTime());
        assert.equal(record.effectiveUntil, null);
    });

    test('the lines it is handed become its lines', () => {
        const record = toSubscriptionContractRecord(contractRow(), [
            lineItemRow(),
            lineItemRow({ id: 'line-2', kind: 'bundle' }),
        ]);
        assert.deepEqual(
            record.lineItems.map((item) => item.id),
            ['line-1', 'line-2'],
        );
    });

    test('an entitlement snapshot that is not an object reads as null', () => {
        // A contract without a usable snapshot must say so. Handing back `[]`
        // or `{}` would look like an agreement granting nothing.
        assert.equal(
            toSubscriptionContractRecord(contractRow({ entitlementSnapshot: ['wrong'] }), [])
                .entitlementSnapshot,
            null,
        );
        assert.equal(
            toSubscriptionContractRecord(contractRow({ entitlementSnapshot: null }), [])
                .entitlementSnapshot,
            null,
        );
    });

    test('snapshot arrays that are not arrays read as empty', () => {
        const record = toSubscriptionContractRecord(
            contractRow({ promotionSnapshots: null, promoCodeSnapshots: 'nonsense' }),
            [],
        );
        assert.deepEqual(record.promotionSnapshots, []);
        assert.deepEqual(record.promoCodeSnapshots, []);
    });

    test('terms that are not an object read as null', () => {
        assert.equal(
            toSubscriptionContractRecord(contractRow({ termsSnapshot: 'nonsense' }), [])
                .termsSnapshot,
            null,
        );
    });
});

describe('a line item row becomes a line item record', () => {
    test('money becomes a number, from a string or from a Decimal', () => {
        assert.equal(toContractLineItemRecord(lineItemRow()).priceNet, 19.9);
        assert.equal(
            toContractLineItemRecord(lineItemRow({ priceGross: { toString: () => '23.68' } }))
                .priceGross,
            23.68,
        );
    });

    test('the commitment date and the metadata survive both ways round', () => {
        const withTerm = toContractLineItemRecord(
            lineItemRow({
                minimumTermUntil: UPDATED,
                metadata: { origin: 'onboarding' },
                unit: 'seat',
                descriptionSnapshot: 'A line',
            }),
        );
        assert.equal(withTerm.minimumTermUntil?.getTime(), UPDATED.getTime());
        assert.deepEqual(withTerm.metadata, { origin: 'onboarding' });
        assert.equal(withTerm.unit, 'seat');
        assert.equal(withTerm.descriptionSnapshot, 'A line');

        const without = toContractLineItemRecord(lineItemRow());
        assert.equal(without.minimumTermUntil, null);
        assert.equal(without.metadata, null);
        assert.equal(without.unit, null);
        assert.equal(without.descriptionSnapshot, null);
    });

    test('a features snapshot of mixed types keeps only the strings', () => {
        const record = toContractLineItemRecord(
            lineItemRow({ featuresSnapshot: ['CORE', 3], quotaEffectsSnapshot: { users: 'five' } }),
        );
        assert.deepEqual(record.featuresSnapshot, ['CORE']);
        assert.deepEqual(record.quotaEffectsSnapshot, {});
    });
});
