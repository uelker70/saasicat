// @requirement SC-PROMO-001 — A code is redeemed at most once per subscription

// Reversing a redemption rolls it back and gives the code its slot again. It
// is what a withdrawal or a rollback calls; an ordinary end never does — a
// redemption simply runs out. So whether the redemption has run out is not the
// question: the answer is the same before and after the nightly sweep marks it
// expired. What must not happen is the slot going back twice.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { inDays, promoCodesOver } from './helpers/promo-slots.js';

/**
 * A code with `slots` slots, all taken, one of them by this subscription's
 * redemption in `status`.
 */
function oneSlotTaken(status, { endsAt = inDays(30), slots = 1 } = {}) {
    const stores = promoCodesOver();
    const code = stores.codes.add({
        maxRedemptions: slots,
        redemptionsCount: slots,
        status: 'EXHAUSTED',
    });
    stores.redemptions.rows.push({
        id: 'redemption-1',
        promoCodeId: code.id,
        subscriptionId: 'sub-1',
        tenantId: 't1',
        status,
        redeemedAt: inDays(-60),
        endsAt,
        reversedAt: null,
    });
    return { ...stores, code };
}

describe('reversing a redemption', () => {
    test('rolls an active one back and gives the code its slot', async () => {
        const { service, codes, code } = oneSlotTaken('ACTIVE');

        const reversed = await service.reverse('sub-1');

        assert.equal(reversed.status, 'REVERSED');
        assert.equal(codes.codes.get(code.id).redemptionsCount, 0);
        assert.equal(codes.codes.get(code.id).status, 'ACTIVE', 'redeemable again');
    });

    test('rolls one back that has run out and been marked so, the same way', async () => {
        const { service, codes, code } = oneSlotTaken('EXPIRED', { endsAt: inDays(-1) });

        const reversed = await service.reverse('sub-1');

        assert.equal(reversed.status, 'REVERSED');
        assert.equal(codes.codes.get(code.id).redemptionsCount, 0);
    });

    test('rolls one back that has run out and is not marked yet, the same way', async () => {
        // The sweep has not run: the flag still says ACTIVE, the date says over.
        const { service, codes, code } = oneSlotTaken('ACTIVE', { endsAt: inDays(-1) });

        await service.reverse('sub-1');

        assert.equal(codes.codes.get(code.id).redemptionsCount, 0);
    });

    test('leaves one reversed already as it is, and gives nothing back twice', async () => {
        const { service, codes, code } = oneSlotTaken('REVERSED');

        const answer = await service.reverse('sub-1');

        assert.equal(answer.status, 'REVERSED');
        assert.equal(codes.codes.get(code.id).redemptionsCount, 1, 'the slot was given back again');
    });

    test('answers null for a subscription that redeemed nothing', async () => {
        const { service } = oneSlotTaken('ACTIVE');

        assert.equal(await service.reverse('sub-without-a-code'), null);
    });
});

describe('two reversals of one redemption at the same moment', () => {
    test('give the slot back once', async () => {
        // Both read the redemption before either writes: the reversal a
        // concurrent call won is what the second one's write meets.
        // Two slots taken, so a second release would show: the count cannot
        // go below 0, and from one slot it would stop there either way.
        const { service, codes, code, redemptions } = oneSlotTaken('ACTIVE', { slots: 2 });
        const read = redemptions.findBySubscription.bind(redemptions);
        let reads = 0;
        redemptions.findBySubscription = async (subscriptionId) => {
            const row = await read(subscriptionId);
            reads += 1;
            // The first read hands out the redemption as it was, and a
            // concurrent reversal lands before this call writes.
            if (reads === 1) {
                const seen = { ...row };
                row.status = 'REVERSED';
                await codes.releaseSlot(code.id);
                return seen;
            }
            return row;
        };

        const answer = await service.reverse('sub-1');

        assert.equal(answer.status, 'REVERSED');
        assert.equal(codes.codes.get(code.id).redemptionsCount, 1, 'given back once, not twice');
    });
});
