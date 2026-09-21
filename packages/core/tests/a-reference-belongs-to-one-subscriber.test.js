// The refusal both adapters draw the boundary with, in one place so that all of
// them refuse in the same words.
//
// `(gatewayAccount, paymentMethodRef)` is unique account-wide rather than per
// subscriber, so the row a confirmation finds under its reference may be
// somebody else's. Reading it back as `already-recorded` would hand that
// payment method to a caller acting for another subscriber — on a gateway
// callback, which arrives without a session and with the tenant policy lifted.

// @requirement SC-SEC-014 — A payment method's reference belongs to exactly one subscriber

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    ForeignPaymentMethodReferenceError,
    isForeignPaymentMethodReferenceError,
    refuseForeignPaymentMethodReference,
} from '../dist/index.js';

const HOLDER = 'subscriber-holder';
const STRANGER = 'subscriber-stranger';

const recorded = {
    subscriberId: HOLDER,
    gatewayAccount: 'stripe-main',
    paymentMethodRef: 'pm_of_the_holder',
};

describe('a reference the account already holds', () => {
    test('is the subscriber that holds it reading its own back', () => {
        assert.equal(refuseForeignPaymentMethodReference(recorded, HOLDER), undefined);
    });

    test('is refused for any other subscriber, naming the reference and its account', () => {
        assert.throws(
            () => refuseForeignPaymentMethodReference(recorded, STRANGER),
            /Payment method 'pm_of_the_holder' of account 'stripe-main' belongs to another subscriber/,
        );
    });

    test('is refused in a message that does not name the subscriber holding it', () => {
        // Whoever reads the log of the refused confirmation stands on the other
        // side of the boundary this refusal draws.
        const message = refusalOf(STRANGER).message;
        assert.ok(!message.includes(HOLDER), message);
    });

    test('is refused with the account and the reference beside the sentence', () => {
        // So that a caller can say which confirmation was refused without
        // taking the sentence apart.
        const error = refusalOf(STRANGER);
        assert.equal(error.gatewayAccount, 'stripe-main');
        assert.equal(error.paymentMethodRef, 'pm_of_the_holder');
    });
});

describe('the refusal as a caller recognises it', () => {
    test('is recognised, also from another copy of the class', () => {
        const error = refusalOf(STRANGER);
        assert.ok(isForeignPaymentMethodReferenceError(error));
        // A second realm's copy carries the same code and no shared prototype.
        const fromElsewhere = Object.assign(new Error(error.message), {
            code: error.code,
        });
        assert.ok(isForeignPaymentMethodReferenceError(fromElsewhere));
    });

    test('is told apart from every other failure of a write', () => {
        assert.ok(!isForeignPaymentMethodReferenceError(new Error(refusalOf(STRANGER).message)));
        assert.ok(!isForeignPaymentMethodReferenceError(null));
        assert.ok(
            !isForeignPaymentMethodReferenceError({ code: 'FOREIGN_PAYMENT_METHOD_REFERENCE' }),
        );
    });

    test('is what an implementation raises where the key refuses the row', () => {
        // The concurrent path has no row to read, and builds the same refusal.
        const raised = new ForeignPaymentMethodReferenceError('stripe-main', 'pm_of_the_holder');
        assert.equal(raised.message, refusalOf(STRANGER).message);
        assert.ok(isForeignPaymentMethodReferenceError(raised));
    });
});

/** The refusal itself, which every case above needs to have been thrown. */
function refusalOf(subscriberId) {
    try {
        refuseForeignPaymentMethodReference(recorded, subscriberId);
    } catch (error) {
        return error;
    }
    return assert.fail('the foreign reference was not refused');
}
