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
import { refuseForeignPaymentMethodReference } from '../dist/index.js';

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
        const message = refusalFor(STRANGER);
        assert.ok(!message.includes(HOLDER), message);
    });
});

/** The message of the refusal, which every case above needs to have been thrown. */
function refusalFor(subscriberId) {
    try {
        refuseForeignPaymentMethodReference(recorded, subscriberId);
    } catch (error) {
        return error.message;
    }
    return assert.fail('the foreign reference was not refused');
}
