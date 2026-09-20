// What the Prisma claim concludes when it writes nothing, and which way it errs.
//
// `skipDuplicates` is `ON CONFLICT DO NOTHING` with no conflict target — Prisma
// has none to give — so the claim is attributed to the reference's key without
// having been told that is the one it met. In the canonical schema that is
// sound: the primary key is a uuid made in the adapter, and the partial index
// for a subscriber's one ACTIVE payment method does not contain a REPLACED row.
//
// The case worth pinning is the one a real database cannot be made to show here:
// a policy on the table hides the holder, so nothing the adapter can read says
// the reference is taken, while the unique index — which no policy partitions —
// refuses the row anyway. The claim must still be refused as foreign there,
// because that is the configuration where the boundary is doing the most work.
// A fake client is the only way to stand in a blinded read.

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
 * A client whose reads see nothing and whose claim writes nothing: a payment
 * method holds the reference, and a policy keeps every read of this adapter's
 * from it.
 */
function clientBlindToTheHolder() {
    const delegate = {
        findUnique: async () => null,
        findFirst: async () => null,
        findMany: async () => [],
        create: async () => assert.fail('the claim must not be a plain create'),
        createManyAndReturn: async () => [],
        update: async () => assert.fail('nothing is updated once the claim took no row'),
        updateMany: async () => ({ count: 0 }),
    };
    const client = {
        subscriberPaymentMethod: delegate,
        subscriberPaymentMethodSetup: delegate,
        $queryRaw: async () => [{ id: CONFIRMATION.subscriberId }],
    };
    return { ...client, $transaction: (work) => work(client) };
}

describe('a claim that takes no row', () => {
    test('is refused as a foreign reference, and says nothing of the holder', async () => {
        const repository = new PrismaSubscriberPaymentMethodRepository(clientBlindToTheHolder());

        await assert.rejects(repository.recordConfirmed(CONFIRMATION), (error) => {
            assert.ok(isForeignPaymentMethodReferenceError(error));
            assert.equal(error.gatewayAccount, 'stripe-main');
            assert.equal(error.paymentMethodRef, 'pm_contested');
            return true;
        });
    });

    test('is refused without reading the holder back, because a policy can hide it', async () => {
        // A read here would answer `null` in exactly this installation, and a
        // refusal that believed it would report the reference as free.
        const client = clientBlindToTheHolder();
        let reads = 0;
        client.subscriberPaymentMethod.findUnique = async () => {
            reads += 1;
            return null;
        };

        await assert.rejects(repository(client).recordConfirmed(CONFIRMATION), (error) =>
            isForeignPaymentMethodReferenceError(error),
        );
        assert.equal(reads, 1, 'one read before the claim, and none after it');
    });
});

function repository(client) {
    return new PrismaSubscriberPaymentMethodRepository(client);
}
