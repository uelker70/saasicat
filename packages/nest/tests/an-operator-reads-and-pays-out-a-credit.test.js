// The operator reads a subscriber's credits beside its tenant, and records a
// payout made outside the gateway against one.
//
// The credits are made the way the platform makes them — a payment beyond its
// invoice, an invoice whose total is negative — in a store kept as the
// persistence contract holds both adapters to keep it, and read and paid out
// through `SubscriberCreditService` and the route's own controller.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { INVOICE_ERROR_CODES } from '@saasicat/core';

import {
    RecordSubscriberPayoutDto,
    SubscriberCreditModule,
    SubscriberCreditService,
} from '../dist/billing/index.js';
import { AdminManifestService, SaaSiCatModule } from '../dist/platform/index.js';
import {
    SignedInGuard,
    bootable,
    controllersIn,
    everythingOnOptions,
    handlersOf,
} from './helpers/operator-routes.js';
import { MemorySubscriberPayments } from './helpers/subscriber-payments.js';

const PAID = new Date('2026-02-01T05:30:00.000Z');

/** An invoice of `subscriberId` totalling `totalGross`. */
const invoiceOf = (id, subscriberId, totalGross) => ({
    id,
    number: `AHP-2026-0000${id.slice(-2)}`,
    subscriberId,
    tenantId: `tenant-of-${subscriberId}`,
    totalGross,
    currency: 'EUR',
});

/**
 * Two subscribers, each with an invoice paid 5.00 beyond what it owed and an
 * invoice totalling −40.00 — so each has two credits —, and the service that
 * reads and pays them out, in the zone `Europe/Berlin`.
 */
async function twoSubscribersWithCredits() {
    const invoices = [
        invoiceOf('invoice-01', 'subscriber-1', 58.31),
        invoiceOf('invoice-02', 'subscriber-1', -40),
        invoiceOf('invoice-03', 'subscriber-2', 58.31),
        invoiceOf('invoice-04', 'subscriber-2', -40),
    ];
    const payments = new MemorySubscriberPayments(invoices);
    for (const [invoiceId, ref] of [
        ['invoice-01', 'pi_1'],
        ['invoice-03', 'pi_3'],
    ]) {
        await payments.recordPayment({
            invoiceId,
            collectionId: `attempt-${invoiceId}`,
            gatewayAccount: 'stripe-main',
            provider: 'stripe',
            gatewayRef: ref,
            amount: 63.31,
            currency: 'EUR',
            at: PAID,
        });
    }
    await payments.creditInvoice('invoice-02', new Date('2026-02-02T00:00:00.000Z'));
    await payments.creditInvoice('invoice-04', new Date('2026-02-02T00:00:00.000Z'));
    const subscribers = {
        findByTenantId: async (tenantId) =>
            tenantId.startsWith('tenant-of-') ? { id: tenantId.slice('tenant-of-'.length) } : null,
    };
    const store = {
        findById: async (id) => invoices.find((invoice) => invoice.id === id) ?? null,
    };
    const service = new SubscriberCreditService(payments, store, subscribers, {
        timeZone: 'Europe/Berlin',
    });
    const [ofTheFirst, ofTheSecond] = [
        await payments.listCredits('subscriber-1'),
        await payments.listCredits('subscriber-2'),
    ];
    return { service, payments, ofTheFirst, ofTheSecond };
}

/** A payout of `amount` against `creditId`, left on `paidOn`. */
const payoutOf = (amount, paidOn = '2026-03-03', overrides = {}) => ({
    amount,
    reference: 'TRF-2026-0042',
    paidOn,
    note: null,
    ...overrides,
});

/** The coded refusal a payout is answered with. */
const refusedAs = (status, code, params) => (error) => {
    assert.equal(error.getStatus(), status);
    assert.equal(error.getResponse().code, code);
    if (params) assert.deepEqual(error.getResponse().params, params);
    return true;
};

// @requirement SC-PRIC-083 — A credit is paid out by the operator, and never offset against a later invoice
describe("the operator reads a subscriber's credits", () => {
    test('the oldest first, each named by the invoice it comes from, with what is open', async () => {
        const { service } = await twoSubscribersWithCredits();

        const { credits, timeZone } = await service.creditsOf('tenant-of-subscriber-1');

        assert.equal(timeZone, 'Europe/Berlin', 'the zone a payout day is judged in');
        assert.deepEqual(
            credits.map(({ origin, amount, open, createdAt }) => ({
                origin,
                amount,
                open,
                createdAt,
            })),
            [
                {
                    origin: {
                        kind: 'payment',
                        paymentRef: 'pi_1',
                        invoiceNumber: 'AHP-2026-000001',
                    },
                    amount: 5,
                    open: 5,
                    createdAt: PAID.toISOString(),
                },
                {
                    origin: { kind: 'invoice', invoiceNumber: 'AHP-2026-000002' },
                    amount: 40,
                    open: 40,
                    createdAt: '2026-02-02T00:00:00.000Z',
                },
            ],
        );
    });

    test('a tenant without a subscriber has none', async () => {
        const { service } = await twoSubscribersWithCredits();

        assert.deepEqual(await service.creditsOf('tenant-without'), {
            credits: [],
            timeZone: 'Europe/Berlin',
        });
    });

    test('a refund paid out of a credit is shown with its reference at the gateway', async () => {
        const { service, payments } = await twoSubscribersWithCredits();
        await payments.recordRefund({
            gatewayAccount: 'stripe-main',
            gatewayRef: 're_1',
            paymentRef: 'pi_1',
            amount: 5,
            currency: 'EUR',
            status: 'PENDING',
            at: new Date('2026-02-10T09:00:00.000Z'),
        });

        const [paidBack] = (await service.creditsOf('tenant-of-subscriber-1')).credits;

        assert.equal(paidBack.open, 0);
        assert.deepEqual(paidBack.entries, [
            {
                kind: 'REFUND',
                amount: 5,
                reference: 're_1',
                paidOn: null,
                note: null,
                recordedAt: '2026-02-10T09:00:00.000Z',
            },
        ]);
    });
});

// @requirement SC-PRIC-083 — A credit is paid out by the operator, and never offset against a later invoice
describe('a payout the operator records', () => {
    test('is written against the credit, with its reference and who recorded it, up to what is open', async () => {
        const { service, ofTheFirst } = await twoSubscribersWithCredits();
        const [, fromInvoice] = ofTheFirst;

        const recorded = await service.payOut(
            'tenant-of-subscriber-1',
            fromInvoice.credit.id,
            payoutOf(40, '2026-03-03', { reference: '  TRF-2026-0042 ', note: '  ' }),
            'operator-1',
            new Date('2026-03-03T10:00:00.000Z'),
        );

        assert.deepEqual(recorded.entry, {
            kind: 'PAYOUT',
            amount: 40,
            reference: 'TRF-2026-0042',
            paidOn: '2026-03-03',
            note: null,
            recordedAt: '2026-03-03T10:00:00.000Z',
        });
        assert.deepEqual(
            recorded.credits.credits.map((credit) => credit.open),
            [5, 0],
        );
    });

    test('beyond what the credit still owes is refused, naming what is open, and nothing is written', async () => {
        const { service, payments, ofTheFirst } = await twoSubscribersWithCredits();
        const [fromPayment] = ofTheFirst;

        await assert.rejects(
            service.payOut('tenant-of-subscriber-1', fromPayment.credit.id, payoutOf(5.01), 'op'),
            refusedAs(409, INVOICE_ERROR_CODES.SUBSCRIBER_PAYOUT_EXCEEDS_CREDIT, {
                creditId: fromPayment.credit.id,
                open: '5.00',
            }),
        );
        assert.deepEqual(
            (await payments.listCredits('subscriber-1')).map((standing) => standing.entries),
            [[], []],
        );
    });

    test("of another subscriber's credit is refused as one that does not exist", async () => {
        const { service, payments, ofTheSecond } = await twoSubscribersWithCredits();
        const [foreign] = ofTheSecond;

        await assert.rejects(
            service.payOut('tenant-of-subscriber-1', foreign.credit.id, payoutOf(1), 'op'),
            refusedAs(404, INVOICE_ERROR_CODES.SUBSCRIBER_CREDIT_NOT_FOUND, {
                creditId: foreign.credit.id,
            }),
        );
        await assert.rejects(
            service.payOut('tenant-without', foreign.credit.id, payoutOf(1), 'op'),
            refusedAs(404, INVOICE_ERROR_CODES.SUBSCRIBER_CREDIT_NOT_FOUND),
        );
        assert.equal((await payments.listCredits('subscriber-2'))[0].open, 5);
    });

    test('on a day still to come in the installation’s zone is refused, and today is not', async () => {
        const { service, ofTheFirst } = await twoSubscribersWithCredits();
        const [, fromInvoice] = ofTheFirst;
        // 23:30 UTC on 3 March is already 4 March in Berlin.
        const lateEvening = new Date('2026-03-03T23:30:00.000Z');

        await assert.rejects(
            service.payOut(
                'tenant-of-subscriber-1',
                fromInvoice.credit.id,
                payoutOf(1, '2026-03-05'),
                'op',
                lateEvening,
            ),
            refusedAs(400, INVOICE_ERROR_CODES.SUBSCRIBER_PAYOUT_NOT_MADE_YET, {
                paidOn: '2026-03-05',
                today: '2026-03-04',
            }),
        );
        const recorded = await service.payOut(
            'tenant-of-subscriber-1',
            fromInvoice.credit.id,
            payoutOf(1, '2026-03-04'),
            'op',
            lateEvening,
        );
        assert.equal(recorded.entry.paidOn, '2026-03-04');
    });
});

describe('a payout as the route takes it', () => {
    const problemsOf = async (body) =>
        (await validate(plainToInstance(RecordSubscriberPayoutDto, body))).map(
            (error) => error.property,
        );

    test('a valid one passes, a note left out or empty included', async () => {
        assert.deepEqual(await problemsOf(payoutOf(0.01)), []);
        assert.deepEqual(await problemsOf({ ...payoutOf(40), note: undefined }), []);
        assert.deepEqual(await problemsOf(payoutOf(9_999_999_999.99)), []);
    });

    for (const [why, body, property] of [
        ['nothing', payoutOf(0), 'amount'],
        ['less than nothing', payoutOf(-1), 'amount'],
        ['a fraction of a cent', payoutOf(1.005), 'amount'],
        ['more than the columns hold', payoutOf(10_000_000_000), 'amount'],
        ['a reference of blanks', payoutOf(1, '2026-03-03', { reference: '   ' }), 'reference'],
        [
            'a reference too long',
            payoutOf(1, '2026-03-03', { reference: 'x'.repeat(201) }),
            'reference',
        ],
        ['a moment instead of a day', payoutOf(1, '2026-03-03T10:00:00Z'), 'paidOn'],
        ['a day no calendar has', payoutOf(1, '2026-02-30'), 'paidOn'],
        ['a note too long', payoutOf(1, '2026-03-03', { note: 'x'.repeat(501) }), 'note'],
    ]) {
        test(`with ${why} is refused`, async () => {
            assert.deepEqual(await problemsOf(body), [property]);
        });
    }
});

describe('the route', () => {
    test('records the payout in the audit log as the operator who made it, and answers the credits', async () => {
        const { service, ofTheFirst } = await twoSubscribersWithCredits();
        const [, fromInvoice] = ofTheFirst;
        const [Controller] = SubscriberCreditModule.forRoot({
            guards: [],
            imports: [],
        }).controllers;
        const logged = [];
        const controller = new Controller(
            { getTenantDetail: async (slug) => ({ id: `tenant-of-${slug}`, slug }) },
            service,
            {
                actorTagFromRequest: () => 'operator:op-1',
                logFromRequest: async (...entry) => logged.push(entry),
            },
            { runWithBypass: (fn) => fn() },
        );

        const answered = await controller.payOut(
            'subscriber-1',
            fromInvoice.credit.id,
            payoutOf(10, '2026-01-01'),
            { user: { id: 'op-1' } },
        );

        assert.deepEqual(
            answered.credits.map((credit) => credit.open),
            [5, 30],
        );
        assert.deepEqual(logged, [
            [
                { user: { id: 'op-1' } },
                'SubscriberCredit',
                fromInvoice.credit.id,
                'SUBSCRIBER_CREDIT_PAID_OUT',
                {
                    tenantId: 'tenant-of-subscriber-1',
                    amount: 10,
                    reference: 'TRF-2026-0042',
                    paidOn: '2026-01-01',
                },
            ],
        ]);
    });

    test('is served only where what collections bring is recorded', () => {
        const routes = (options) =>
            controllersIn(SaaSiCatModule.forRoot(options))
                .flatMap(handlersOf)
                .map((handler) => handler.route)
                .filter((route) => route.includes('credits'))
                .sort();
        const collecting = everythingOnOptions([SignedInGuard], { collecting: true });
        const unrecorded = everythingOnOptions([SignedInGuard], { collecting: true });
        unrecorded.tenantBilling.chargeJournal.invoices.payments = undefined;

        assert.deepEqual(routes(collecting), [
            'GET admin/tenants/:slug/credits',
            'POST admin/tenants/:slug/credits/:creditId/payouts',
        ]);
        assert.deepEqual(routes(unrecorded), []);
        assert.deepEqual(routes(everythingOnOptions()), []);
    });
});

// @requirement SC-ADM-015 — The administration only offers what the application actually has
describe('the manifest', () => {
    test('announces the credits and the payout where they are served, and neither where they are not', async () => {
        const capabilitiesOf = async (options) => {
            const moduleRef = await Test.createTestingModule({
                imports: [SaaSiCatModule.forRoot(bootable(options))],
            }).compile();
            try {
                const { capabilities } = await moduleRef.get(AdminManifestService).getManifest();
                return [capabilities['credits.read'], capabilities['credits.payout']];
            } finally {
                await moduleRef.close();
            }
        };

        assert.deepEqual(
            await capabilitiesOf(everythingOnOptions([SignedInGuard], { collecting: true })),
            [true, true],
        );
        assert.deepEqual(await capabilitiesOf(everythingOnOptions()), [undefined, undefined]);
    });
});
