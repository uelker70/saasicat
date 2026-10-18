// What correcting an issued invoice writes, before any store is involved: the
// cancellation invoice and the replacement drafted from the cancelled invoice,
// the operator's corrections of the subscriber, each payment's share of the
// cancelled invoice and how it moves onto the replacement, which invoice of a
// chain stands, and that a cancelled invoice and its cancellation owe nothing.
// Every one of them is money, so the boundaries are pinned to the cent.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    correctedSubscriberOf,
    draftCancellationInvoice,
    draftReplacementInvoice,
    isOwnCreditOf,
    movedPaymentParts,
    owedByInvoice,
    paymentSharesOf,
    refundParts,
    reversibleCreditsOf,
    standingInvoiceOf,
    subscriberCorrectedSince,
    taxPerRate,
} from '../dist/index.js';

const ZONE = 'Europe/Berlin';
const ISSUED_AT = new Date('2026-03-10T08:00:00.000Z');

const PARTY = {
    legalName: 'Müller & Söhne GmbH',
    vatId: null,
    taxNumber: '12/345/67890',
    addressLine1: 'Am Ufer 3',
    addressLine2: null,
    postalCode: '20095',
    city: 'Hamburg',
    country: 'DE',
};

const STANDARD = {
    kind: 'standard',
    rate: 19,
    note: null,
    adapter: { name: '@saasicat/tax-de', version: '1.0.0' },
};

const CARD = {
    paymentMethodId: 'payment-method-1',
    gatewayAccount: 'stripe-main',
    type: 'card',
    brand: 'visa',
    last4: '4242',
    mandateReference: null,
};

const DEBIT = {
    paymentMethodId: 'payment-method-2',
    gatewayAccount: 'stripe-main',
    type: 'sepa_debit',
    brand: null,
    last4: '3000',
    mandateReference: 'MANDAT-0001',
};

const line = (position, amountNet, overrides = {}) => ({
    id: `line-${position}`,
    invoiceId: 'invoice-1',
    position,
    chargeId: `charge-${position}`,
    contractLineItemId: `item-${position}`,
    title: `Line ${position}`,
    origin: 'renewal',
    source: 'plan',
    periodFrom: '2026-02-01',
    periodUntil: '2026-02-28',
    amountNet,
    taxRate: 19,
    correctedPosition: null,
    ...overrides,
});

/** An invoice of 49 and a discount of 3.90, at 19 %: 53.67 gross. */
const CANCELLED = {
    id: 'invoice-1',
    number: 'AHP-2026-000001',
    numberPrefix: 'AHP',
    numberYear: 2026,
    numberSequence: 1,
    tenantId: 'tenant-1',
    subscriberId: 'subscriber-1',
    subscriptionId: 'sub-1',
    contractId: 'contract-1',
    chainId: 'invoice-1',
    chainStep: 0,
    issuedAt: new Date('2026-02-01T05:15:00.000Z'),
    issueDate: '2026-02-01',
    dueDate: '2026-02-15',
    servicePeriodFrom: '2026-02-01',
    servicePeriodUntil: '2026-02-28',
    payment: CARD,
    collectionDate: null,
    currency: 'EUR',
    issuer: { ...PARTY, legalName: 'Issuer GmbH', vatId: 'DE123456789' },
    subscriber: { ...PARTY, customerNumber: 'K-10001' },
    footer: ['Amtsgericht München HRB 123456'],
    taxTreatment: STANDARD,
    taxes: [{ rate: 19, net: 45.1, tax: 8.57 }],
    totalNet: 45.1,
    totalTax: 8.57,
    totalGross: 53.67,
    paidOnIssue: 0,
    lines: [
        line(1, 49),
        line(2, -3.9, { source: 'discount', title: 'Welcome discount' }),
        line(3, 0, { title: 'Included seats' }),
    ],
    correction: null,
    createdAt: new Date('2026-02-01T05:15:00.000Z'),
};

const ISSUE = { issuedAt: ISSUED_AT, timeZone: ZONE, numberPrefix: 'AHP' };

/** A replacement issued with the cancelled invoice's parties and treatment, `paid` moving onto it. */
const replacementIssue = (overrides = {}) => ({
    ...ISSUE,
    subscriber: { ...CANCELLED.subscriber },
    issuer: { ...CANCELLED.issuer },
    footer: ['Amtsgericht München HRB 654321'],
    treatment: STANDARD,
    tax: taxPerRate,
    paymentTermDays: 14,
    directDebitLeadDays: 5,
    payment: CARD,
    paid: 0,
    ...overrides,
});

// @requirement SC-PRIC-025 — An issued invoice is never edited; a cancellation invoice corrects it
describe('the cancellation invoice', () => {
    test('states the cancelled invoice reversed, each line naming the line it cancels', () => {
        const drafted = draftCancellationInvoice(CANCELLED, ISSUE);

        assert.deepEqual(
            [drafted.totalNet, drafted.totalTax, drafted.totalGross, drafted.taxes],
            [-45.1, -8.57, -53.67, [{ rate: 19, net: -45.1, tax: -8.57 }]],
        );
        assert.deepEqual(
            drafted.lines.map((each) => [each.position, each.correctedPosition, each.amountNet]),
            [
                [1, 1, -49],
                [2, 2, 3.9],
                [3, 3, 0],
            ],
        );
        assert.ok(
            Object.is(drafted.lines[2].amountNet, 0),
            'nothing reversed is nothing, not minus nothing',
        );
        assert.deepEqual(
            drafted.lines.map((each) => [each.chargeId, each.taxRate]),
            CANCELLED.lines.map((each) => [each.chargeId, each.taxRate]),
        );
    });

    test('carries the cancelled invoice’s parties, footer, treatment and period, not what holds today', () => {
        const drafted = draftCancellationInvoice(CANCELLED, ISSUE);

        assert.deepEqual(
            [drafted.issuer, drafted.subscriber, drafted.footer, drafted.taxTreatment],
            [CANCELLED.issuer, CANCELLED.subscriber, CANCELLED.footer, STANDARD],
        );
        assert.deepEqual(
            [drafted.servicePeriodFrom, drafted.servicePeriodUntil, drafted.currency],
            ['2026-02-01', '2026-02-28', 'EUR'],
        );
        assert.notEqual(
            drafted.issuer,
            CANCELLED.issuer,
            'a copy, which a later change leaves alone',
        );
    });

    test('asks for nothing: no payment, due on the day it is issued, nothing paid on issue', () => {
        const drafted = draftCancellationInvoice(
            { ...CANCELLED, payment: DEBIT, collectionDate: '2026-02-06', dueDate: '2026-02-06' },
            ISSUE,
        );

        assert.deepEqual(
            [
                drafted.payment,
                drafted.collectionDate,
                drafted.issueDate,
                drafted.dueDate,
                drafted.paidOnIssue,
            ],
            [null, null, '2026-03-10', '2026-03-10', 0],
        );
    });

    for (const [issuedAt, issueDate, numberYear, why] of [
        [
            '2026-12-31T22:59:59.999Z',
            '2026-12-31',
            2026,
            'a millisecond before midnight in its zone',
        ],
        ['2026-12-31T23:00:00.000Z', '2027-01-01', 2027, 'at midnight in its zone, a new year'],
    ]) {
        test(`is numbered in the year of its issue date in the installation’s zone: ${why}`, () => {
            const drafted = draftCancellationInvoice(CANCELLED, {
                ...ISSUE,
                issuedAt: new Date(issuedAt),
            });
            assert.deepEqual([drafted.issueDate, drafted.numberYear], [issueDate, numberYear]);
        });
    }
});

// @requirement SC-PRIC-025 — An issued invoice is never edited; a cancellation invoice corrects it
describe('the replacement', () => {
    test('invoices the same charges, each line naming the line it replaces, under the treatment decided now', () => {
        const reverse = {
            kind: 'reverse_charge',
            rate: 0,
            note: 'Steuerschuldnerschaft des Leistungsempfängers',
            adapter: STANDARD.adapter,
        };
        const drafted = draftReplacementInvoice(
            CANCELLED,
            replacementIssue({ treatment: reverse }),
        );

        assert.deepEqual(
            drafted.lines.map((each) => [
                each.chargeId,
                each.correctedPosition,
                each.amountNet,
                each.taxRate,
            ]),
            [
                ['charge-1', 1, 49, 0],
                ['charge-2', 2, -3.9, 0],
                ['charge-3', 3, 0, 0],
            ],
        );
        assert.deepEqual(
            [drafted.totalNet, drafted.totalTax, drafted.totalGross, drafted.taxTreatment],
            [45.1, 0, 45.1, reverse],
        );
    });

    test('names the parties and the footer it is given, and keeps the cancelled invoice’s period', () => {
        const subscriber = { ...CANCELLED.subscriber, city: 'Bremen' };
        const drafted = draftReplacementInvoice(CANCELLED, replacementIssue({ subscriber }));

        assert.deepEqual(
            [drafted.subscriber, drafted.issuer, drafted.footer, drafted.servicePeriodFrom],
            [subscriber, CANCELLED.issuer, ['Amtsgericht München HRB 654321'], '2026-02-01'],
        );
    });

    test('runs its payment term from its own issue date', () => {
        const drafted = draftReplacementInvoice(CANCELLED, replacementIssue());

        assert.deepEqual(
            [drafted.issueDate, drafted.dueDate, drafted.payment, drafted.collectionDate],
            ['2026-03-10', '2026-03-24', CARD, null],
        );
    });

    test('collected by direct debit, falls due on the day it is announced to be collected', () => {
        const drafted = draftReplacementInvoice(CANCELLED, replacementIssue({ payment: DEBIT }));

        assert.deepEqual(
            [drafted.collectionDate, drafted.dueDate, drafted.payment],
            ['2026-03-15', '2026-03-15', DEBIT],
        );
    });

    for (const [paid, paidOnIssue, collected, why] of [
        [0, 0, true, 'nothing paid leaves the whole of it to collect'],
        [53.66, 53.66, true, 'a cent short of its total leaves a cent to collect'],
        [53.67, 53.67, false, 'exactly its total leaves nothing to collect'],
        [53.68, 53.67, false, 'a cent beyond its total takes no more than it owes'],
        [-5, 0, true, 'what was taken back of a payment is no payment'],
    ]) {
        test(`takes over what was paid, as far as it owes it: ${why}`, () => {
            const drafted = draftReplacementInvoice(
                CANCELLED,
                replacementIssue({ paid, payment: DEBIT }),
            );

            assert.equal(drafted.paidOnIssue, paidOnIssue);
            assert.deepEqual(
                [drafted.payment, drafted.collectionDate],
                collected ? [DEBIT, '2026-03-15'] : [null, null],
            );
            assert.equal(
                drafted.dueDate,
                collected ? '2026-03-15' : '2026-03-24',
                'what is not collected falls due after the term',
            );
        });
    }

    test('without a payment method in use, is collected by nothing', () => {
        const drafted = draftReplacementInvoice(CANCELLED, replacementIssue({ payment: null }));

        assert.deepEqual(
            [drafted.payment, drafted.collectionDate, drafted.dueDate],
            [null, null, '2026-03-24'],
        );
    });
});

// @requirement SC-PRIC-025 — An issued invoice is never edited; a cancellation invoice corrects it
describe('the subscriber a replacement names before the operator corrects it', () => {
    const correction = (correctedAt, corrected) => ({
        correctedAt: new Date(correctedAt),
        corrected,
    });

    test('takes each correction of its legal identity recorded after the invoice, the oldest first', () => {
        const subscriber = subscriberCorrectedSince(
            CANCELLED.subscriber,
            [
                correction('2026-03-01T00:00:00Z', {
                    legalName: 'Second GmbH',
                    vatId: 'DE111111111',
                }),
                correction('2026-02-15T00:00:00Z', {
                    legalName: 'First GmbH',
                    taxNumber: '99/999',
                }),
            ],
            CANCELLED.issuedAt,
        );

        assert.deepEqual(
            [subscriber.legalName, subscriber.vatId, subscriber.taxNumber, subscriber.city],
            ['Second GmbH', 'DE111111111', '99/999', CANCELLED.subscriber.city],
        );
    });

    test('leaves one recorded before the invoice, or at the same moment, to the invoice', () => {
        const subscriber = subscriberCorrectedSince(
            CANCELLED.subscriber,
            [
                correction('2026-01-15T00:00:00Z', { legalName: 'Earlier GmbH' }),
                correction(CANCELLED.issuedAt.toISOString(), { vatId: 'DE222222222' }),
            ],
            CANCELLED.issuedAt,
        );

        assert.deepEqual(subscriber, CANCELLED.subscriber);
    });
});

// @requirement SC-PRIC-025 — An issued invoice is never edited; a cancellation invoice corrects it
describe('the operator’s corrections of the subscriber', () => {
    const SUBSCRIBER = CANCELLED.subscriber;

    test('are applied, and recorded each with the value it replaced', () => {
        const { subscriber, corrected } = correctedSubscriberOf(SUBSCRIBER, {
            city: 'Bremen',
            vatId: 'DE987654321',
            addressLine2: null,
        });

        assert.deepEqual(subscriber, { ...SUBSCRIBER, city: 'Bremen', vatId: 'DE987654321' });
        assert.deepEqual(corrected, {
            city: { previous: 'Hamburg', corrected: 'Bremen' },
            vatId: { previous: null, corrected: 'DE987654321' },
        });
    });

    test('a detail given as it stands, or none given, corrects nothing', () => {
        assert.deepEqual(correctedSubscriberOf(SUBSCRIBER, { city: 'Hamburg' }), {
            subscriber: SUBSCRIBER,
            corrected: null,
        });
        assert.deepEqual(correctedSubscriberOf(SUBSCRIBER, {}).corrected, null);
    });

    test('a detail may be cleared, but a party is never named by nothing', () => {
        const { subscriber, corrected } = correctedSubscriberOf(SUBSCRIBER, {
            taxNumber: null,
            legalName: null,
        });

        assert.deepEqual(
            [subscriber.taxNumber, subscriber.legalName],
            [null, SUBSCRIBER.legalName],
        );
        assert.deepEqual(corrected, { taxNumber: { previous: '12/345/67890', corrected: null } });
    });
});

// @requirement SC-PRIC-025 — An issued invoice is never edited; a cancellation invoice corrects it
describe('each payment’s share of a cancelled invoice', () => {
    const at = (day) => new Date(`2026-02-${day}T09:00:00.000Z`);

    test('is what its settlements there still come to, as each is signed', () => {
        const shares = paymentSharesOf(
            [
                { paymentId: 'p-1', amount: 30 },
                { paymentId: 'p-2', amount: 23.67 },
                { paymentId: 'p-1', amount: -10 },
                { paymentId: 'p-3', amount: 5 },
                { paymentId: 'p-3', amount: -5 },
            ],
            new Map([
                ['p-1', at('02')],
                ['p-2', at('03')],
                ['p-3', at('04')],
            ]),
        );

        assert.deepEqual(shares, [
            { paymentId: 'p-1', recordedAt: at('02'), amount: 20 },
            { paymentId: 'p-2', recordedAt: at('03'), amount: 23.67 },
        ]);
    });

    test('counts in cents, not in binary fractions', () => {
        const [share] = paymentSharesOf(
            [
                { paymentId: 'p-1', amount: 0.1 },
                { paymentId: 'p-1', amount: 0.2 },
            ],
            new Map([['p-1', at('02')]]),
        );
        assert.equal(share.amount, 0.3);
    });

    test('of a payment that was not read stops the cancellation', () => {
        assert.throws(
            () => paymentSharesOf([{ paymentId: 'p-9', amount: 10 }], new Map()),
            /Payment p-9 settles an invoice and was not read/,
        );
    });

    test('moves onto the replacement the oldest first, and what it does not take is credited', () => {
        const shares = [
            { paymentId: 'p-late', recordedAt: at('05'), amount: 30 },
            { paymentId: 'p-early', recordedAt: at('02'), amount: 25 },
        ];

        assert.deepEqual(movedPaymentParts(shares, 40), [
            { paymentId: 'p-early', movedOut: 25, movedIn: 25, credited: 0 },
            { paymentId: 'p-late', movedOut: 30, movedIn: 15, credited: 15 },
        ]);
    });

    for (const [owes, movedIn, credited, why] of [
        [24.99, 24.99, 0.01, 'a cent short of the share credits a cent'],
        [25, 25, 0, 'exactly the share moves it whole'],
        [25.01, 25, 0, 'a cent beyond it moves no more than the share'],
        [0, 0, 25, 'without a replacement, all of it is credited'],
        [-3, 0, 25, 'a replacement that owes less than nothing takes nothing'],
    ]) {
        test(`moves by what the replacement owes: ${why}`, () => {
            assert.deepEqual(
                movedPaymentParts([{ paymentId: 'p-1', recordedAt: at('02'), amount: 25 }], owes),
                [{ paymentId: 'p-1', movedOut: 25, movedIn, credited }],
            );
        });
    }

    test('confirmed at the same moment, move in the order of their ids', () => {
        const parts = movedPaymentParts(
            [
                { paymentId: 'p-b', recordedAt: at('02'), amount: 10 },
                { paymentId: 'p-a', recordedAt: at('02'), amount: 10 },
            ],
            15,
        );
        assert.deepEqual(
            parts.map((part) => [part.paymentId, part.movedIn]),
            [
                ['p-a', 10],
                ['p-b', 5],
            ],
        );
    });

    test('of nothing, or taken back in full, move nothing', () => {
        assert.deepEqual(
            movedPaymentParts(
                [
                    { paymentId: 'p-1', recordedAt: at('02'), amount: 0 },
                    { paymentId: 'p-2', recordedAt: at('03'), amount: -5 },
                ],
                50,
            ),
            [],
        );
    });
});

// @requirement SC-PRIC-036 — What an invoice owes and how it is paid changes one step at a time
describe('the invoice that stands in a chain', () => {
    const invoice = (id, chainStep) => ({ ...CANCELLED, id, chainStep, chainId: 'invoice-1' });
    const cancellation = (cancelledInvoiceId, cancellationInvoiceId, replacementInvoiceId) => ({
        id: `x-${cancelledInvoiceId}`,
        cancelledInvoiceId,
        cancellationInvoiceId,
        replacementInvoiceId,
    });

    test('is the first invoice where nothing was cancelled', () => {
        assert.equal(
            standingInvoiceOf({ invoices: [invoice('invoice-1', 0)], cancellations: [] })?.id,
            'invoice-1',
        );
    });

    test('is the last replacement, however many cancellations deep', () => {
        const chain = {
            invoices: [
                invoice('invoice-1', 0),
                invoice('invoice-c1', 1),
                invoice('invoice-r1', 2),
                invoice('invoice-c2', 3),
                invoice('invoice-r2', 4),
            ],
            cancellations: [
                cancellation('invoice-1', 'invoice-c1', 'invoice-r1'),
                cancellation('invoice-r1', 'invoice-c2', 'invoice-r2'),
            ],
        };
        assert.equal(standingInvoiceOf(chain)?.id, 'invoice-r2');
        assert.equal(
            standingInvoiceOf({ ...chain, invoices: [...chain.invoices].reverse() })?.id,
            'invoice-r2',
        );
    });

    test('is none where the last cancellation left no replacement', () => {
        assert.equal(
            standingInvoiceOf({
                invoices: [invoice('invoice-1', 0), invoice('invoice-c1', 1)],
                cancellations: [cancellation('invoice-1', 'invoice-c1', null)],
            }),
            null,
        );
    });
});

// @requirement SC-PRIC-025 — An issued invoice is never edited; a cancellation invoice corrects it
describe('what a corrected invoice owes', () => {
    test('a cancelled invoice and its cancellation invoice owe nothing, whatever they state', () => {
        assert.equal(owedByInvoice(53.67, [], { cancelled: true, isCancellation: false }), 0);
        assert.equal(owedByInvoice(-53.67, [], { cancelled: false, isCancellation: true }), 0);
        assert.equal(owedByInvoice(53.67, [-10], { cancelled: true, isCancellation: false }), 0);
    });

    test('any other owes its total less what is settled', () => {
        assert.equal(
            owedByInvoice(53.67, [20], { cancelled: false, isCancellation: false }),
            33.67,
        );
    });
});

// @requirement SC-PRIC-084 — A returned debit or a chargeback is recorded, and what the payment settled opens again
describe('the credits a payment left, once a cancellation left one more', () => {
    const cancellationCredit = {
        origin: { kind: 'cancellation', cancellationId: 'x-1', paymentId: 'p-1' },
    };

    test('are its own, its surplus and its share alike', () => {
        assert.ok(isOwnCreditOf({ origin: { kind: 'payment', paymentId: 'p-1' } }, 'p-1'));
        assert.ok(isOwnCreditOf(cancellationCredit, 'p-1'));
        assert.ok(!isOwnCreditOf(cancellationCredit, 'p-2'));
        assert.ok(!isOwnCreditOf({ origin: { kind: 'invoice', invoiceId: 'p-1' } }, 'p-1'));
    });

    test('are taken by a reversal the earliest first, what its reversals took counted against them in that order', () => {
        const credits = reversibleCreditsOf(
            [
                {
                    creditId: 'c-share',
                    amount: 30,
                    createdAt: new Date('2026-03-10T08:00:00Z'),
                    open: 30,
                },
                {
                    creditId: 'c-surplus',
                    amount: 10,
                    createdAt: new Date('2026-02-02T08:00:00Z'),
                    open: 4,
                },
            ],
            12,
        );

        assert.deepEqual(credits, [
            { creditId: 'c-surplus', left: 0, open: 4 },
            { creditId: 'c-share', left: 28, open: 30 },
        ]);
    });

    test('are what a refund of the payment pays back first, the oldest of them first', () => {
        const open = (id, paymentId, kind, day, amount) => ({
            id,
            origin:
                kind === 'payment'
                    ? { kind, paymentId }
                    : { kind, cancellationId: `x-${id}`, paymentId },
            createdAt: new Date(`2026-03-${day}T08:00:00Z`),
            open: amount,
        });

        assert.deepEqual(
            refundParts(25, 'p-1', [
                open('c-other', 'p-2', 'payment', '01', 50),
                open('c-share', 'p-1', 'cancellation', '10', 20),
                open('c-surplus', 'p-1', 'payment', '02', 3),
            ]).parts,
            [
                { creditId: 'c-surplus', amount: 3 },
                { creditId: 'c-share', amount: 20 },
                { creditId: 'c-other', amount: 2 },
            ],
        );
    });
});
