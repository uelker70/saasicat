// An installation that issues invoices, in memory: its subscribers, their
// contracts, the charge journal and the invoices, behind the ports
// `SubscriptionInvoiceService` reads, with the test tax adapter deciding.
//
// The invoice store holds what the persistence contract holds both adapters
// to: numbers per year without a gap, a charge on one invoice, and nothing
// written — no number drawn — for an invoice that is refused.

import {
    contractPartiesOf,
    formatInvoiceNumber,
    subscriptionInvoiceChargeInvoiced,
    taxPerRate,
} from '@saasicat/core';

import { SubscriptionInvoiceService, TaxTreatments } from '../../dist/billing/index.js';
import { SubscriberService } from '../../dist/subscriber/index.js';
import {
    FakeSubscriberRepository,
    FakeSubscriptionContractRepository,
} from '../../dist/testing/index.js';
import { TEST_TAX_ADAPTER } from './tax-adapter.js';

/** The issuer `config/saas.yaml` names. */
export const ISSUER = {
    legalName: 'Issuer GmbH',
    vatId: 'DE123456789',
    addressLine1: 'Werkstraße 5',
    postalCode: '80331',
    city: 'München',
    country: 'DE',
};

/** An installation that invoices: a tax adapter, its zone, the issuer and the range. */
export const INVOICING_SETTINGS = {
    schemaVersion: 1,
    app: { name: 'Test App' },
    currency: 'EUR',
    timeZone: 'Europe/Berlin',
    tax: { adapter: 'test-tax' },
    issuer: ISSUER,
    subscribers: { customerNumberPrefix: 'K-' },
    invoicing: { numberPrefix: 'AHP', paymentTermDays: 14 },
};

/** A complete address in Germany, which an invoice can name. */
export const ADDRESS = {
    addressLine1: 'Hauptstraße 1',
    postalCode: '10115',
    city: 'Berlin',
    country: 'DE',
};

/** Midnight of `day` in Berlin in winter, where the journal starts a period. */
export const berlin = (day) => new Date(`${day}T00:00:00.000+01:00`);

/**
 * The test adapter, able to compute an invoice's tax and to check its content.
 * `gaps` is what it finds missing in every invoice it is shown, `decide` its
 * decision where a test needs another one.
 */
export function invoicingAdapter({ gaps = () => [], decide = TEST_TAX_ADAPTER.decide } = {}) {
    return {
        ...TEST_TAX_ADAPTER,
        decide,
        invoiceTax: (lines) => taxPerRate(lines),
        invoiceContentGaps: (draft) => gaps(draft),
    };
}

/** A contract line as the freeze writes it. */
export function line(kind, sourceKey, priceNet, title = sourceKey) {
    return {
        kind,
        sourceKey,
        sourceVersionId: null,
        titleSnapshot: title,
        descriptionSnapshot: null,
        quantity: 1,
        unit: null,
        priceNet,
        priceGross: priceNet,
        billingCycle: 'monthly',
        currency: 'EUR',
        taxRate: 19,
        taxAmount: 0,
        minimumTermUntil: null,
        featuresSnapshot: [],
        quotaEffectsSnapshot: {},
        metadata: null,
    };
}

/** Invoices in memory, as the persistence contract holds an adapter to keep them. */
function invoiceStore(journal) {
    const invoices = [];
    const lastOfYear = new Map();
    const onInvoice = () => new Set(invoices.flatMap((inv) => inv.lines.map((l) => l.chargeId)));
    const uninvoiced = () => {
        const taken = onInvoice();
        return journal.filter((charge) => !taken.has(charge.id));
    };
    const store = {
        invoices,
        /** An error the next `issue` throws instead of writing, once. */
        failNextIssue: null,
        /** Charge ids another instance takes just before the next `issue` writes. */
        takenByAnother: [],
        async listSubscriptionsWithUninvoicedCharges({ limit, after }) {
            const groups = Map.groupBy(uninvoiced(), (charge) =>
                [charge.subscriptionId, charge.contractId, charge.bookedAt.toISOString()].join('|'),
            );
            const due = new Set();
            for (const charges of groups.values()) {
                if (charges.some((charge) => charge.amountNet !== 0)) {
                    due.add(charges[0].subscriptionId);
                }
            }
            return [...due]
                .filter((id) => after === undefined || id > after)
                .sort()
                .slice(0, limit);
        },
        async listUninvoicedCharges(subscriptionId) {
            return uninvoiced().filter((charge) => charge.subscriptionId === subscriptionId);
        },
        async issue(invoice) {
            if (store.failNextIssue) {
                const error = store.failNextIssue;
                store.failNextIssue = null;
                throw error;
            }
            const taken = new Set([...onInvoice(), ...store.takenByAnother]);
            const clash = invoice.lines.find((l) => taken.has(l.chargeId));
            if (clash) throw subscriptionInvoiceChargeInvoiced(clash.chargeId);
            const numberSequence = (lastOfYear.get(invoice.numberYear) ?? 0) + 1;
            lastOfYear.set(invoice.numberYear, numberSequence);
            const id = `invoice-${invoices.length + 1}`;
            const issued = {
                ...structuredClone(invoice),
                id,
                number: formatInvoiceNumber(
                    invoice.numberPrefix,
                    invoice.numberYear,
                    numberSequence,
                ),
                numberSequence,
                lines: invoice.lines.map((l, index) => ({
                    ...l,
                    id: `${id}-line-${index + 1}`,
                    invoiceId: id,
                })),
                createdAt: invoice.issuedAt,
            };
            invoices.push(issued);
            return structuredClone(issued);
        },
        async findById(id) {
            return structuredClone(invoices.find((inv) => inv.id === id) ?? null);
        },
        async listBySubscriber(subscriberId) {
            return structuredClone(invoices.filter((inv) => inv.subscriberId === subscriberId));
        },
        async listIssuedNumberPrefixes() {
            return [...new Set(invoices.map((inv) => inv.numberPrefix))].sort().slice(0, 2);
        },
    };
    return store;
}

/**
 * An installation that invoices. `settings` is the file, `adapter` the bound
 * tax adapter, `appliedSettings` the settings record, or `null` for an
 * installation that keeps none; the first `failingAuditWrites` writes to the
 * audit log fail.
 */
export function anInvoicingInstallation({
    settings = INVOICING_SETTINGS,
    adapter = invoicingAdapter(),
    appliedSettings = null,
    failingAuditWrites = 0,
} = {}) {
    const subscriberRepository = new FakeSubscriberRepository();
    const taxes = new TaxTreatments(settings, adapter);
    const subscribers = new SubscriberService(subscriberRepository, settings, taxes);
    const contracts = new FakeSubscriptionContractRepository();
    const journal = [];
    const store = invoiceStore(journal);
    const audits = [];
    let failing = failingAuditWrites;
    const audit = {
        log: async (entry) => {
            if (failing > 0) {
                failing -= 1;
                throw new Error('the audit log is unreachable');
            }
            audits.push(entry);
        },
    };
    const service = new SubscriptionInvoiceService(
        store,
        contracts,
        subscribers,
        taxes,
        settings,
        appliedSettings,
        null,
        audit,
    );
    let charges = 0;
    return {
        settings,
        store,
        journal,
        contracts,
        subscribers,
        audits,
        service,
        /** A subscriber of `tenantId`, in Germany with a complete address unless `details` says otherwise. */
        aSubscriber(tenantId, details = {}) {
            return subscribers.createForTenant(tenantId, {
                legalName: `Customer of ${tenantId}`,
                ...ADDRESS,
                ...details,
            });
        },
        /** A contract of `subscriber`, concluded with the issuer the file names. */
        aContract(subscriber, { lineItems, issuer, partiesMigrated = false } = {}) {
            const parties = contractPartiesOf(subscriber, settings.issuer);
            return contracts.create({
                tenantId: subscriber.tenantId,
                parties: issuer === undefined ? parties : { ...parties, issuer },
                partiesMigrated,
                effectiveFrom: berlin('2026-01-01'),
                priceSnapshot: {
                    currency: 'EUR',
                    billingCycle: 'monthly',
                    subtotalNet: 49,
                    discountNet: 0,
                    totalNet: 49,
                    vatRate: 19,
                    totalGross: 58.31,
                },
                lineItems: lineItems ?? [
                    line('plan', 'STANDARD', 49, 'Standard, monthly'),
                    line('discount', 'WELCOME', -4.9, 'Welcome discount'),
                ],
            });
        },
        /**
         * Writes a charge of `contract`'s line `kind` to the journal, for
         * February unless `overrides` says otherwise, booked when its period
         * starts.
         */
        charge(contract, kind, overrides = {}) {
            const contractLine = contract.lineItems.find((item) => item.kind === kind);
            charges += 1;
            const periodStart = overrides.periodStart ?? berlin('2026-02-01');
            const written = {
                id: `charge-${charges}`,
                subscriberId: contract.subscriberId,
                tenantId: contract.tenantId,
                subscriptionId: `sub-${contract.tenantId}`,
                contractId: contract.id,
                contractLineItemId: contractLine.id,
                origin: 'renewal',
                source: kind === 'discount' ? 'discount' : kind === 'bundle' ? 'bundle' : 'plan',
                sourceRef: `${kind}-${charges}`,
                periodStart,
                periodEnd: berlin('2026-03-01'),
                currency: 'EUR',
                amountNet: contractLine.priceNet,
                bookedAt: periodStart,
                createdAt: periodStart,
                ...overrides,
            };
            journal.push(written);
            return written;
        },
        /** The run at `now`, as the quarter-hourly job makes it. */
        run(now = new Date('2026-02-01T05:15:00.000Z')) {
            return service.issueDue(now);
        },
    };
}
