// What the Prisma claim concludes when it writes nothing.
//
// `skipDuplicates` is `ON CONFLICT DO NOTHING` with no conflict target — Prisma
// has none to give — so it suppresses every unique key on the table rather than
// the reference's alone. The canonical schema has no other key this claim could
// meet, which is why a real database cannot produce the second case here: the
// primary key is a uuid made in the adapter, and the partial index for a
// subscriber's one ACTIVE payment method does not contain a REPLACED row. A
// consumer's schema is a copy of the fragment that it may add to, so the case is
// reachable there — and a fake client is the only way to stand in it.

// @requirement SC-SEC-014 — A payment method's reference belongs to exactly one subscriber

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isForeignPaymentMethodReferenceError } from '@saasicat/core';
import { PrismaSubscriberPaymentMethodRepository } from '../dist/index.js';

const CONFIRMATION = {
    subscriberId: 'subscriber-asking',
    gatewayAccount: 'stripe-main',
    provider: 'stripe',
    customerRef: 'cus_1',
    paymentMethodRef: 'pm_contested',
    type: 'card',
    brand: 'visa',
    last4: '4242',
    expiryMonth: 12,
    expiryYear: 2030,
    country: null,
    bankCode: null,
    mandateReference: null,
    confirmedAt: new Date('2026-09-01T10:00:00.000Z'),
};

/**
 * A client whose claim writes nothing, and which holds `heldBy` under the
 * reference — `null` for a table where something else refused the row.
 */
function clientThatClaimsNothing(heldBy) {
    const delegate = {
        // The pre-read runs before the claim and finds nothing: a row hidden
        // from it is exactly the case the claim exists to catch.
        findUnique: async () => (delegate.reads++ === 0 ? null : heldBy),
        findFirst: async () => null,
        findMany: async () => [],
        create: async () => assert.fail('the claim must not be a plain create'),
        createManyAndReturn: async () => [],
        update: async () => assert.fail('nothing is updated once the claim took no row'),
        updateMany: async () => ({ count: 0 }),
        reads: 0,
    };
    return {
        subscriberPaymentMethod: delegate,
        subscriberPaymentMethodSetup: delegate,
        $queryRaw: async () => [{ id: CONFIRMATION.subscriberId }],
        $transaction: (fn) =>
            fn({
                subscriberPaymentMethod: delegate,
                $queryRaw: async () => [{ id: CONFIRMATION.subscriberId }],
            }),
    };
}

describe('a claim that takes no row', () => {
    test('is refused as a foreign reference where another subscriber holds it', async () => {
        const repository = new PrismaSubscriberPaymentMethodRepository(
            clientThatClaimsNothing({
                ...CONFIRMATION,
                id: 'pm-1',
                subscriberId: 'subscriber-holding',
            }),
        );

        await assert.rejects(repository.recordConfirmed(CONFIRMATION), (error) => {
            assert.ok(isForeignPaymentMethodReferenceError(error));
            assert.equal(error.paymentMethodRef, 'pm_contested');
            return true;
        });
    });

    test('says so plainly where nothing holds the reference, rather than naming a subscriber', async () => {
        // Another unique key refused the row. Attributing that to a subscriber
        // would be a sentence the adapter never checked.
        const repository = new PrismaSubscriberPaymentMethodRepository(
            clientThatClaimsNothing(null),
        );

        await assert.rejects(repository.recordConfirmed(CONFIRMATION), (error) => {
            assert.ok(!isForeignPaymentMethodReferenceError(error));
            assert.match(error.message, /no payment method holds that reference/);
            assert.match(error.message, /some other unique key/i);
            return true;
        });
    });
});
