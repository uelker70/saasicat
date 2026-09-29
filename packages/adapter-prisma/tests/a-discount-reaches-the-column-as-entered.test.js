import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PrismaPromoCodeRepository } from '../dist/index.js';

// What the adapter hands Prisma for a code's amounts. Rounding the double here
// — `(2.675).toFixed(2)` is '2.67' — would decide by binary representation;
// the decimal that was written goes to the column, whose rule is half away
// from zero. The persistence contract checks the stored result against
// PostgreSQL; this checks the hand-over.

function recordingClient() {
    const calls = { create: [], update: [] };
    const row = (data) => ({
        id: 'promo-1',
        code: 'SPRING-25',
        valueType: data.valueType ?? 'ABSOLUTE',
        value: data.value ?? '5',
        durationType: data.durationType ?? 'ONCE',
        durationValue: null,
        validFrom: null,
        validUntil: null,
        maxRedemptions: null,
        redemptionsCount: 0,
        heldCount: 0,
        appliesToPlans: [],
        appliesToBilling: null,
        firstTimeCustomersOnly: true,
        minimumPlanAmountGross: data.minimumPlanAmountGross ?? null,
        allowZeroInvoice: false,
        status: 'ACTIVE',
        description: null,
        campaignTag: null,
        revenueDeductionAccount: null,
        createdById: 'operator-1',
        createdAt: new Date(0),
        updatedAt: new Date(0),
        deletedAt: null,
    });
    return {
        calls,
        promoCode: {
            async createManyAndReturn(args) {
                calls.create.push(args.data[0]);
                return [row(args.data[0])];
            },
            async update(args) {
                calls.update.push(args.data);
                return row(args.data);
            },
        },
    };
}

// @requirement SC-PROMO-026 — A discount is kept as the operator entered it, or refused
describe('the amounts a code is written with', () => {
    test('reach the column as the decimals they were written as', async () => {
        const client = recordingClient();
        const repo = new PrismaPromoCodeRepository(client);

        await repo.create({
            code: 'spring-25',
            valueType: 'ABSOLUTE',
            value: 2.675,
            durationType: 'ONCE',
            minimumPlanAmountGross: 1.005,
            createdById: 'operator-1',
        });

        assert.equal(client.calls.create[0].value, '2.675');
        assert.equal(client.calls.create[0].minimumPlanAmountGross, '1.005');
    });

    test('a change hands over its amount the same way, and clears a cleared minimum', async () => {
        const client = recordingClient();
        const repo = new PrismaPromoCodeRepository(client);

        await repo.update('promo-1', { value: 10.005, minimumPlanAmountGross: null });
        await repo.update('promo-1', { description: 'only this' });

        assert.equal(client.calls.update[0].value, '10.005');
        assert.equal(client.calls.update[0].minimumPlanAmountGross, null);
        assert.equal(client.calls.update[1].value, undefined, 'an amount it does not name');
        assert.equal(client.calls.update[1].minimumPlanAmountGross, undefined);
    });
});

// @requirement SC-PROMO-027 — Changing a code saves every field that was changed
describe('a change to a code', () => {
    test('hands over every field it names', async () => {
        const client = recordingClient();
        const repo = new PrismaPromoCodeRepository(client);
        const change = {
            status: 'PAUSED',
            valueType: 'PERCENT',
            durationType: 'MONTHS',
            durationValue: 3,
            validFrom: new Date('2026-02-01T00:00:00.000Z'),
            validUntil: new Date('2026-12-31T00:00:00.000Z'),
            maxRedemptions: 50,
            appliesToPlans: ['PRO'],
            appliesToBilling: 'YEARLY',
            firstTimeCustomersOnly: false,
            allowZeroInvoice: true,
            description: 'spring',
            campaignTag: 'SPRING',
            revenueDeductionAccount: '8736',
        };

        await repo.update('promo-1', change);

        const handedOver = client.calls.update[0];
        for (const [field, value] of Object.entries(change)) {
            assert.deepEqual(handedOver[field], value, field);
        }
    });
});
