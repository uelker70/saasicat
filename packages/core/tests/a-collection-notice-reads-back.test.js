// A notice about collecting an invoice, read back from the record of notices
// to be sent again or to recover the day an announcement named — strictly,
// since it goes to a subscriber, and its day decides when an account is
// debited.

// @requirement SC-PRIC-080 — A failed collection is tried once more, and the subscriber is told of every failure

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { toCollectionAnnouncedNotice, toCollectionFailedNotice } from '../dist/index.js';

const INVOICE = {
    tenantId: 't1',
    subscriptionId: 'subscription-1',
    subscriberId: 'subscriber-1',
    invoiceId: 'invoice-1',
    invoiceNumber: 'AHP-2026-000123',
    amount: 58.31,
    currency: 'EUR',
};

const FAILED = {
    kind: 'collection-failed',
    ...INVOICE,
    paymentMethodType: 'card',
    reason: 'insufficient-funds',
    next: { action: 'charged-again', on: '2026-02-08' },
};

const ANNOUNCED = {
    kind: 'collection-announced',
    ...INVOICE,
    collectOn: '2026-03-01',
    mandateReference: 'MANDAT-1',
    last4: '3000',
};

describe('a failure notice', () => {
    test('reads back as it was recorded, whatever follows it', () => {
        for (const next of [
            { action: 'charged-again', on: '2026-02-08' },
            { action: 'announced-again' },
            { action: 'replace-payment-method' },
        ]) {
            const recorded = JSON.parse(JSON.stringify({ ...FAILED, next }));

            assert.deepEqual(toCollectionFailedNotice(recorded, 'notice-1'), { ...FAILED, next });
        }
    });

    for (const [what, content, message] of [
        ['nothing at all', null, /content of notice-1 is not a notice/],
        [
            'another kind',
            { ...FAILED, kind: 'collection-announced' },
            /content.kind 'collection-announced'/,
        ],
        ['a reason nothing names', { ...FAILED, reason: 'bad-luck' }, /content.reason 'bad-luck'/],
        [
            'what follows, missing',
            { ...FAILED, next: undefined },
            /content of notice-1 is not a notice/,
        ],
        [
            'a second charge without its day',
            { ...FAILED, next: { action: 'charged-again' } },
            /content.on of notice-1 is not a day/,
        ],
        [
            'an amount that is text',
            { ...FAILED, amount: '58.31' },
            /content.amount of notice-1 is not an amount/,
        ],
        [
            'an empty invoice number',
            { ...FAILED, invoiceNumber: '' },
            /content.invoiceNumber of notice-1 is not a text/,
        ],
    ]) {
        test(`refuses ${what}`, () => {
            assert.throws(() => toCollectionFailedNotice(content, 'notice-1'), message);
        });
    }
});

describe('an announcement', () => {
    test('reads back with the day it named and its mandate', () => {
        assert.deepEqual(toCollectionAnnouncedNotice(ANNOUNCED, 'notice-2'), ANNOUNCED);
    });

    for (const [what, content, message] of [
        [
            'a day that is not one',
            { ...ANNOUNCED, collectOn: 'soon' },
            /content.collectOn of notice-2 is not a day/,
        ],
        [
            'no mandate reference',
            { ...ANNOUNCED, mandateReference: null },
            /content.mandateReference of notice-2 is not a text/,
        ],
        ['a failure notice', FAILED, /content.kind 'collection-failed'/],
    ]) {
        test(`refuses ${what}`, () => {
            assert.throws(() => toCollectionAnnouncedNotice(content, 'notice-2'), message);
        });
    }
});
