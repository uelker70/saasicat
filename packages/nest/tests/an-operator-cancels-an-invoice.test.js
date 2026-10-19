// The operator's path to cancelling an issued invoice: what the request may
// hold before anything is computed, the preview route that writes nothing,
// the cancellation route behind the second factor that records itself in the
// audit log, where both are served and announced, and the invoice named by the
// number on its document.
//
// Over the installation in memory the cancellation tests use, whose invoices,
// attempts and payments are kept as the persistence contract holds both
// adapters to keep them.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
    INVOICE_CANCELLATION_REASON_MAX_LENGTH,
    INVOICE_ERROR_CODES,
    SUBSCRIBER_ERROR_CODES,
} from '@saasicat/core';

import {
    CancelInvoiceDto,
    INVOICE_CANCELLED_AUDIT_ACTION,
    InvoiceCancellationModule,
} from '../dist/billing/index.js';
import { AdminManifestService, SaaSiCatModule } from '../dist/platform/index.js';
import { anInvoiceToCollect } from './helpers/invoice-collection.js';
import { invoicingPlatform } from './helpers/invoicing-platform.js';
import { controllersIn, handlersOf } from './helpers/operator-routes.js';

/** 10:00 in Berlin on 20 March, when the operator cancels the invoice of February. */
const CANCELLED_AT = new Date('2026-03-20T09:00:00.000Z');

const REQUEST = { reason: 'The billing address was wrong.' };

/** The coded answer an operator reads, as its status and body. */
async function refusalOf(attempt) {
    try {
        await attempt;
    } catch (error) {
        return [error.getStatus?.(), error.getResponse?.().code];
    }
    throw new Error('it was not refused');
}

/** What the installation holds of invoices and cancellations, to see that nothing was written. */
const heldBy = ({ store }) => [store.invoices.length, store.cancellations.length];

/** The route's own controller over `installation`, its tenant served as `acme`. */
function aController(installation, logged = []) {
    const [Controller] = InvoiceCancellationModule.forRoot({ guards: [], imports: [] }).controllers;
    return new Controller(
        {
            getTenantDetail: async (slug) => {
                if (slug === 'acme') return { id: 't1', slug };
                if (slug === 'other') return { id: 't2', slug };
                throw new NotFoundException({ code: 'TENANT_NOT_FOUND' });
            },
        },
        installation.cancellation,
        {
            actorTagFromRequest: () => 'web:anna@example.com:admin',
            logFromRequest: async (...entry) => logged.push(entry),
        },
        { runWithBypass: (fn) => fn() },
    );
}

// @requirement SC-ADM-020 — Six actions require a written reason, cancelling an invoice among them
describe('what an operator gives a cancellation', () => {
    const problemsOf = async (body) =>
        (await validate(plainToInstance(CancelInvoiceDto, body))).map((error) => error.property);

    test('passes with a reason, and with corrections and an address beside it', async () => {
        assert.deepEqual(await problemsOf(REQUEST), []);
        assert.deepEqual(
            await problemsOf({
                ...REQUEST,
                corrections: { city: 'Bremen', vatId: null },
                deliverTo: 'accounts@t1.example',
            }),
            [],
        );
        assert.deepEqual(await problemsOf({ ...REQUEST, deliverTo: null }), []);
        assert.deepEqual(
            await problemsOf({ reason: 'x'.repeat(INVOICE_CANCELLATION_REASON_MAX_LENGTH) }),
            [],
        );
    });

    for (const [why, body, property] of [
        ['no reason', {}, 'reason'],
        ['a reason of blanks', { reason: '   ' }, 'reason'],
        [
            'a reason a character too long',
            { reason: 'x'.repeat(INVOICE_CANCELLATION_REASON_MAX_LENGTH + 1) },
            'reason',
        ],
        ['corrections that are no object', { ...REQUEST, corrections: 'Bremen' }, 'corrections'],
        [
            'a correction that is no text',
            { ...REQUEST, corrections: { city: 28195 } },
            'corrections',
        ],
        ['an address that is no text', { ...REQUEST, deliverTo: 42 }, 'deliverTo'],
        [
            'an address longer than one can be',
            { ...REQUEST, deliverTo: `${'a'.repeat(246)}@t1.example` },
            'deliverTo',
        ],
    ]) {
        test(`with ${why} is refused`, async () => {
            assert.deepEqual(await problemsOf(body), [property]);
        });
    }
});

// @requirement SC-ADM-020 — Six actions require a written reason, cancelling an invoice among them
describe('a cancellation settles what it is given before anything else', () => {
    const previewWith = (installation, request) =>
        installation.cancellation.preview('t1', installation.invoice.id, request, CANCELLED_AT);

    test('the reason and the address trimmed, as the preview shows and the cancellation records them', async () => {
        const installation = await anInvoiceToCollect();
        const request = {
            reason: '  The billing address was wrong.  ',
            deliverTo: '  accounts@t1.example ',
        };

        const plan = await previewWith(installation, request);
        const { cancellation } = await installation.cancellation.cancel(
            't1',
            installation.invoice.id,
            request,
            'operator:anna',
            CANCELLED_AT,
        );

        const settled = ['The billing address was wrong.', 'accounts@t1.example'];
        assert.deepEqual([plan.reason, plan.deliverTo], settled);
        assert.deepEqual([cancellation.reason, cancellation.deliverTo], settled);
    });

    test('an address of blanks as none given', async () => {
        const installation = await anInvoiceToCollect();

        const plan = await previewWith(installation, { ...REQUEST, deliverTo: '   ' });

        assert.equal(plan.deliverTo, null);
    });

    for (const [why, reason] of [
        ['blank once trimmed', '   '],
        ['over one line', 'The address was wrong.\nThe name too.'],
        ['a character too long', 'x'.repeat(INVOICE_CANCELLATION_REASON_MAX_LENGTH + 1)],
    ]) {
        test(`refuses a reason ${why}, drawing no number`, async () => {
            const installation = await anInvoiceToCollect();
            const before = heldBy(installation);

            assert.deepEqual(
                await refusalOf(
                    installation.cancellation.cancel(
                        't1',
                        installation.invoice.id,
                        { reason },
                        'operator:anna',
                        CANCELLED_AT,
                    ),
                ),
                [422, INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_CANCELLATION_REASON_INVALID],
            );
            assert.deepEqual(heldBy(installation), before);
        });
    }

    test('takes a reason of exactly the longest length', async () => {
        const installation = await anInvoiceToCollect();
        const reason = 'x'.repeat(INVOICE_CANCELLATION_REASON_MAX_LENGTH);

        assert.equal((await previewWith(installation, { reason })).reason, reason);
    });

    for (const [why, deliverTo] of [
        ['without an @', 'accounts.t1.example'],
        ['with a space inside', 'accounts @t1.example'],
        ['with a control character', 'accounts\u0007@t1.example'],
    ]) {
        test(`refuses an address ${why}`, async () => {
            const installation = await anInvoiceToCollect();

            assert.deepEqual(
                await refusalOf(previewWith(installation, { ...REQUEST, deliverTo })),
                [422, INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DELIVERY_ADDRESS_INVALID],
            );
        });
    }

    test('each correction as the subscriber’s record holds that detail', async () => {
        const installation = await anInvoiceToCollect();

        const plan = await previewWith(installation, {
            ...REQUEST,
            corrections: { city: '  Bremen ', postalCode: ' 28195', country: 'de' },
        });

        assert.deepEqual(
            [
                plan.replacement.subscriber.city,
                plan.replacement.subscriber.postalCode,
                plan.replacement.subscriber.country,
            ],
            ['Bremen', '28195', 'DE'],
        );
    });

    for (const [why, corrections, code] of [
        [
            'a legal name taken away',
            { legalName: null },
            SUBSCRIBER_ERROR_CODES.SUBSCRIBER_LEGAL_NAME_REQUIRED,
        ],
        [
            'a country that is no code',
            { country: 'Germany' },
            SUBSCRIBER_ERROR_CODES.SUBSCRIBER_DETAIL_INVALID,
        ],
        [
            'a detail a document cannot carry',
            { city: 'Bre\u0000men' },
            SUBSCRIBER_ERROR_CODES.SUBSCRIBER_DETAIL_INVALID,
        ],
    ]) {
        test(`refuses ${why}`, async () => {
            const installation = await anInvoiceToCollect();

            assert.deepEqual(
                await refusalOf(previewWith(installation, { ...REQUEST, corrections })),
                [422, code],
            );
        });
    }
});

// @requirement SC-UI-017 — A confirmation shows the answer to the question actually being asked
describe('the preview route', () => {
    test('answers what the cancellation would write, and writes nothing', async () => {
        const installation = await anInvoiceToCollect();
        const logged = [];
        const before = heldBy(installation);

        const plan = await aController(installation, logged).preview(
            'acme',
            installation.invoice.id,
            REQUEST,
        );

        assert.deepEqual(
            [plan.cancelled.id, plan.replacement.totalGross, plan.reason],
            [installation.invoice.id, installation.invoice.totalGross, REQUEST.reason],
        );
        assert.deepEqual(heldBy(installation), before);
        assert.deepEqual(logged, []);
    });

    test('of another tenant’s invoice is refused as none', async () => {
        const installation = await anInvoiceToCollect();

        assert.deepEqual(
            await refusalOf(
                aController(installation).preview('other', installation.invoice.id, REQUEST),
            ),
            [404, INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_NOT_FOUND],
        );
    });
});

// @requirement SC-ADM-020 — Six actions require a written reason, cancelling an invoice among them
describe('the cancellation route', () => {
    test('writes the cancellation and records it under the operator, the address not named', async () => {
        const installation = await anInvoiceToCollect();
        const logged = [];
        const request = { headers: {} };

        const cancelled = await aController(installation, logged).cancel(
            'acme',
            installation.invoice.id,
            { ...REQUEST, corrections: { city: 'Bremen' }, deliverTo: 'accounts@t1.example' },
            request,
        );

        assert.equal(cancelled.cancellation.cancelledBy, 'web:anna@example.com:admin');
        assert.deepEqual(logged, [
            [
                request,
                'SubscriptionInvoice',
                installation.invoice.id,
                INVOICE_CANCELLED_AUDIT_ACTION,
                {
                    tenantId: 't1',
                    number: installation.invoice.number,
                    cancellationNumber: cancelled.cancellationInvoice.number,
                    replacementNumber: cancelled.replacement.number,
                    reason: REQUEST.reason,
                    corrected: ['city'],
                    deliverToGiven: true,
                    paidOnIssue: 0,
                    credited: 0,
                    withdrawnCollections: 0,
                },
            ],
        ]);
    });

    test('of another tenant’s invoice is refused as none, and nothing is recorded', async () => {
        const installation = await anInvoiceToCollect();
        const logged = [];

        assert.deepEqual(
            await refusalOf(
                aController(installation, logged).cancel(
                    'other',
                    installation.invoice.id,
                    REQUEST,
                    {},
                ),
            ),
            [404, INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_NOT_FOUND],
        );
        assert.deepEqual(logged, []);
        assert.deepEqual(heldBy(installation)[1], 0);
    });
});

describe('the invoice an operator names by its number', () => {
    test('is the tenant’s invoice under that number, and none of another tenant or none so numbered', async () => {
        const installation = await anInvoiceToCollect();
        const { cancellation, invoice } = installation;

        assert.deepEqual(
            [
                await cancellation.invoiceIdNumbered('t1', invoice.number),
                await cancellation.invoiceIdNumbered('t2', invoice.number),
                await cancellation.invoiceIdNumbered('t1', 'AHP-2026-999999'),
            ],
            [invoice.id, null, null],
        );
    });
});

// @requirement SC-ADM-015 — The administration only offers what the application actually has
describe('where the cancellation is served', () => {
    const CANCELLATION_ROUTES = [
        'POST admin/tenants/:slug/invoices/:invoiceId/cancellation',
        'POST admin/tenants/:slug/invoices/:invoiceId/cancellation/preview',
    ];
    const servedBy = (options) =>
        controllersIn(SaaSiCatModule.forRoot(options))
            .flatMap(handlersOf)
            .map((handler) => handler.route)
            .filter((route) => route.includes('/cancellation'))
            .sort();

    test('beside the invoices’ documents, announced as invoices.cancel with its audit action', async () => {
        const root = SaaSiCatModule.forRoot(invoicingPlatform());
        const moduleRef = await Test.createTestingModule({ imports: [root] }).compile();
        try {
            const manifest = await moduleRef.get(AdminManifestService).getManifest();

            assert.deepEqual(servedBy(invoicingPlatform()), CANCELLATION_ROUTES);
            assert.equal(manifest.capabilities['invoices.cancel'], true);
            assert.ok(
                manifest.audit.actions.some(
                    (action) => action.key === INVOICE_CANCELLED_AUDIT_ACTION,
                ),
                'the audit action the cancellation writes is not labelled',
            );
        } finally {
            await moduleRef.close();
        }
    });

    test('nowhere the administration shows no tenants', () => {
        assert.deepEqual(servedBy({ ...invoicingPlatform(), adminResources: false }), []);
    });
});
