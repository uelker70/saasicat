// The operator reads the open items of the installation: the invoices that
// still owe something, the oldest due date first, with how many days each is
// overdue, how it is paid and its latest collection attempt; the credits the
// operator still owes, with the subscriber its record names; and what both add
// up to. The service is given the stores as the platform gives them, so what is
// asserted is what the routes serve.

// @requirement SC-ADM-044 — An operator lists what subscribers still owe and are still owed, across every tenant

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OPEN_ITEMS_PAGE_SIZE } from '@saasicat/core';

import {
    OpenCreditsQueryDto,
    OpenInvoicesQueryDto,
    OpenItemsModule,
    OpenItemsService,
} from '../dist/billing/index.js';
import { AdminManifestService, SaaSiCatModule } from '../dist/platform/index.js';
import {
    SignedInGuard,
    bootable,
    controllersIn,
    everythingOnOptions,
    handlersOf,
    withoutInvoicing,
} from './helpers/operator-routes.js';
import { MemorySubscriberPayments } from './helpers/subscriber-payments.js';

const PAID = new Date('2026-02-01T05:30:00.000Z');
/** Half past midnight on 17 February in Berlin, still the 16th in UTC. */
const NOW = new Date('2026-02-16T23:30:00.000Z');
const SETTINGS = { timeZone: 'Europe/Berlin' };
const DEBIT = {
    paymentMethodId: 'pm-debit',
    gatewayAccount: 'stripe-main',
    type: 'sepa_debit',
    brand: null,
    last4: '3000',
    mandateReference: 'M-1',
};

let issued = 0;
/** An invoice of `subscriberId` totalling `totalGross`, due on `dueDate`. */
function invoiceOf(subscriberId, totalGross, dueDate, payment = null) {
    issued += 1;
    return {
        id: `invoice-${String(issued).padStart(3, '0')}`,
        number: `AHP-2026-${String(issued).padStart(6, '0')}`,
        numberYear: 2026,
        numberSequence: issued,
        subscriberId,
        tenantId: `tenant-of-${subscriberId}`,
        subscriber: {
            customerNumber: `K-${subscriberId.slice(-1)}`,
            legalName: `As invoiced ${subscriberId}`,
        },
        totalGross,
        currency: 'EUR',
        issuedAt: new Date('2026-02-01T05:15:00.000Z'),
        issueDate: '2026-02-01',
        dueDate,
        payment,
    };
}

/**
 * The stores the service reads, with `invoices` issued and nothing paid yet.
 * Each read records whether it ran inside the bypass frame.
 */
function anInstallation(invoices, attempts = []) {
    const payments = new MemorySubscriberPayments(invoices);
    const reads = [];
    let bypassed = 0;
    const recorded =
        (name, read) =>
        (...args) => {
            reads.push({ name, bypassed: bypassed > 0 });
            return read(...args);
        };
    const store = {
        findByIds: recorded('invoices', async (ids) =>
            invoices.filter((each) => ids.includes(each.id)),
        ),
    };
    const collections = {
        listByInvoices: recorded('attempts', async (ids) =>
            attempts.filter((each) => ids.includes(each.invoiceId)),
        ),
    };
    const subscribers = {
        findByIds: recorded('subscribers', async (ids) =>
            ids.map((id) => ({
                id,
                customerNumber: `K-${id.slice(-1)}`,
                legalName: `Record of ${id}`,
            })),
        ),
    };
    const bypass = {
        async runWithBypass(fn) {
            bypassed += 1;
            try {
                return await fn();
            } finally {
                bypassed -= 1;
            }
        },
    };
    const reading = {
        listOpenInvoices: recorded('open invoices', (page) => payments.listOpenInvoices(page)),
        listOpenCredits: recorded('open credits', (page) => payments.listOpenCredits(page)),
        openItemTotals: recorded('totals', (today) => payments.openItemTotals(today)),
    };
    const service = new OpenItemsService(
        reading,
        store,
        collections,
        subscribers,
        SETTINGS,
        bypass,
    );
    /** Records a payment of `amount` against `invoice`, `minutes` after `PAID`. */
    const pay = (invoice, amount, minutes = 0) =>
        payments.recordPayment({
            invoiceId: invoice.id,
            collectionId: `attempt-${invoice.id}`,
            gatewayAccount: 'stripe-main',
            provider: 'stripe',
            gatewayRef: `pi_${invoice.id}_${minutes}`,
            amount,
            currency: 'EUR',
            at: new Date(PAID.getTime() + minutes * 60_000),
        });
    return { service, payments, reads, pay };
}

const attemptOf = (invoiceId, attempt, status, failureReason = null) => ({
    id: `${invoiceId}-attempt-${attempt}`,
    invoiceId,
    attempt,
    status,
    failureReason,
    submittedAt: new Date(`2026-02-1${attempt}T06:00:00.000Z`),
});

describe('the open invoices', () => {
    test('are those that still owe, the oldest due date first, with what each owes and how many days it is overdue in the installation’s zone', async () => {
        const later = invoiceOf('subscriber-1', 119, '2026-02-20');
        const due = invoiceOf('subscriber-2', 119, '2026-02-15', DEBIT);
        const today = invoiceOf('subscriber-1', 59.5, '2026-02-17');
        const paid = invoiceOf('subscriber-1', 119, '2026-02-10');
        const { service, pay } = anInstallation([later, due, today, paid]);
        await pay(due, 19);
        await pay(paid, 119);

        const page = await service.invoicesPage({}, NOW);

        assert.deepEqual([page.today, page.overdueOnly, page.next], ['2026-02-17', false, null]);
        assert.deepEqual(
            page.invoices.map((row) => [row.number, row.dueDate, row.owed, row.daysOverdue]),
            [
                [due.number, '2026-02-15', 100, 2],
                [today.number, '2026-02-17', 59.5, 0],
                [later.number, '2026-02-20', 119, 0],
            ],
        );
        assert.deepEqual(page.invoices[0].subscriber, {
            id: 'subscriber-2',
            customerNumber: 'K-2',
            legalName: 'As invoiced subscriber-2',
        });
    });

    test('say how each is paid and how its latest collection attempt ended', async () => {
        const debit = invoiceOf('subscriber-1', 119, '2026-02-15', DEBIT);
        const transfer = invoiceOf('subscriber-1', 119, '2026-02-16');
        const { service } = anInstallation(
            [debit, transfer],
            [
                attemptOf(debit.id, 2, 'FAILED', 'insufficient-funds'),
                attemptOf(debit.id, 1, 'FAILED', 'declined'),
            ],
        );

        const [first, second] = (await service.invoicesPage({}, NOW)).invoices;

        assert.deepEqual(
            [first.payment, first.lastAttempt],
            [
                { type: 'sepa_debit', last4: '3000' },
                {
                    status: 'FAILED',
                    submittedAt: '2026-02-12T06:00:00.000Z',
                    failureReason: 'insufficient-funds',
                },
            ],
        );
        assert.deepEqual([second.payment, second.lastAttempt], [null, null]);
    });

    test('overdue alone, are those due before today, today not among them', async () => {
        const yesterday = invoiceOf('subscriber-1', 119, '2026-02-16');
        const today = invoiceOf('subscriber-1', 119, '2026-02-17');
        const { service } = anInstallation([yesterday, today]);

        const page = await service.invoicesPage({ overdue: true }, NOW);

        assert.equal(page.overdueOnly, true);
        assert.deepEqual(
            page.invoices.map((row) => row.number),
            [yesterday.number],
        );
    });

    test(`are read ${OPEN_ITEMS_PAGE_SIZE} to a page, the next one named by the last on it`, async () => {
        const invoices = Array.from({ length: OPEN_ITEMS_PAGE_SIZE + 1 }, (_, day) =>
            invoiceOf(
                'subscriber-1',
                10,
                `2026-0${1 + Math.floor(day / 28)}-${String((day % 28) + 1).padStart(2, '0')}`,
            ),
        );
        const { service } = anInstallation(invoices);

        const first = await service.invoicesPage({}, NOW);
        const second = await service.invoicesPage({ after: first.next }, NOW);

        assert.equal(first.invoices.length, OPEN_ITEMS_PAGE_SIZE);
        assert.equal(first.next, first.invoices[OPEN_ITEMS_PAGE_SIZE - 1].id);
        assert.deepEqual([second.invoices.length, second.next], [1, null]);
    });
});

describe('the open credits', () => {
    test('are those the operator still owes, the oldest first, each with its subscriber as the record names it now', async () => {
        const first = invoiceOf('subscriber-1', 100, '2026-02-10');
        const second = invoiceOf('subscriber-2', 100, '2026-02-11');
        const { service, payments, pay } = anInstallation([first, second]);
        const { credit: earlier } = await pay(first, 130, 1);
        await pay(second, 105, 2);
        await payments.recordPayout({
            creditId: earlier.id,
            amount: 10,
            reference: 'TRF-1',
            paidOn: '2026-02-12',
            note: null,
            recordedBy: 'operator-1',
            at: PAID,
        });

        const page = await service.creditsPage({});

        assert.deepEqual(
            page.credits.map((row) => [row.subscriber.legalName, row.origin, row.amount, row.open]),
            [
                ['Record of subscriber-1', 'payment', 30, 20],
                ['Record of subscriber-2', 'payment', 5, 5],
            ],
        );
        assert.deepEqual([page.next, page.timeZone], [null, 'Europe/Berlin']);
    });
});

describe('the totals of the open items', () => {
    test('add up what is owed per currency, what is overdue today apart, and what the credits hold', async () => {
        const overdue = invoiceOf('subscriber-1', 119, '2026-02-15');
        const notYet = invoiceOf('subscriber-1', 59.5, '2026-02-17');
        const overpaid = invoiceOf('subscriber-2', 100, '2026-02-10');
        const { service, pay } = anInstallation([overdue, notYet, overpaid]);
        await pay(overpaid, 112.5);

        assert.deepEqual(await service.totals(NOW), {
            today: '2026-02-17',
            invoices: [{ currency: 'EUR', owed: 178.5, overdue: 119 }],
            credits: [{ currency: 'EUR', open: 12.5 }],
        });
    });
});

// @requirement SC-SEC-015 — An operator's route runs across tenants, and no other route does
describe('every read of the open items', () => {
    test("runs outside the tenants' row-level policy, a page in a few reads", async () => {
        const invoice = invoiceOf('subscriber-1', 100, '2026-02-10');
        const { service, reads, pay } = anInstallation([invoice]);
        await pay(invoice, 150);

        await service.invoicesPage({}, NOW);
        await service.creditsPage({});
        await service.totals(NOW);

        assert.deepEqual(
            reads.map(({ name }) => name),
            ['open invoices', 'invoices', 'attempts', 'open credits', 'subscribers', 'totals'],
        );
        assert.ok(reads.every(({ bypassed }) => bypassed));
    });
});

describe('an open item the store lists and cannot read', () => {
    /** The service over `payments`, its other stores answering nothing. */
    const readingNothingBut = (payments) =>
        new OpenItemsService(
            payments,
            { findByIds: async () => [] },
            { listByInvoices: async () => [] },
            { findByIds: async () => [] },
            SETTINGS,
            null,
        );

    test('fails the page of invoices rather than leaving the invoice off it', async () => {
        const invoice = invoiceOf('subscriber-1', 100, '2026-02-10');
        const { payments } = anInstallation([invoice]);

        await assert.rejects(readingNothingBut(payments).invoicesPage({}, NOW), {
            message: `The store lists invoice ${invoice.id} as open and cannot read it.`,
        });
    });

    test('fails the page of credits rather than leaving the credit off it', async () => {
        const invoice = invoiceOf('subscriber-1', 100, '2026-02-10');
        const { payments, pay } = anInstallation([invoice]);
        await pay(invoice, 150);
        const [{ credit }] = (await payments.listOpenCredits({ limit: 1 })).credits;

        await assert.rejects(readingNothingBut(payments).creditsPage({}), {
            message: `The store lists credit ${credit.id} as open and cannot read its subscriber subscriber-1.`,
        });
    });
});

describe('the requests as the routes take them', () => {
    const problemsOf = async (Type, query) =>
        (await validate(plainToInstance(Type, query))).map((error) => error.property);

    test('overdue alone is true or false, and a page goes on after an id of a length one can have', async () => {
        for (const overdue of ['true', 'false', true, false]) {
            assert.deepEqual(await problemsOf(OpenInvoicesQueryDto, { overdue }), []);
        }
        assert.deepEqual(await problemsOf(OpenInvoicesQueryDto, { overdue: 'yes' }), ['overdue']);
        assert.deepEqual(await problemsOf(OpenCreditsQueryDto, { after: 'x'.repeat(200) }), []);
        assert.deepEqual(await problemsOf(OpenCreditsQueryDto, { after: 'x'.repeat(201) }), [
            'after',
        ]);
    });

    test('a query string’s text asks for overdue ones alone only where it says true', async () => {
        const asked = [];
        const [Controller] = OpenItemsModule.forRoot({ guards: [], imports: [] }).controllers;
        const controller = new Controller(
            { invoicesPage: async (query) => asked.push(query) },
            { runWithBypass: (fn) => fn() },
        );

        for (const overdue of ['true', true, 'false', undefined])
            await controller.invoices({ overdue });

        assert.deepEqual(
            asked.map(({ overdue }) => overdue),
            [true, true, false, false],
        );
    });
});

// @requirement SC-ADM-015 — The administration only offers what the application actually has
describe('where the open items are served', () => {
    const ROUTES = ['GET admin/open-credits', 'GET admin/open-item-totals', 'GET admin/open-items'];
    const routes = (options) =>
        controllersIn(SaaSiCatModule.forRoot(options))
            .flatMap(handlersOf)
            .map((handler) => handler.route)
            .filter((route) => route.includes('/open-'))
            .sort();

    test('beside the credits and the cases to reconcile, and nowhere what collections bring is not recorded', () => {
        const unrecorded = everythingOnOptions([SignedInGuard]);
        unrecorded.tenantBilling.chargeJournal.invoices.payments = undefined;

        assert.deepEqual(routes(everythingOnOptions([SignedInGuard])), ROUTES);
        assert.deepEqual(routes(unrecorded), []);
        assert.deepEqual(routes(withoutInvoicing(everythingOnOptions())), []);
    });

    test('its page announced under payments.read where they are served', async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [SaaSiCatModule.forRoot(bootable(everythingOnOptions([SignedInGuard])))],
        }).compile();
        try {
            const manifest = await moduleRef.get(AdminManifestService).getManifest();
            assert.equal(manifest.capabilities['payments.read'], true);
            assert.deepEqual(manifest.navigation.standardPages.openItems, {
                enabled: true,
                requiredCapability: 'payments.read',
            });
        } finally {
            await moduleRef.close();
        }
    });
});
