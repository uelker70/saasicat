// An installation that issues invoices for two tenants, each to a subscriber of
// its own, on the days a test names — what the operator's register and its
// export read.

import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { draftCancellationInvoice, sumToCents } from '@saasicat/core';

import { SaaSiCatModule } from '../../dist/platform/index.js';
import { ISSUER, anInvoicingInstallation } from './invoice-run.js';
import { invoicingPlatform, wiredInvoices } from './invoicing-platform.js';
import { controllersIn, handlersOf } from './operator-routes.js';

export const ZONE = 'Europe/Berlin';
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
export function anInstallation() {
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
 * The platform serving `installation`'s invoices, and `payments` where given as
 * what the collections recorded, each of the `reads` recorded with whether it
 * ran inside the bypass frame, and each audit entry written into `written`. `through` binds the bypass the way an adapter
 * without row-level policies does: it calls `fn` and hands back what it
 * returns, as it returns it. `call(route)` answers a route's handler, called
 * with what a test passes it.
 */
export async function aRegisterPlatform(
    installation,
    { options = {}, through = false, reads: named = [], payments = null, written = null } = {},
) {
    const reads = [];
    let bypassed = 0;
    // Every method answered by the port itself, so one of a class keeps its private fields.
    const recording = (port) =>
        new Proxy(port, {
            get(target, key) {
                const value = target[key];
                if (typeof value !== 'function') return value;
                const read = value.bind(target);
                if (!named.includes(key)) return read;
                return (...args) => {
                    reads.push({ name: key, bypassed: bypassed > 0 });
                    return read(...args);
                };
            },
        });
    const { store } = installation;
    const platform = invoicingPlatform({
        invoices: wiredInvoices({ invoiceRepository: recording(store) }),
    });
    if (written) platform.persistence.core.audit = { write: async (entry) => written.push(entry) };
    if (payments) {
        platform.persistence.entitlement.subscriberPaymentRepository = recording(payments);
    }
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
    const call =
        (route) =>
        (...args) => {
            const handler = served(route);
            const controller = moduleRef.get(handler.controller, { strict: false });
            return controller[handler.name](...(args.length === 0 ? [{}] : args));
        };
    return { moduleRef, reads, served, call };
}

/** A query, as the application's global `ValidationPipe` hands it to `route`. */
export async function throughThePipe(route, query) {
    const platform = await aRegisterPlatform(anInstallation());
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
