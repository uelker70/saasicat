// The operator reconciles what the gateway reported and nothing matched: the
// cases on a list of their own, each closed with a note, and a tenant's
// invoices with what each still owes beside its open cases.
//
// The cases are made the way the platform makes them — a refund beyond any
// credit, a reversal beyond the payment — in a store kept as the persistence
// contract holds both adapters to keep it, and read and closed through
// `SubscriberReconciliationService` and the route's own controller.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { INVOICE_ERROR_CODES } from '@saasicat/core';

import {
    CloseReconciliationCaseDto,
    RECONCILIATION_PAGE_SIZE,
    ReconciliationListQuery,
    SubscriberReconciliationModule,
    SubscriberReconciliationService,
} from '../dist/billing/index.js';
import { AdminManifestService, SaaSiCatModule } from '../dist/platform/index.js';
import {
    SignedInGuard,
    bootable,
    controllersIn,
    everythingOnOptions,
    withoutInvoicing,
    handlersOf,
} from './helpers/operator-routes.js';
import { MemorySubscriberPayments } from './helpers/subscriber-payments.js';

const PAID = new Date('2026-02-01T05:30:00.000Z');

/** An invoice of `subscriberId` totalling `totalGross`, issued on `issuedAt`. */
const invoiceOf = (id, subscriberId, totalGross, issuedAt = '2026-02-01T05:15:00.000Z') => ({
    id,
    number: `AHP-2026-0000${id.slice(-2)}`,
    subscriberId,
    tenantId: `tenant-of-${subscriberId}`,
    totalGross,
    currency: 'EUR',
    issuedAt: new Date(issuedAt),
    dueDate: '2026-02-15',
});

/**
 * Two subscribers, each with an invoice paid exactly; the first refunded 30.00
 * of a payment that left no credit — a case — and its second invoice open. The
 * service reads and closes the cases.
 */
async function twoSubscribersWithACase() {
    const invoices = [
        invoiceOf('invoice-01', 'subscriber-1', 58.31),
        invoiceOf('invoice-02', 'subscriber-1', 20, '2026-03-01T05:15:00.000Z'),
        invoiceOf('invoice-03', 'subscriber-2', 58.31),
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
            amount: 58.31,
            currency: 'EUR',
            at: PAID,
        });
    }
    await payments.recordRefund({
        gatewayAccount: 'stripe-main',
        gatewayRef: 're_1',
        paymentRef: 'pi_1',
        amount: 30,
        currency: 'EUR',
        status: 'SUCCEEDED',
        at: new Date('2026-02-10T09:00:00.000Z'),
    });
    const subscribers = {
        findByTenantId: async (tenantId) =>
            tenantId.startsWith('tenant-of-') ? { id: tenantId.slice('tenant-of-'.length) } : null,
        findById: async (id) => ({
            id,
            customerNumber: `K-${id.slice(-1)}`,
            legalName: `Kunde ${id.slice(-1)} GmbH`,
        }),
    };
    const store = {
        findById: async (id) => invoices.find((invoice) => invoice.id === id) ?? null,
        listBySubscriber: async (subscriberId) =>
            invoices
                .filter((invoice) => invoice.subscriberId === subscriberId)
                .sort((a, b) => b.issuedAt - a.issuedAt),
        // The first invoice's document is archived; the second waits for its own.
        listArchivedDocuments: async (invoiceIds) =>
            invoiceIds.filter((id) => id === 'invoice-01' || id === 'invoice-03'),
    };
    const service = new SubscriberReconciliationService(payments, store, subscribers);
    return { service, payments };
}

/** The coded refusal a request is answered with. */
const refusedAs = (status, code) => (error) => {
    assert.equal(error.getStatus(), status);
    assert.equal(error.getResponse().code, code);
    return true;
};

// @requirement SC-ADM-033 — The operator reconciles what no credit matched, and closes each case with a note
describe('the cases to reconcile', () => {
    test('are listed open, the oldest first, with whom and what each is about', async () => {
        const { service } = await twoSubscribersWithACase();

        const { cases, next } = await service.cases('open');

        assert.equal(next, null);
        assert.deepEqual(
            cases.map((each) => ({
                kind: each.kind,
                amount: each.amount,
                tenantId: each.tenantId,
                subscriber: each.subscriber,
                payment: each.payment,
                reference: each.reference,
                closedAt: each.closedAt,
            })),
            [
                {
                    kind: 'REFUND_UNMATCHED',
                    amount: 30,
                    tenantId: 'tenant-of-subscriber-1',
                    subscriber: {
                        id: 'subscriber-1',
                        customerNumber: 'K-1',
                        legalName: 'Kunde 1 GmbH',
                    },
                    payment: { ref: 'pi_1', invoiceNumber: 'AHP-2026-000001' },
                    reference: 're_1',
                    closedAt: null,
                },
            ],
        );
        assert.deepEqual((await service.cases('closed')).cases, []);
    });

    test('are read a page at a time, the next one named', async () => {
        const { service, payments } = await twoSubscribersWithACase();
        for (let index = 0; index < RECONCILIATION_PAGE_SIZE; index += 1) {
            await payments.recordRefund({
                gatewayAccount: 'stripe-main',
                gatewayRef: `re_more_${index}`,
                paymentRef: 'pi_3',
                amount: 1,
                currency: 'EUR',
                status: 'SUCCEEDED',
                at: new Date(Date.UTC(2026, 1, 11, 0, index)),
            });
        }

        const first = await service.cases('open');
        const second = await service.cases('open', first.next);

        assert.equal(first.cases.length, RECONCILIATION_PAGE_SIZE);
        assert.equal(first.next, first.cases.at(-1).id);
        assert.deepEqual([second.cases.length, second.next], [1, null]);
    });

    test('are closed with the note, trimmed, by the operator who closed it', async () => {
        const { service } = await twoSubscribersWithACase();
        const [opened] = (await service.cases('open')).cases;

        const closed = await service.close(
            opened.id,
            '  Recovered by transfer TRF-9.  ',
            'operator:op-1',
        );

        assert.deepEqual(
            [closed.case.note, closed.case.closedBy, typeof closed.case.closedAt],
            ['Recovered by transfer TRF-9.', 'operator:op-1', 'string'],
        );
        assert.deepEqual((await service.cases('open')).cases, []);
        assert.deepEqual(
            (await service.cases('closed')).cases.map((each) => each.id),
            [opened.id],
        );
    });

    test('closed once: a second close is refused, and nothing is written', async () => {
        const { service } = await twoSubscribersWithACase();
        const [opened] = (await service.cases('open')).cases;
        await service.close(opened.id, 'First.', 'operator:op-1');

        await assert.rejects(
            service.close(opened.id, 'Second.', 'operator:op-2'),
            refusedAs(409, INVOICE_ERROR_CODES.SUBSCRIBER_RECONCILIATION_CASE_CLOSED),
        );
        assert.equal((await service.cases('closed')).cases[0].note, 'First.');
        await assert.rejects(
            service.close('no-such-case', 'Note.', 'operator:op-1'),
            refusedAs(404, INVOICE_ERROR_CODES.SUBSCRIBER_RECONCILIATION_CASE_NOT_FOUND),
        );
    });
});

// @requirement SC-ADM-033 — The operator reconciles what no credit matched, and closes each case with a note
describe("a tenant's payments", () => {
    test('are its invoices, the latest first, with what each still owes, and its open cases alone', async () => {
        const { service } = await twoSubscribersWithACase();

        const payments = await service.paymentsOf('tenant-of-subscriber-1');

        assert.deepEqual(
            payments.invoices.map((each) => [
                each.number,
                each.totalGross,
                each.owed,
                each.dueDate,
                each.documentArchived,
            ]),
            [
                ['AHP-2026-000002', 20, 20, '2026-02-15', false],
                ['AHP-2026-000001', 58.31, 0, '2026-02-15', true],
            ],
        );
        assert.deepEqual(
            payments.openCases.map((each) => each.reference),
            ['re_1'],
        );
        assert.deepEqual((await service.paymentsOf('tenant-of-subscriber-2')).openCases, []);
    });

    test('of a tenant without a subscriber are none', async () => {
        const { service } = await twoSubscribersWithACase();

        assert.deepEqual(await service.paymentsOf('tenant-alone'), { invoices: [], openCases: [] });
    });
});

describe('the requests as the routes take them', () => {
    const problemsOf = async (Type, body) =>
        (await validate(plainToInstance(Type, body))).map((error) => error.property);

    test('a note to close with says something, within its length', async () => {
        assert.deepEqual(await problemsOf(CloseReconciliationCaseDto, { note: 'Reconciled.' }), []);
        assert.deepEqual(await problemsOf(CloseReconciliationCaseDto, { note: '   ' }), ['note']);
        assert.deepEqual(await problemsOf(CloseReconciliationCaseDto, {}), ['note']);
        assert.deepEqual(
            await problemsOf(CloseReconciliationCaseDto, { note: 'x'.repeat(500) }),
            [],
        );
        assert.deepEqual(await problemsOf(CloseReconciliationCaseDto, { note: 'x'.repeat(501) }), [
            'note',
        ]);
    });

    test('a list asks for open or closed cases, nothing else', async () => {
        assert.deepEqual(await problemsOf(ReconciliationListQuery, {}), []);
        assert.deepEqual(await problemsOf(ReconciliationListQuery, { state: 'closed' }), []);
        assert.deepEqual(await problemsOf(ReconciliationListQuery, { state: 'all' }), ['state']);
    });
});

describe('the routes', () => {
    test('record the closing in the audit log as the operator who closed it, and answer the case', async () => {
        const { service } = await twoSubscribersWithACase();
        const [opened] = (await service.cases('open')).cases;
        const [Controller] = SubscriberReconciliationModule.forRoot({
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

        const answered = await controller.close(
            opened.id,
            { note: 'Recovered by transfer TRF-9.' },
            { user: { id: 'op-1' } },
        );

        assert.equal(answered.closedBy, 'operator:op-1');
        assert.deepEqual(logged, [
            [
                { user: { id: 'op-1' } },
                'SubscriberReconciliationCase',
                opened.id,
                'SUBSCRIBER_RECONCILIATION_CASE_CLOSED',
                {
                    tenantId: 'tenant-of-subscriber-1',
                    kind: 'REFUND_UNMATCHED',
                    amount: 30,
                    currency: 'EUR',
                    note: 'Recovered by transfer TRF-9.',
                },
            ],
        ]);
        assert.deepEqual((await controller.paymentsOf('subscriber-1')).openCases, []);
    });

    test('are served only where what collections bring is recorded', () => {
        const routes = (options) =>
            controllersIn(SaaSiCatModule.forRoot(options))
                .flatMap(handlersOf)
                .map((handler) => handler.route)
                .filter((route) => route.includes('reconciliation') || route.endsWith('/payments'))
                .sort();
        const collecting = everythingOnOptions([SignedInGuard]);
        const unrecorded = everythingOnOptions([SignedInGuard]);
        unrecorded.tenantBilling.chargeJournal.invoices.payments = undefined;

        assert.deepEqual(routes(collecting), [
            'GET admin/reconciliation',
            'GET admin/tenants/:slug/payments',
            'POST admin/reconciliation/:caseId/close',
        ]);
        assert.deepEqual(routes(unrecorded), []);
        assert.deepEqual(routes(withoutInvoicing(everythingOnOptions())), []);
    });
});

// @requirement SC-ADM-015 — The administration only offers what the application actually has
describe('the manifest', () => {
    test('announces the cases, their closing and the payments where they are served, and none where they are not', async () => {
        const capabilitiesOf = async (options) => {
            const moduleRef = await Test.createTestingModule({
                imports: [SaaSiCatModule.forRoot(bootable(options))],
            }).compile();
            try {
                const { capabilities } = await moduleRef.get(AdminManifestService).getManifest();
                return [
                    capabilities['reconciliation.read'],
                    capabilities['reconciliation.close'],
                    capabilities['payments.read'],
                ];
            } finally {
                await moduleRef.close();
            }
        };

        assert.deepEqual(await capabilitiesOf(everythingOnOptions([SignedInGuard])), [
            true,
            true,
            true,
        ]);
        assert.deepEqual(await capabilitiesOf(withoutInvoicing(everythingOnOptions())), [
            undefined,
            undefined,
            undefined,
        ]);
    });
});
