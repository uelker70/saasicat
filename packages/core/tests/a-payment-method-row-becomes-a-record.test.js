// The payment method mapping both adapters share, and the error a gateway
// adapter throws for a callback it cannot verify.
//
// The two text columns with a closed set of values are the cases worth pinning:
// a type or a status written by hand or by an older release must stop at the
// read rather than reach a screen as a payment method nobody handles.

// @requirement SC-PRIC-030 — A payment method is entered in the gateway's own form, and SaaSiCat keeps a reference

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    PAYMENT_METHOD_TYPES,
    PaymentCallbackRejectedError,
    isPaymentCallbackRejectedError,
    subscriberPaymentMethodColumns,
    toSubscriberPaymentMethodRecord,
} from '../dist/index.js';

const CONFIRMED = new Date('2026-09-15T10:00:00.000Z');

function row(overrides = {}) {
    return {
        id: 'pm-row-1',
        subscriberId: 'subscriber-1',
        gatewayAccount: 'stripe-main',
        provider: 'stripe',
        customerRef: 'cus_1',
        paymentMethodRef: 'pm_1',
        type: 'sepa_debit',
        brand: null,
        last4: '3000',
        expiryMonth: null,
        expiryYear: null,
        country: 'DE',
        bankCode: '37040044',
        mandateReference: 'MANDATE-1',
        status: 'ACTIVE',
        confirmedAt: CONFIRMED,
        replacedAt: null,
        createdAt: CONFIRMED,
        ...overrides,
    };
}

describe('a payment method row becomes a record', () => {
    test('every column is carried over as it is', () => {
        assert.deepEqual(toSubscriberPaymentMethodRecord(row()), row());
    });

    test('both payment method types and both statuses are read', () => {
        assert.deepEqual(PAYMENT_METHOD_TYPES, ['card', 'sepa_debit']);
        assert.equal(toSubscriberPaymentMethodRecord(row({ type: 'card' })).type, 'card');
        assert.equal(
            toSubscriberPaymentMethodRecord(row({ status: 'REPLACED' })).status,
            'REPLACED',
        );
    });

    for (const [column, value] of [
        ['type', 'paypal'],
        ['type', 'CARD'],
        ['status', 'active'],
        ['status', 'REVOKED'],
    ]) {
        test(`a ${column} of '${value}' stops the read, naming the row and the column`, () => {
            assert.throws(
                () => toSubscriberPaymentMethodRecord(row({ [column]: value })),
                (error) => error.message.includes(`'pm-row-1' holds ${column} '${value}'`),
            );
        });
    }
});

describe('the columns a confirmed payment method is written with', () => {
    test('are the confirmation, and nothing a caller put beside it', () => {
        // What the repository adds itself is not a column the confirmation carries.
        const {
            id: _id,
            status: _status,
            replacedAt: _replaced,
            createdAt: _created,
            ...columns
        } = row();
        const written = subscriberPaymentMethodColumns({
            ...columns,
            // What a gateway adapter's event may carry and the table does not.
            holderName: 'Meier GmbH',
            iban: 'DE89370400440532013000',
        });
        assert.deepEqual(written, columns);
        assert.equal(Object.hasOwn(written, 'iban'), false);
    });
});

describe('a callback a gateway adapter cannot verify', () => {
    test('is recognised by its code, also from another copy of the class', () => {
        const error = new PaymentCallbackRejectedError('the signature does not verify');
        assert.equal(error.code, 'PAYMENT_CALLBACK_REJECTED');
        assert.match(error.message, /the signature does not verify/);
        assert.equal(isPaymentCallbackRejectedError(error), true);

        const lookalike = Object.assign(new Error('from elsewhere'), {
            code: 'PAYMENT_CALLBACK_REJECTED',
        });
        assert.equal(isPaymentCallbackRejectedError(lookalike), true);
        assert.equal(isPaymentCallbackRejectedError(new Error('something else')), false);
        assert.equal(isPaymentCallbackRejectedError({ code: 'PAYMENT_CALLBACK_REJECTED' }), false);
    });
});
