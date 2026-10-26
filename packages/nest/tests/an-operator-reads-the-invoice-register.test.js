// The operator reads the register of every invoice the installation issued:
// a page of a span of months by issue date and number, each invoice with the
// subscriber it names, whether its document is archived and what cancelled
// it, and what the months add up to. Asked through the platform as an
// application composes it, so what is asserted is what the route serves, in
// the frame it runs in.

// @requirement SC-ADM-042 — An operator lists the invoices of chosen months, summed per tax treatment and rate

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import 'reflect-metadata';
import { BadRequestException, UnprocessableEntityException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
    INVOICE_ERROR_CODES,
    INVOICE_REGISTER_PAGE_SIZE,
    dayInZone,
    draftCancellationInvoice,
    sumToCents,
} from '@saasicat/core';

import { AdminManifestService, SaaSiCatModule } from '../dist/platform/index.js';
import { ISSUER, anInvoicingInstallation } from './helpers/invoice-run.js';
import { invoicingPlatform, wiredInvoices } from './helpers/invoicing-platform.js';
import { controllersIn, handlersOf } from './helpers/operator-routes.js';

const PAGE_ROUTE = 'GET admin/invoices';
const TOTALS_ROUTE = 'GET admin/invoice-totals';
const ZONE = 'Europe/Berlin';
const STANDARD = {
    kind: 'standard',
    rate: 19,
    note: null,
    adapter: { name: 'test-tax', version: '1' },
};

/** The subscriber each tenant's invoices name. */
const PARTIES = {
    t1: { subscriberId: 's1', legalName: 'Northwind GmbH', customerNumber: 'K-10001' },
    t2: { subscriberId: 's2', legalName: 'Fabrikam GmbH', customerNumber: 'K-10002' },
};

/** An invoice store holding the invoices a test issues, each on a charge of its own. */
function anInstallation() {
    const { store } = anInvoicingInstallation();
    let charges = 0;
    return {
        store,
        /** Issues an invoice of `tenantId` dated `issueDate`, 100.00 net at 19 % unless `taxes` says otherwise. */
        issue(issueDate, { tenantId = 't1', taxes = [{ rate: 19, net: 100, tax: 19 }] } = {}) {
            const party = PARTIES[tenantId];
            const net = sumToCents(...taxes.map((each) => each.net));
            const tax = sumToCents(...taxes.map((each) => each.tax));
            charges += 1;
            return store.issue({
                numberPrefix: 'AHP',
                numberYear: Number(issueDate.slice(0, 4)),
                tenantId,
                subscriberId: party.subscriberId,
                subscriptionId: `subscription-${tenantId}`,
                contractId: `contract-${tenantId}`,
                issuedAt: new Date(`${issueDate}T09:00:00.000Z`),
                issueDate,
                dueDate: issueDate,
                payment: null,
                collectionDate: null,
                servicePeriodFrom: issueDate,
                servicePeriodUntil: issueDate,
                currency: 'EUR',
                issuer: ISSUER,
                subscriber: {
                    legalName: party.legalName,
                    customerNumber: party.customerNumber,
                    vatId: null,
                    taxNumber: null,
                    addressLine1: 'Hafenstraße 1',
                    addressLine2: null,
                    postalCode: '20457',
                    city: 'Hamburg',
                    country: 'DE',
                },
                footer: [],
                taxTreatment: STANDARD,
                taxes,
                totalNet: net,
                totalTax: tax,
                totalGross: sumToCents(net, tax),
                lines: [
                    {
                        position: 1,
                        chargeId: `charge-${charges}`,
                        contractLineItemId: `line-${tenantId}`,
                        title: 'Standard, monthly',
                        origin: 'period',
                        source: 'plan',
                        periodFrom: issueDate,
                        periodUntil: issueDate,
                        amountNet: net,
                        taxRate: 19,
                    },
                ],
            });
        },
        /** Cancels `invoice` on `day` by a cancellation invoice, and no replacement. */
        async cancel(invoice, day) {
            const issue = {
                issuedAt: new Date(`${day}T09:00:00.000Z`),
                timeZone: ZONE,
                numberPrefix: 'AHP',
            };
            const { cancellationInvoice } = await store.issueCancellation({
                cancelledInvoiceId: invoice.id,
                cancellation: draftCancellationInvoice(invoice, issue),
                replacement: null,
                reason: 'The billing address was wrong.',
                correctedSubscriber: null,
                deliverTo: null,
                cancelledBy: 'operator-1',
                cancelledAt: issue.issuedAt,
            });
            return cancellationInvoice;
        },
        /** Archives `invoice`'s document, as the run does once the archive confirmed it. */
        async archive(invoice) {
            await store.recordRendering(invoice.id, {
                checksum: 'c'.repeat(64),
                mediaType: 'application/pdf',
                fileName: `${invoice.number}.pdf`,
                size: 1,
                renderedAt: invoice.issuedAt,
            });
            await store.markArchived(invoice.id, invoice.issuedAt, 'c'.repeat(64));
        },
    };
}

/**
 * The platform serving `installation`'s invoices, each read of them recorded
 * with whether it ran inside the bypass frame. `through` binds the bypass the
 * way an adapter without row-level policies does: it calls `fn` and hands back
 * what it returns, as it returns it.
 */
async function aPlatform(installation, options = {}, { through = false } = {}) {
    const reads = [];
    let bypassed = 0;
    const { store } = installation;
    const recorded = (name) => {
        const read = store[name].bind(store);
        return (...args) => {
            reads.push({ name, bypassed: bypassed > 0 });
            return read(...args);
        };
    };
    const repository = {
        ...store,
        listIssued: recorded('listIssued'),
        listIssuedAmounts: recorded('listIssuedAmounts'),
        listArchivedDocuments: recorded('listArchivedDocuments'),
    };
    const platform = invoicingPlatform({
        invoices: wiredInvoices({ invoiceRepository: repository }),
    });
    platform.persistence.core.rlsBypass = through
        ? { runWithBypass: (fn) => fn() }
        : {
              async runWithBypass(fn) {
                  bypassed += 1;
                  try {
                      return await fn();
                  } finally {
                      bypassed -= 1;
                  }
              },
          };
    const root = SaaSiCatModule.forRoot({ ...platform, ...options });
    const moduleRef = await Test.createTestingModule({ imports: [root] }).compile();
    await moduleRef.init();
    const handlers = controllersIn(root).flatMap(handlersOf);
    const served = (route) => handlers.find((handler) => handler.route === route);
    const call = (route) => {
        const handler = served(route);
        return (query = {}) =>
            moduleRef.get(handler.controller, { strict: false })[handler.name](query);
    };
    return { moduleRef, reads, served, page: call(PAGE_ROUTE), totals: call(TOTALS_ROUTE) };
}

const numbersOf = (page) => page.invoices.map((row) => row.number);

describe('a page of the register', () => {
    test('is every invoice of the months asked for, whichever tenant it was for, by issue date and then number', async () => {
        const installation = anInstallation();
        const late = await installation.issue('2026-02-28');
        const early = await installation.issue('2026-02-01', { tenantId: 't2' });
        await installation.issue('2026-01-31');
        await installation.issue('2026-03-01');
        const platform = await aPlatform(installation);

        const page = await platform.page({ from: '2026-02', until: '2026-02' });

        assert.deepEqual([page.from, page.until, page.next], ['2026-02', '2026-02', null]);
        assert.deepEqual(numbersOf(page), [early.number, late.number]);
        await platform.moduleRef.close();
    });

    test('names each invoice’s subscriber as it names itself, the way into its record, and its amounts', async () => {
        const installation = anInstallation();
        const invoice = await installation.issue('2026-02-10', { tenantId: 't2' });
        const platform = await aPlatform(installation);

        const [row] = (await platform.page({ from: '2026-02' })).invoices;

        assert.deepEqual(row, {
            id: invoice.id,
            number: invoice.number,
            issueDate: '2026-02-10',
            correction: null,
            subscriber: { id: 's2', customerNumber: 'K-10002', legalName: 'Fabrikam GmbH' },
            tenantId: 't2',
            currency: 'EUR',
            totalNet: 100,
            totalTax: 19,
            totalGross: 119,
            documentArchived: false,
            cancelledBy: null,
        });
        await platform.moduleRef.close();
    });

    test('says whose document is archived, and which cancellation invoice cancelled an invoice, however much later', async () => {
        const installation = anInstallation();
        const cancelled = await installation.issue('2026-02-10');
        const archived = await installation.issue('2026-02-11');
        await installation.archive(cancelled);
        await installation.archive(archived);
        const cancellation = await installation.cancel(cancelled, '2026-04-02');
        const platform = await aPlatform(installation);

        const february = await platform.page({ from: '2026-02' });
        const april = await platform.page({ from: '2026-04' });

        assert.deepEqual(
            february.invoices.map((row) => [row.number, row.documentArchived, row.cancelledBy]),
            [
                [
                    cancelled.number,
                    true,
                    { invoiceId: cancellation.id, number: cancellation.number },
                ],
                [archived.number, true, null],
            ],
        );
        assert.deepEqual(
            april.invoices.map((row) => [row.number, row.correction, row.documentArchived]),
            [
                [
                    cancellation.number,
                    {
                        kind: 'cancellation',
                        of: {
                            invoiceId: cancelled.id,
                            number: cancelled.number,
                            issueDate: '2026-02-10',
                        },
                    },
                    false,
                ],
            ],
        );
        await platform.moduleRef.close();
    });

    test(`holds ${INVOICE_REGISTER_PAGE_SIZE} invoices, and the next one continues after its last`, async () => {
        const installation = anInstallation();
        for (let day = 0; day <= INVOICE_REGISTER_PAGE_SIZE; day += 1) {
            await installation.issue(
                `2026-0${1 + Math.floor(day / 28)}-${String((day % 28) + 1).padStart(2, '0')}`,
            );
        }
        const platform = await aPlatform(installation);

        const first = await platform.page({ from: '2026-01', until: '2026-02' });
        const second = await platform.page({
            from: '2026-01',
            until: '2026-02',
            after: first.next,
        });

        assert.equal(first.invoices.length, INVOICE_REGISTER_PAGE_SIZE);
        assert.equal(first.next, first.invoices.at(-1).id);
        assert.equal(second.invoices.length, 1);
        assert.equal(second.next, null);
        await platform.moduleRef.close();
    });

    test('is the current month in the installation’s zone where no month is asked for', async () => {
        const installation = anInstallation();
        const platform = await aPlatform(installation);

        const before = dayInZone(new Date(), ZONE).slice(0, 7);
        const page = await platform.page();
        const after = dayInZone(new Date(), ZONE).slice(0, 7);

        // Read on either side of the call, so a month that turns during it
        // does not turn the test.
        assert.ok([before, after].includes(page.from), `${page.from} is not ${before}`);
        assert.equal(page.until, page.from);
        await platform.moduleRef.close();
    });

    // @requirement SC-SEC-015 — An operator's route runs across tenants, and no other route does
    test("is read outside the tenants' row-level policy", async () => {
        const installation = anInstallation();
        await installation.issue('2026-02-10');
        const platform = await aPlatform(installation);

        await platform.page({ from: '2026-02' });
        await platform.totals({ from: '2026-02' });

        assert.deepEqual(platform.reads.map(({ name }) => name).sort(), [
            'listArchivedDocuments',
            'listIssued',
            'listIssuedAmounts',
        ]);
        assert.ok(platform.reads.every(({ bypassed }) => bypassed));
        await platform.moduleRef.close();
    });
});

describe('the totals of the register', () => {
    test('are the months asked for, per rate, a cancellation taking off in its own month', async () => {
        const installation = anInstallation();
        const january = await installation.issue('2026-01-20');
        await installation.issue('2026-02-03', {
            tenantId: 't2',
            taxes: [
                { rate: 7, net: 10, tax: 0.7 },
                { rate: 19, net: 50, tax: 9.5 },
            ],
        });
        await installation.cancel(january, '2026-02-04');
        const platform = await aPlatform(installation);

        const totals = await platform.totals({ from: '2026-01', until: '2026-03' });

        const of = (rate, net, tax, gross) => ({
            currency: 'EUR',
            kind: 'standard',
            rate,
            net,
            tax,
            gross,
        });
        assert.deepEqual(totals, {
            from: '2026-01',
            until: '2026-03',
            months: [
                { month: '2026-01', totals: [of(19, 100, 19, 119)] },
                { month: '2026-02', totals: [of(7, 10, 0.7, 10.7), of(19, -50, -9.5, -59.5)] },
                { month: '2026-03', totals: [] },
            ],
            range: [of(7, 10, 0.7, 10.7), of(19, 50, 9.5, 59.5)],
        });
        await platform.moduleRef.close();
    });
});

describe('the months the register refuses', () => {
    for (const [why, query, code] of [
        [
            'until before from',
            { from: '2026-03', until: '2026-02' },
            INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_REGISTER_RANGE_REVERSED,
        ],
        [
            'more than a year',
            { from: '2026-01', until: '2027-01' },
            INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_REGISTER_RANGE_TOO_LONG,
        ],
    ]) {
        test(`${why}, with its code and no read, for the page and the totals`, async () => {
            // A bypass that calls through hands the route's answer back as it
            // is, so a refusal thrown rather than rejected would escape here.
            const platform = await aPlatform(anInstallation(), {}, { through: true });

            for (const read of [platform.page, platform.totals]) {
                await assert.rejects(read(query), (error) => {
                    assert.ok(error instanceof UnprocessableEntityException);
                    assert.equal(error.getResponse().code, code);
                    return true;
                });
            }
            assert.deepEqual(platform.reads, []);
            await platform.moduleRef.close();
        });
    }
});

/** A query, as the application's global `ValidationPipe` hands it to `route`. */
async function throughThePipe(route, query) {
    const platform = await aPlatform(anInstallation());
    const served = platform.served(route);
    const [metatype] = Reflect.getMetadata(
        'design:paramtypes',
        served.controller.prototype,
        served.name,
    );
    await platform.moduleRef.close();
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    return pipe.transform(query, { type: 'query', metatype });
}

describe('what the register takes', () => {
    test('two months and an invoice to continue after, and nothing else', async () => {
        const taken = await throughThePipe(PAGE_ROUTE, {
            from: '2026-01',
            until: '2026-12',
            after: 'x'.repeat(200),
            tenant: 't1',
        });

        assert.deepEqual(
            { ...taken },
            { from: '2026-01', until: '2026-12', after: 'x'.repeat(200) },
        );
    });

    for (const [route, why, query] of [
        [PAGE_ROUTE, 'a thirteenth month', { from: '2026-13' }],
        [PAGE_ROUTE, 'a month of one digit', { until: '2026-1' }],
        [PAGE_ROUTE, 'a day for a month', { from: '2026-01-01' }],
        [PAGE_ROUTE, 'a page after an id longer than any', { after: 'x'.repeat(201) }],
        [TOTALS_ROUTE, 'a year below 1000', { from: '0999-12' }],
        [TOTALS_ROUTE, 'a month followed by a line break', { until: '2026-01\n' }],
    ]) {
        test(`refuses ${why} at ${route}`, async () => {
            await assert.rejects(throughThePipe(route, query), BadRequestException);
        });
    }
});

// @requirement SC-ADM-015 — The administration only offers what the application actually has
describe('where the register is served', () => {
    const REGISTER_ROUTES = [PAGE_ROUTE, TOTALS_ROUTE];
    const servedBy = (options) =>
        controllersIn(SaaSiCatModule.forRoot(options))
            .flatMap(handlersOf)
            .map((handler) => handler.route)
            .filter((route) => REGISTER_ROUTES.includes(route))
            .sort();

    test('beside the invoices’ documents, its page announced under invoices.read', async () => {
        const root = SaaSiCatModule.forRoot(invoicingPlatform());
        const moduleRef = await Test.createTestingModule({ imports: [root] }).compile();
        try {
            const manifest = await moduleRef.get(AdminManifestService).getManifest();

            assert.deepEqual(servedBy(invoicingPlatform()), [...REGISTER_ROUTES].sort());
            assert.equal(manifest.capabilities['invoices.read'], true);
            assert.deepEqual(manifest.navigation.standardPages.invoices, {
                enabled: true,
                requiredCapability: 'invoices.read',
            });
        } finally {
            await moduleRef.close();
        }
    });

    test('nowhere the administration shows no tenants, or no invoices are issued', () => {
        assert.deepEqual(servedBy({ ...invoicingPlatform(), adminResources: false }), []);
        assert.deepEqual(servedBy(invoicingPlatform({ invoices: null })), []);
    });
});
