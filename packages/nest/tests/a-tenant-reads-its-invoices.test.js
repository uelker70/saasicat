// A tenant's users holding the billing permission read their subscription's
// invoices and contract confirmations, and download the archived documents.
// The subscriber is the one the session's tenant belongs to, every invoice of
// it is listed — an earlier tenant's joined into it included, read past the
// tenant policy — and a download of anybody else's is answered as one that
// does not exist.
//
// The store here keeps a tenant policy the way an installation with row-level
// security does: outside the bypass it answers only the rows of the tenant the
// request is for, so a read that forgets the bypass loses the earlier tenant's
// invoices exactly as it would in production.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
    BillingPermissionGuard,
    ComposedTenantAuthGuard,
    TenantInvoiceListQuery,
    TenantInvoiceService,
    TenantInvoicesController,
} from '../dist/billing/index.js';

const GUARDS = '__guards__';
const ROUTE_METHOD = 'method';

const MEIER = { id: 'subscriber-meier', legalName: 'Autohaus Meier GmbH' };
const SCHULZ = { id: 'subscriber-schulz', legalName: 'Schulz KG' };

/** An invoice of `subscriber`, issued for `tenantId` on day `day` of July. */
function invoiceOf(id, subscriber, tenantId, day, overrides = {}) {
    const date = `2026-07-${String(day).padStart(2, '0')}`;
    return {
        id,
        number: `R-${id}`,
        subscriberId: subscriber.id,
        tenantId,
        issuedAt: new Date(`${date}T05:15:00.000Z`),
        issueDate: date,
        dueDate: '2099-12-31',
        servicePeriodFrom: date,
        servicePeriodUntil: date,
        totalGross: 49,
        currency: 'EUR',
        issuer: { legalName: 'Systemhaus Nord GmbH' },
        correction: null,
        lines: [],
        ...overrides,
    };
}

/**
 * The tenants and their subscribers, the invoices, a store under a tenant
 * policy, the archived documents and the confirmations — and the service
 * reading them.
 */
function billingArea({
    invoices = [],
    contracts = {},
    bypass = true,
    credits = [],
    invoicing,
} = {}) {
    const state = { tenant: null, lifted: false, documents: [], confirmations: [] };
    const subscriberOf = { 'tenant-meier-2026': MEIER, 'tenant-schulz': SCHULZ };
    const visible = (invoice) => state.lifted || invoice.tenantId === state.tenant;
    const store = {
        listBySubscriber: async (subscriberId) =>
            invoices
                .filter((invoice) => invoice.subscriberId === subscriberId && visible(invoice))
                .sort((a, b) => b.issuedAt - a.issuedAt),
        findById: async (id) =>
            invoices.find((invoice) => invoice.id === id && visible(invoice)) ?? null,
        findByIds: async (ids) =>
            invoices.filter((invoice) => ids.includes(invoice.id) && visible(invoice)),
        listArchivedDocuments: async (ids) => ids.filter((id) => id !== 'not-archived'),
    };
    const subscribers = {
        findByTenantId: async (tenantId) => {
            state.tenant = tenantId;
            return subscriberOf[tenantId] ?? null;
        },
    };
    const documents = {
        documentOf: async (id) => {
            state.documents.push(id);
            return {
                content: new Uint8Array([1]),
                mediaType: 'application/pdf',
                fileName: `${id}.pdf`,
            };
        },
    };
    const confirmations = {
        contractsOf: async (subscriberId) => ({ contracts: contracts[subscriberId] ?? [] }),
        confirmationOf: async (id) => {
            state.confirmations.push(id);
            return {
                content: new Uint8Array([2]),
                mediaType: 'application/pdf',
                fileName: `${id}.pdf`,
            };
        },
    };
    const rlsBypass = bypass
        ? {
              runWithBypass: async (work) => {
                  state.lifted = true;
                  try {
                      return await work();
                  } finally {
                      state.lifted = false;
                  }
              },
          }
        : null;
    // Nothing settled against any invoice; the credits of each subscriber as given.
    const payments = {
        listSettlements: async () => [],
        listCredits: async (subscriberId) =>
            credits.filter(({ credit }) => credit.subscriberId === subscriberId),
    };
    const service = new TenantInvoiceService(
        subscribers,
        store,
        documents,
        payments,
        confirmations,
        rlsBypass,
        { timeZone: 'Europe/Berlin', invoicing },
    );
    return { service, state };
}

/** The coded refusal a request is answered with. */
const refusedAs = (status, code) => (error) => {
    assert.equal(error.getStatus(), status);
    assert.equal(error.getResponse().code, code);
    return true;
};

// @requirement SC-UI-023 — A tenant's invoices, payment method and billing details need the billing permission
// @requirement SC-SEC-004 — Every decision that matters is made where the request is served
test('every route of the invoices and confirmations is behind authentication and the permission, reading and paying included', () => {
    assert.deepEqual(Reflect.getMetadata(GUARDS, TenantInvoicesController), [
        ComposedTenantAuthGuard,
        BillingPermissionGuard,
    ]);
    const prototype = TenantInvoicesController.prototype;
    const handlers = Object.getOwnPropertyNames(prototype).filter(
        (name) => Reflect.getMetadata(ROUTE_METHOD, prototype[name]) !== undefined,
    );
    assert.deepEqual(handlers.sort(), [
        'account',
        'confirmationOf',
        'confirmations',
        'documentOf',
        'page',
        'pay',
    ]);
    for (const name of handlers) {
        assert.equal(
            Reflect.getMetadata(GUARDS, prototype[name]),
            undefined,
            `${name} replaces the class guards with its own`,
        );
    }
});

// @requirement SC-PRIC-097 — Every charge is invoiced once, and a tenant sees every invoice of its subscriber
// @requirement SC-SEC-018 — Reads that cross tenants are named, and a tenant's reaches only its own subscriber
describe("a tenant's invoices", () => {
    test('are its subscriber’s, the newest first, each as the list shows it', async () => {
        const { service } = billingArea({
            invoices: [
                invoiceOf('meier-1', MEIER, 'tenant-meier-2026', 1),
                invoiceOf('schulz-1', SCHULZ, 'tenant-schulz', 2),
                invoiceOf('meier-2', MEIER, 'tenant-meier-2026', 3),
            ],
        });

        const page = await service.page('tenant-meier-2026');

        assert.deepEqual(
            page.invoices.map((invoice) => invoice.id),
            ['meier-2', 'meier-1'],
        );
        assert.deepEqual(page.invoices[0], {
            id: 'meier-2',
            number: 'R-meier-2',
            issueDate: '2026-07-03',
            servicePeriod: { from: '2026-07-03', until: '2026-07-03' },
            dueDate: '2099-12-31',
            totalGross: 49,
            currency: 'EUR',
            issuer: { legalName: 'Systemhaus Nord GmbH' },
            correction: null,
            cancelledBy: null,
            replacedBy: null,
            payment: { kind: 'open', owed: 49, overdue: false },
            documentArchived: true,
        });
        assert.equal(page.next, null);
    });

    test('include those of an earlier tenant joined into the subscriber, read past the tenant policy', async () => {
        const { service } = billingArea({
            invoices: [
                invoiceOf('meier-2025', MEIER, 'tenant-meier-2025', 1),
                invoiceOf('meier-2026', MEIER, 'tenant-meier-2026', 2),
            ],
        });

        const page = await service.page('tenant-meier-2026');

        assert.deepEqual(
            page.invoices.map((invoice) => invoice.id),
            ['meier-2026', 'meier-2025'],
        );
    });

    test('come fifty a page, the next after the last of the one before', async () => {
        const invoices = Array.from({ length: 51 }, (_, index) =>
            invoiceOf(`meier-${index + 1}`, MEIER, 'tenant-meier-2026', 1, {
                issuedAt: new Date(Date.UTC(2026, 6, 1, 0, index)),
            }),
        );
        const { service } = billingArea({ invoices });

        const first = await service.page('tenant-meier-2026');
        const second = await service.page('tenant-meier-2026', first.next);

        assert.equal(first.invoices.length, 50);
        assert.equal(first.next, 'meier-2');
        assert.deepEqual(
            second.invoices.map((invoice) => invoice.id),
            ['meier-1'],
        );
        assert.equal(second.next, null);
    });

    test('after an invoice the subscriber does not have, are none rather than the first page again', async () => {
        const { service } = billingArea({
            invoices: [
                invoiceOf('meier-1', MEIER, 'tenant-meier-2026', 1),
                invoiceOf('schulz-1', SCHULZ, 'tenant-schulz', 2),
            ],
        });

        assert.deepEqual(await service.page('tenant-meier-2026', 'schulz-1'), {
            invoices: [],
            next: null,
        });
    });

    test('of a tenant without a subscriber are none', async () => {
        const { service } = billingArea({
            invoices: [invoiceOf('meier-1', MEIER, 'tenant-meier-2026', 1)],
        });

        assert.deepEqual(await service.page('tenant-new'), { invoices: [], next: null });
    });

    test('say which document is not archived yet, and list it all the same', async () => {
        const { service } = billingArea({
            invoices: [invoiceOf('not-archived', MEIER, 'tenant-meier-2026', 1)],
        });

        const [invoice] = (await service.page('tenant-meier-2026')).invoices;

        assert.equal(invoice.documentArchived, false);
    });
});

// @requirement SC-PRIC-049 — A subscriber's account is shown to the tenant's users holding the billing permission
describe("a tenant's account", () => {
    /** A credit of `subscriber` with `open` still to be paid out, from an overpayment. */
    const creditOf = (id, subscriber, open) => ({
        credit: {
            id,
            subscriberId: subscriber.id,
            currency: 'EUR',
            amount: open,
            origin: { kind: 'payment', paymentId: `payment-${id}` },
        },
        entries: [],
        open,
    });

    test('adds up what its subscriber’s invoices owe, of that what is overdue, and its credit beside it', async () => {
        const { service } = billingArea({
            invoices: [
                invoiceOf('meier-due', MEIER, 'tenant-meier-2026', 1, { dueDate: '2026-07-15' }),
                invoiceOf('meier-open', MEIER, 'tenant-meier-2026', 2, { totalGross: 20 }),
                invoiceOf('schulz', SCHULZ, 'tenant-schulz', 3),
            ],
            credits: [creditOf('meier', MEIER, 12), creditOf('schulz', SCHULZ, 99)],
        });

        assert.deepEqual((await service.accountOf('tenant-meier-2026')).balances, [
            { currency: 'EUR', owed: 69, overdue: 49, credit: 12 },
        ]);
    });

    test('counts an earlier tenant’s invoices joined into the subscriber, read past the tenant policy', async () => {
        const { service } = billingArea({
            invoices: [
                invoiceOf('meier-2025', MEIER, 'tenant-meier-2025', 1),
                invoiceOf('meier-2026', MEIER, 'tenant-meier-2026', 2),
            ],
        });

        const { balances } = await service.accountOf('tenant-meier-2026');

        assert.equal(balances[0].owed, 98);
    });

    test('of a tenant without a subscriber is empty', async () => {
        const { service } = billingArea({
            invoices: [invoiceOf('meier-1', MEIER, 'tenant-meier-2026', 1)],
        });

        assert.deepEqual((await service.accountOf('tenant-without-one')).balances, []);
    });

    test('is served for the tenant of the session, and a request that carries none is refused', async () => {
        const { service } = billingArea({
            invoices: [invoiceOf('meier-1', MEIER, 'tenant-meier-2026', 1)],
        });
        const controller = new TenantInvoicesController(service, null);

        const answer = await controller.account({ user: { tenantId: 'tenant-meier-2026' } });
        assert.deepEqual(answer.balances, [{ currency: 'EUR', owed: 49, overdue: 0, credit: 0 }]);
        await assert.rejects(
            async () => controller.account({ user: {} }),
            refusedAs(404, 'TENANT_CONTEXT_MISSING'),
        );
    });
});

// @requirement SC-ADM-053 — The operator sees every reason a tenant is held back for
describe('an invoice a reason names', () => {
    test('is named by its number and subscriber, read past the tenant policy, and one not found is left out', async () => {
        const { service } = billingArea({
            invoices: [invoiceOf('meier-2025', MEIER, 'tenant-meier-2025', 1)],
        });

        const named = await service.invoicesNamed(['meier-2025', 'no-such-invoice']);

        assert.deepEqual(named, [
            { id: 'meier-2025', number: 'R-meier-2025', subscriberId: MEIER.id },
        ]);
    });
});

// @requirement SC-PRIC-100 — A subscriber pays what is open now
describe('the day a direct debit paid now is collected on, beside the account', () => {
    // Half past midnight in Berlin on 10 November: the installation's day, not UTC's.
    const AFTER_MIDNIGHT_IN_BERLIN = new Date('2026-11-09T23:30:00.000Z');

    test('is the lead time the installation sets after its own today', async () => {
        const { service } = billingArea({ invoicing: { directDebitLeadDays: 2 } });

        const account = await service.accountOf('tenant-meier-2026', AFTER_MIDNIGHT_IN_BERLIN);

        assert.equal(account.directDebitCollectedOn, '2026-11-12');
    });

    test('is fourteen days after today where the installation sets no lead time', async () => {
        const { service } = billingArea();

        const account = await service.accountOf('tenant-meier-2026', AFTER_MIDNIGHT_IN_BERLIN);

        assert.equal(account.directDebitCollectedOn, '2026-11-24');
    });

    test('is answered for a tenant without a subscriber as well', async () => {
        const { service } = billingArea({ invoicing: { directDebitLeadDays: 2 } });

        const account = await service.accountOf('tenant-without-one', AFTER_MIDNIGHT_IN_BERLIN);

        assert.deepEqual(account, { balances: [], directDebitCollectedOn: '2026-11-12' });
    });
});

// @requirement SC-SEC-018 — Reads that cross tenants are named, and a tenant's reaches only its own subscriber
// @requirement SC-AUD-014 — An invoice downloaded later is the document that was issued, not a new rendering
describe("an invoice's document", () => {
    test('of the subscriber’s own invoice is the archived file', async () => {
        const { service, state } = billingArea({
            invoices: [invoiceOf('meier-1', MEIER, 'tenant-meier-2026', 1)],
        });

        const file = await service.documentOf('tenant-meier-2026', 'meier-1');

        assert.equal(file.fileName, 'meier-1.pdf');
        assert.deepEqual(state.documents, ['meier-1']);
    });

    test('of an earlier tenant joined into the subscriber is the archived file too', async () => {
        const { service, state } = billingArea({
            invoices: [invoiceOf('meier-2025', MEIER, 'tenant-meier-2025', 1)],
        });

        await service.documentOf('tenant-meier-2026', 'meier-2025');

        assert.deepEqual(state.documents, ['meier-2025']);
    });

    for (const [why, tenantId, invoiceId] of [
        ["of another subscriber's invoice", 'tenant-meier-2026', 'schulz-1'],
        ['of an invoice there is not', 'tenant-meier-2026', 'nothing'],
        ['for a tenant without a subscriber', 'tenant-new', 'meier-1'],
    ]) {
        test(`${why} is not found, and nothing is read from the archive`, async () => {
            const { service, state } = billingArea({
                invoices: [
                    invoiceOf('meier-1', MEIER, 'tenant-meier-2026', 1),
                    invoiceOf('schulz-1', SCHULZ, 'tenant-schulz', 2),
                ],
            });

            await assert.rejects(
                service.documentOf(tenantId, invoiceId),
                refusedAs(404, 'SUBSCRIPTION_INVOICE_NOT_FOUND'),
            );
            assert.deepEqual(state.documents, []);
        });
    }
});

// @requirement SC-SEC-018 — Reads that cross tenants are named, and a tenant's reaches only its own subscriber
describe("a tenant's contract confirmations", () => {
    const contractOf = (id, concludedAt, state, archivedAt = null) => ({
        id,
        concludedAt,
        firstDay: '2026-07-01',
        plan: { key: 'pro', title: 'Pro' },
        confirmation: { state, archivedAt, deliveredAt: null, deliveredTo: null },
    });
    const contracts = {
        [MEIER.id]: [
            contractOf(
                'meier-change',
                '2026-06-30T22:30:00.000Z',
                'sent',
                '2026-07-01T00:00:00.000Z',
            ),
            contractOf('meier-old', '2026-01-01T08:00:00.000Z', 'not-due'),
            contractOf('meier-new', '2026-07-02T08:00:00.000Z', 'being-made'),
        ],
        [SCHULZ.id]: [
            contractOf('schulz-1', '2026-07-01T08:00:00.000Z', 'sent', '2026-07-01T09:00:00.000Z'),
        ],
    };

    test('are those of its subscriber that are confirmed, with the installation’s day', async () => {
        const { service } = billingArea({ contracts });

        assert.deepEqual(await service.confirmationsOf('tenant-meier-2026'), {
            confirmations: [
                {
                    contractId: 'meier-change',
                    concludedOn: '2026-07-01',
                    firstDay: '2026-07-01',
                    planTitle: 'Pro',
                    archived: true,
                },
                {
                    contractId: 'meier-new',
                    concludedOn: '2026-07-02',
                    firstDay: '2026-07-01',
                    planTitle: 'Pro',
                    archived: false,
                },
            ],
        });
    });

    test('download as the archived file for the subscriber’s own contract', async () => {
        const { service, state } = billingArea({ contracts });

        await service.confirmationOf('tenant-meier-2026', 'meier-change');

        assert.deepEqual(state.confirmations, ['meier-change']);
    });

    test("of another subscriber's contract is not found, and nothing is read from the archive", async () => {
        const { service, state } = billingArea({ contracts });

        await assert.rejects(
            service.confirmationOf('tenant-meier-2026', 'schulz-1'),
            refusedAs(404, 'SUBSCRIPTION_CONTRACT_NOT_FOUND'),
        );
        assert.deepEqual(state.confirmations, []);
    });
});

// @requirement SC-SEC-018 — Reads that cross tenants are named, and a tenant's reaches only its own subscriber
describe('the routes', () => {
    test('serve the tenant of the session, and refuse a request that carries none', async () => {
        const { service } = billingArea({
            invoices: [invoiceOf('meier-1', MEIER, 'tenant-meier-2026', 1)],
        });
        const controller = new TenantInvoicesController(service, null);

        const page = await controller.page({ user: { tenantId: 'tenant-meier-2026' } }, {});
        assert.deepEqual(
            page.invoices.map((invoice) => invoice.id),
            ['meier-1'],
        );
        await assert.rejects(
            async () => controller.page({ user: {} }, {}),
            refusedAs(404, 'TENANT_CONTEXT_MISSING'),
        );
    });

    test('hand a document out as an attachment under its archived name', async () => {
        const { service } = billingArea({
            invoices: [invoiceOf('meier-1', MEIER, 'tenant-meier-2026', 1)],
        });
        const controller = new TenantInvoicesController(service, () => 'tenant-meier-2026');

        const file = await controller.documentOf({}, 'meier-1');

        assert.equal(file.getHeaders().disposition, 'attachment; filename="meier-1.pdf"');
    });

    test('take an invoice to page after only as an id of bounded length', async () => {
        const errors = await validate(
            plainToInstance(TenantInvoiceListQuery, { after: 'x'.repeat(201) }),
        );
        assert.equal(errors.length, 1);
        assert.deepEqual(
            await validate(plainToInstance(TenantInvoiceListQuery, { after: 'meier-1' })),
            [],
        );
    });
});
