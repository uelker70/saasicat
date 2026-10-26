// The operator's path to cancelling an issued invoice: what the request may
// hold before anything is computed, the invoice the dialog reads with what
// each line may become, the preview route that writes nothing,
// the cancellation route behind the second factor that records itself in the
// audit log, the cancellation held to the preview the operator confirmed,
// where both are served and announced, the invoice named by the number on its
// document, and the tenant's invoices saying which is cancelled by which.
//
// Over the installation in memory the cancellation tests use, whose invoices,
// attempts and payments are kept as the persistence contract holds both
// adapters to keep them.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
    INVOICE_CANCELLATION_REASON_MAX_LENGTH,
    INVOICE_CORRECTION_MAX_LENGTH,
    INVOICE_ERROR_CODES,
    SUBSCRIBER_ERROR_CODES,
} from '@saasicat/core';

import {
    CancelInvoiceDto,
    INVOICE_CANCELLED_AUDIT_ACTION,
    InvoiceCancellationModule,
    SubscriberReconciliationService,
} from '../dist/billing/index.js';
import { AdminManifestService, SaaSiCatModule } from '../dist/platform/index.js';
import { FIRST_RUN, anInvoiceToCollect } from './helpers/invoice-collection.js';
import { succeeded } from './helpers/money-events.js';
import { invoicingPlatform } from './helpers/invoicing-platform.js';
import { controllersIn, handlersOf } from './helpers/operator-routes.js';

/** 10:00 in Berlin on 20 March, when the operator cancels the invoice of February. */
const CANCELLED_AT = new Date('2026-03-20T09:00:00.000Z');

const REQUEST = { reason: 'The billing address was wrong.' };

/** A digest shaped as a preview answers one: SHA-256, in hex. */
const DIGEST = 'a'.repeat(64);

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

/** The route's own controller over `installation`; it names no tenant, the invoice is its key. */
function aController(installation, logged = []) {
    const [Controller] = InvoiceCancellationModule.forRoot({ guards: [], imports: [] }).controllers;
    return new Controller(
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
        assert.deepEqual(await problemsOf({ ...REQUEST, previewDigest: DIGEST }), []);
        assert.deepEqual(
            await problemsOf({
                ...REQUEST,
                lines: [
                    { position: 2, owed: 24.5 },
                    { position: 1, owed: 0 },
                ],
            }),
            [],
        );
        assert.deepEqual(
            await problemsOf({ reason: 'x'.repeat(INVOICE_CANCELLATION_REASON_MAX_LENGTH) }),
            [],
        );
    });

    test('is trimmed before its lengths are checked, as the service settles it', async () => {
        assert.deepEqual(
            await problemsOf({
                reason: `  ${'x'.repeat(INVOICE_CANCELLATION_REASON_MAX_LENGTH)}  `,
                corrections: { city: ` ${'x'.repeat(INVOICE_CORRECTION_MAX_LENGTH)} ` },
                deliverTo: `  ${'a'.repeat(242)}@t1.example  `,
            }),
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
        [
            'a correction a character too long',
            { ...REQUEST, corrections: { city: 'x'.repeat(INVOICE_CORRECTION_MAX_LENGTH + 1) } },
            'corrections',
        ],
        ['an address that is no text', { ...REQUEST, deliverTo: 42 }, 'deliverTo'],
        [
            'an address longer than one can be',
            { ...REQUEST, deliverTo: `${'a'.repeat(246)}@t1.example` },
            'deliverTo',
        ],
        ['a digest that is no text', { ...REQUEST, previewDigest: 42 }, 'previewDigest'],
        [
            'a digest a character short',
            { ...REQUEST, previewDigest: DIGEST.slice(1) },
            'previewDigest',
        ],
        [
            'a digest in capitals',
            { ...REQUEST, previewDigest: DIGEST.toUpperCase() },
            'previewDigest',
        ],
        ['lines that are no list', { ...REQUEST, lines: { position: 1, owed: 0 } }, 'lines'],
        [
            'a line named by the text of its position',
            { ...REQUEST, lines: [{ position: '1', owed: 0 }] },
            'lines',
        ],
        [
            'a line named by a fraction',
            { ...REQUEST, lines: [{ position: 1.5, owed: 0 }] },
            'lines',
        ],
        [
            'what is owed given as text',
            { ...REQUEST, lines: [{ position: 1, owed: '24.50' }] },
            'lines',
        ],
        ['what is owed as null', { ...REQUEST, lines: [{ position: 1, owed: null }] }, 'lines'],
        ['what is owed left out', { ...REQUEST, lines: [{ position: 1 }] }, 'lines'],
    ]) {
        test(`with ${why} is refused`, async () => {
            assert.deepEqual(await problemsOf(body), [property]);
        });
    }

    test('keeps the lines through a pipe that strips what no decorator names', async () => {
        const pipe = new ValidationPipe({ whitelist: true, transform: true });
        const lines = [{ position: 1, owed: 24.5 }];

        const settled = await pipe.transform(
            { ...REQUEST, lines },
            { type: 'body', metatype: CancelInvoiceDto },
        );

        assert.deepEqual(
            settled.lines.map((line) => ({ ...line })),
            lines,
        );
    });
});

// @requirement SC-ADM-020 — Six actions require a written reason, cancelling an invoice among them
describe('a cancellation settles what it is given before anything else', () => {
    const previewWith = (installation, request) =>
        installation.cancellation.preview(installation.invoice.id, request, CANCELLED_AT);

    test('the reason and the address trimmed, as the preview shows and the cancellation records them', async () => {
        const installation = await anInvoiceToCollect();
        const request = {
            reason: '  The billing address was wrong.  ',
            deliverTo: '  accounts@t1.example ',
        };

        const plan = await previewWith(installation, request);
        const { cancellation } = await installation.cancellation.cancel(
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

    test('takes a correction of exactly the longest length', async () => {
        const installation = await anInvoiceToCollect();
        const city = 'x'.repeat(INVOICE_CORRECTION_MAX_LENGTH);

        const plan = await previewWith(installation, { ...REQUEST, corrections: { city } });

        assert.equal(plan.replacement.subscriber.city, city);
    });

    for (const [why, corrections, code] of [
        [
            'a correction a character too long, as the command line gives it',
            { city: 'x'.repeat(INVOICE_CORRECTION_MAX_LENGTH + 1) },
            SUBSCRIBER_ERROR_CODES.SUBSCRIBER_DETAIL_INVALID,
        ],
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

// @requirement SC-ADM-035 — The operator says, line by line, what of a cancelled invoice is still owed
describe('the invoice the cancel dialog reads', () => {
    const readOf = (installation, invoiceId = installation.invoice.id) =>
        aController(installation).invoice(invoiceId);
    const asRead = (lines) =>
        lines.map((line) => [
            line.position,
            line.origin,
            line.amountNet,
            line.standsAt,
            line.correctable,
            line.correctsPosition,
        ]);

    test('names each line with what it stands at, and the charge’s line alone may be corrected', async () => {
        const installation = await anInvoiceToCollect();
        const { invoice } = installation;

        const read = await readOf(installation);

        assert.deepEqual(
            [read.id, read.number, read.issuedAt, read.totalGross, read.currency],
            [
                invoice.id,
                invoice.number,
                invoice.issuedAt.toISOString(),
                invoice.totalGross,
                invoice.currency,
            ],
        );
        assert.deepEqual(asRead(read.lines), [
            [1, invoice.lines[0].origin, 49, 49, true, null],
            [2, invoice.lines[1].origin, -4.9, -4.9, false, null],
        ]);
    });

    /** A replacement of the invoice with the plan owed in part, archived and mailed. */
    async function aLoweredReplacement(installation) {
        const { replacement } = await installation.cancellation.cancel(
            installation.invoice.id,
            { ...REQUEST, lines: [{ position: 1, owed: 24.5 }] },
            'operator:anna',
            CANCELLED_AT,
        );
        installation.mailed(replacement.id, CANCELLED_AT);
        return replacement;
    }

    test('of a replacement, says what an earlier cancellation lowered each charge to', async () => {
        const installation = await anInvoiceToCollect();
        const replacement = await aLoweredReplacement(installation);

        const read = await readOf(installation, replacement.id);

        assert.deepEqual(asRead(read.lines), [
            [1, installation.invoice.lines[0].origin, 49, 24.5, true, null],
            [2, 'correction', -24.5, -24.5, false, 1],
            [3, installation.invoice.lines[1].origin, -4.9, -2.45, false, null],
            [4, 'correction', 2.45, 2.45, false, 3],
        ]);
    });

    test('offers exactly the lines the cancellation accepts', async () => {
        const installation = await anInvoiceToCollect();
        const replacement = await aLoweredReplacement(installation);
        const { lines } = await readOf(installation, replacement.id);

        const accepted = [];
        for (const line of lines) {
            const preview = installation.cancellation.preview(
                replacement.id,
                { ...REQUEST, lines: [{ position: line.position, owed: 0 }] },
                CANCELLED_AT,
            );
            accepted.push(
                await preview.then(
                    () => true,
                    (error) => {
                        assert.equal(
                            error.getResponse().code,
                            INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_LINE_NOT_CORRECTABLE,
                        );
                        return false;
                    },
                ),
            );
        }

        assert.deepEqual(
            accepted,
            lines.map((line) => line.correctable),
        );
        assert.ok(accepted.includes(true) && accepted.includes(false));
    });

    test('of an invoice there is not is refused as none', async () => {
        const installation = await anInvoiceToCollect();

        assert.deepEqual(await refusalOf(readOf(installation, 'no-such-invoice')), [
            404,
            INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_NOT_FOUND,
        ]);
    });
});

// @requirement SC-UI-017 — A confirmation shows the answer to the question actually being asked
describe('the preview route', () => {
    test('answers what the cancellation would write, and writes nothing', async () => {
        const installation = await anInvoiceToCollect();
        const logged = [];
        const before = heldBy(installation);

        const plan = await aController(installation, logged).preview(
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

    test('of an invoice there is not is refused as none', async () => {
        const installation = await anInvoiceToCollect();

        assert.deepEqual(
            await refusalOf(aController(installation).preview('no-such-invoice', REQUEST)),
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
                    correctedLines: [],
                    deliverToGiven: true,
                    paidOnIssue: 0,
                    credited: 0,
                    withdrawnCollections: 0,
                },
            ],
        ]);
    });

    test('records each line it moved, from what to what, in the invoice’s currency', async () => {
        const installation = await anInvoiceToCollect();
        const logged = [];

        await aController(installation, logged).cancel(
            installation.invoice.id,
            { ...REQUEST, lines: [{ position: 1, owed: 24.5 }] },
            { headers: {} },
        );

        assert.deepEqual(logged[0][4].correctedLines, [
            { position: 1, standsAt: 49, becomes: 24.5 },
            { position: 2, standsAt: -4.9, becomes: -2.45 },
        ]);
    });

    test('of an invoice there is not is refused as none, and nothing is recorded', async () => {
        const installation = await anInvoiceToCollect();
        const logged = [];

        assert.deepEqual(
            await refusalOf(
                aController(installation, logged).cancel('no-such-invoice', REQUEST, {}),
            ),
            [404, INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_NOT_FOUND],
        );
        assert.deepEqual(logged, []);
        assert.deepEqual(heldBy(installation)[1], 0);
    });
});

// @requirement SC-UI-017 — A confirmation shows the answer to the question actually being asked
describe('a cancellation held to the preview the operator confirmed', () => {
    const previewOf = ({ cancellation, invoice }, at = CANCELLED_AT) =>
        cancellation.preview(invoice.id, REQUEST, at);
    const cancelConfirming = ({ cancellation, invoice }, previewDigest) =>
        cancellation.cancel(
            invoice.id,
            { ...REQUEST, previewDigest },
            'operator:anna',
            CANCELLED_AT,
        );

    /** The refusal's status, its code and the preview it carries. */
    async function changedSincePreview(attempt) {
        try {
            await attempt;
        } catch (error) {
            const { code, preview } = error.getResponse();
            return { status: error.getStatus(), code, preview };
        }
        throw new Error('it was not refused');
    }

    test('is written where it would write what the preview showed', async () => {
        const installation = await anInvoiceToCollect();

        const plan = await previewOf(installation);
        const cancelled = await cancelConfirming(installation, plan.digest);

        assert.equal(cancelled.cancellation.cancelledInvoiceId, installation.invoice.id);
    });

    test('names the same preview by the same digest at another moment of its day, and another the next day', async () => {
        const installation = await anInvoiceToCollect();

        const [atTen, atFive, nextDay] = [
            await previewOf(installation),
            await previewOf(installation, new Date('2026-03-20T16:00:00.000Z')),
            await previewOf(installation, new Date('2026-03-21T09:00:00.000Z')),
        ];

        assert.match(atTen.digest, /^[0-9a-f]{64}$/);
        assert.equal(atFive.digest, atTen.digest);
        assert.notEqual(nextDay.digest, atTen.digest);
    });

    test('is refused with another preview’s digest, with the preview as it stands, and nothing is written', async () => {
        const installation = await anInvoiceToCollect();
        const plan = await previewOf(installation);
        const before = heldBy(installation);

        const refusal = await changedSincePreview(cancelConfirming(installation, DIGEST));

        assert.deepEqual(
            [refusal.status, refusal.code, refusal.preview.digest],
            [
                409,
                INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_CANCELLATION_PREVIEW_CHANGED,
                plan.digest,
            ],
        );
        assert.deepEqual(heldBy(installation), before);
    });

    test('is refused where a payment came in after the preview, with the preview that counts it', async () => {
        const installation = await anInvoiceToCollect();
        const shown = await previewOf(installation);
        installation.gateway.answers.push(succeeded(installation.invoice, 'pi_late', 20));
        await installation.collect(FIRST_RUN);

        const refusal = await changedSincePreview(cancelConfirming(installation, shown.digest));

        assert.deepEqual(
            [refusal.code, shown.movedIn, refusal.preview.movedIn],
            [INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_CANCELLATION_PREVIEW_CHANGED, 0, 20],
        );
        assert.equal(heldBy(installation)[1], 0);
    });

    test('is refused where the legal name was corrected after the preview, though no amount moved', async () => {
        const installation = await anInvoiceToCollect();
        const shown = await previewOf(installation);
        await installation.subscribers.correctIdentity(installation.subscriber.id, {
            kind: 'correction',
            legalName: 'Customer of t1 Holding GmbH',
            reason: 'Change of name of the same company',
            correctedBy: 'operator:ben',
        });

        const refusal = await changedSincePreview(cancelConfirming(installation, shown.digest));

        assert.deepEqual(
            [
                refusal.code,
                refusal.preview.replacement.subscriber.legalName,
                refusal.preview.replacement.totalGross,
            ],
            [
                INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_CANCELLATION_PREVIEW_CHANGED,
                'Customer of t1 Holding GmbH',
                shown.replacement.totalGross,
            ],
        );
        assert.equal(heldBy(installation)[1], 0);
    });
});

// @requirement SC-ADM-040 — Each invoice in the subscriber's record says what it corrects and what cancelled it
describe('the invoices in the subscriber’s record after a cancellation', () => {
    test('say which is cancelled, which cancels it and which replaces it, and nothing of the rest', async () => {
        const installation = await anInvoiceToCollect();
        const { invoice } = installation;
        const { cancellationInvoice, replacement } = await installation.cancellation.cancel(
            invoice.id,
            REQUEST,
            'operator:anna',
            CANCELLED_AT,
        );
        const listing = new SubscriberReconciliationService(
            installation.payments,
            installation.store,
            installation.subscriberRepository,
        );

        const { invoices } = await listing.paymentsOf(invoice.subscriberId);

        const of = { invoiceId: invoice.id, number: invoice.number, issueDate: invoice.issueDate };
        const cancelledBy = {
            invoiceId: cancellationInvoice.id,
            number: cancellationInvoice.number,
        };
        assert.deepEqual(
            invoices.map((each) => [each.number, each.correction, each.cancelledBy]),
            [
                [replacement.number, { kind: 'replacement', of }, null],
                [cancellationInvoice.number, { kind: 'cancellation', of }, null],
                [invoice.number, null, cancelledBy],
            ],
        );
    });
});

// @requirement SC-ADM-042 — An operator lists the invoices of chosen months, summed per tax treatment and rate
describe('the invoice an operator names by its number', () => {
    test('is the invoice under that number with the tenant it was issued for, and none for a number none carries', async () => {
        const installation = await anInvoiceToCollect();
        const { cancellation, invoice } = installation;

        assert.deepEqual(
            [
                await cancellation.invoiceNumbered(invoice.number),
                await cancellation.invoiceNumbered('AHP-2026-999999'),
            ],
            [{ invoiceId: invoice.id, tenantId: invoice.tenantId }, null],
        );
    });
});

// @requirement SC-ADM-015 — The administration only offers what the application actually has
describe('where the cancellation is served', () => {
    const CANCELLATION_ROUTES = [
        'GET admin/invoices/:invoiceId',
        'POST admin/invoices/:invoiceId/cancellation',
        'POST admin/invoices/:invoiceId/cancellation/preview',
    ];
    const servedBy = (options) =>
        controllersIn(SaaSiCatModule.forRoot(options))
            .flatMap(handlersOf)
            .map((handler) => handler.route)
            .filter((route) => route.includes('/invoices/:invoiceId'))
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
