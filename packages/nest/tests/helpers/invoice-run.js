// An installation that issues invoices, in memory: its subscribers, their
// contracts, the charge journal and the invoices, behind the ports
// `SubscriptionInvoiceService` reads, with the test tax adapter deciding.
//
// The invoice store holds what the persistence contract holds both adapters
// to: numbers per year without a gap, a charge on one invoice of a chain step,
// nothing written — no number drawn — for an invoice that is refused, and an
// invoice cancelled once, its cancellation and replacement following it in its
// chain.

import {
    contractPartiesOf,
    formatInvoiceNumber,
    subscriptionInvoiceAlreadyCancelled,
    subscriptionInvoiceChainOf,
    subscriptionInvoiceChargeInvoiced,
    subscriptionInvoiceDocumentChanged,
    taxPerRate,
} from '@saasicat/core';

import {
    InvoiceDocumentService,
    SubscriptionInvoiceService,
    TaxTreatments,
} from '../../dist/billing/index.js';
import { SubscriberService } from '../../dist/subscriber/index.js';
import {
    FakeSubscriberRepository,
    FakeSubscriptionContractRepository,
} from '../../dist/testing/index.js';
import { TEST_TAX_ADAPTER } from './tax-adapter.js';
import { auditLogFailing } from './audit-log.js';
import { aMailbox, aRenderer, anArchive } from './invoice-documents.js';

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
 * The test adapter, able to compute an invoice's tax and to check its content
 * and its file. `gaps` is what it finds missing in every invoice it is shown,
 * `documentGaps` what it finds missing in every file, `decide` its decision
 * where a test needs another one.
 */
export function invoicingAdapter({
    gaps = () => [],
    documentGaps = () => [],
    decide = TEST_TAX_ADAPTER.decide,
} = {}) {
    return {
        ...TEST_TAX_ADAPTER,
        decide,
        invoiceTax: (lines) => taxPerRate(lines),
        invoiceContentGaps: (draft) => gaps(draft),
        invoiceDocumentGaps: async (document, invoice) => documentGaps(document, invoice),
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
    const cancellations = [];
    const documents = new Map();
    const lastOfYear = new Map();
    const onInvoice = () => new Set(invoices.flatMap((inv) => inv.lines.map((l) => l.chargeId)));
    /** Draws the invoice's number and writes it where `placed` puts it in its chain. */
    const write = (invoice, placed, correction) => {
        const numberSequence = (lastOfYear.get(invoice.numberYear) ?? 0) + 1;
        lastOfYear.set(invoice.numberYear, numberSequence);
        const id = `invoice-${invoices.length + 1}`;
        const issued = {
            paidOnIssue: 0,
            ...structuredClone(invoice),
            id,
            number: formatInvoiceNumber(invoice.numberPrefix, invoice.numberYear, numberSequence),
            numberSequence,
            chainId: placed.chainId ?? id,
            chainStep: placed.chainStep,
            lines: invoice.lines.map((l, index) => ({
                correctedPosition: null,
                correctsPosition: null,
                ...l,
                id: `${id}-line-${index + 1}`,
                invoiceId: id,
            })),
            correction,
            createdAt: invoice.issuedAt,
        };
        invoices.push(issued);
        return issued;
    };
    // A correction is invoiced by the cancellation that wrote it, never by the run.
    const uninvoiced = () => {
        const taken = onInvoice();
        return journal.filter((charge) => !taken.has(charge.id) && charge.origin !== 'correction');
    };
    const store = {
        invoices,
        cancellations,
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
            // As a store reads an issued invoice back: one the run issues
            // begins its chain and corrects none.
            return structuredClone(write(invoice, { chainStep: 0 }, null));
        },
        async holdChain(invoiceId) {
            const head = invoices.find((inv) => inv.id === invoiceId);
            if (!head) return null;
            const chain = invoices.filter((inv) => inv.chainId === head.chainId);
            const ids = new Set(chain.map((inv) => inv.id));
            return structuredClone(
                subscriptionInvoiceChainOf(
                    chain,
                    cancellations.filter((each) => ids.has(each.cancelledInvoiceId)),
                ),
            );
        },
        async issueCancellation(write_) {
            const cancelled = invoices.find((inv) => inv.id === write_.cancelledInvoiceId);
            if (!cancelled) throw new Error(`no invoice ${write_.cancelledInvoiceId}`);
            if (cancellations.some((each) => each.cancelledInvoiceId === cancelled.id)) {
                throw subscriptionInvoiceAlreadyCancelled(cancelled.number);
            }
            const id = `cancellation-${cancellations.length + 1}`;
            const of = {
                invoiceId: cancelled.id,
                number: cancelled.number,
                issueDate: cancelled.issueDate,
            };
            const placed = (step) => ({
                chainId: cancelled.chainId,
                chainStep: cancelled.chainStep + step,
            });
            const cancellationInvoice = write(write_.cancellation, placed(1), {
                kind: 'cancellation',
                of,
                reason: write_.reason,
            });
            const replacement =
                write_.replacement &&
                write(write_.replacement, placed(2), {
                    kind: 'replacement',
                    of,
                    reason: write_.reason,
                });
            const cancellation = {
                id,
                cancelledInvoiceId: cancelled.id,
                cancellationInvoiceId: cancellationInvoice.id,
                replacementInvoiceId: replacement?.id ?? null,
                reason: write_.reason,
                correctedSubscriber: write_.correctedSubscriber,
                deliverTo: write_.deliverTo,
                cancelledBy: write_.cancelledBy,
                cancelledAt: write_.cancelledAt,
            };
            cancellations.push(cancellation);
            return structuredClone({
                cancellation,
                cancellationInvoice,
                replacement: replacement ?? null,
            });
        },
        async findCancellation(invoiceId) {
            const found =
                cancellations.find((each) => each.cancelledInvoiceId === invoiceId) ??
                cancellations.find(
                    (each) =>
                        each.cancellationInvoiceId === invoiceId ||
                        each.replacementInvoiceId === invoiceId,
                );
            return structuredClone(found ?? null);
        },
        async findCancellationById(cancellationId) {
            return structuredClone(
                cancellations.find((each) => each.id === cancellationId) ?? null,
            );
        },
        async findById(id) {
            return structuredClone(invoices.find((inv) => inv.id === id) ?? null);
        },
        // The latest number first, as the port promises and both adapters keep it.
        async listBySubscriber(subscriberId) {
            return structuredClone(
                invoices
                    .filter((inv) => inv.subscriberId === subscriberId)
                    .sort(
                        (a, b) =>
                            b.numberYear - a.numberYear || b.numberSequence - a.numberSequence,
                    ),
            );
        },
        async listIssuedNumberPrefixes() {
            return [...new Set(invoices.map((inv) => inv.numberPrefix))].sort().slice(0, 2);
        },
        /** Where each invoice's document stands, by invoice id. */
        documents,
        async recordRendering(invoiceId, rendering) {
            if (!invoices.some((inv) => inv.id === invoiceId)) {
                throw new Error(`no invoice ${invoiceId}`);
            }
            const recorded = documents.get(invoiceId);
            if (recorded && recorded.checksum !== rendering.checksum) {
                throw subscriptionInvoiceDocumentChanged(
                    invoiceId,
                    recorded.checksum,
                    rendering.checksum,
                );
            }
            if (!recorded) {
                documents.set(invoiceId, {
                    invoiceId,
                    ...rendering,
                    archivedAt: null,
                    deliveryClaimedAt: null,
                    deliveredAt: null,
                    deliveredTo: null,
                });
            }
            return structuredClone(documents.get(invoiceId));
        },
        async replaceRendering(invoiceId, rendering, replaced) {
            const state = documents.get(invoiceId);
            if (!state || state.checksum !== replaced || state.archivedAt) return null;
            Object.assign(state, rendering);
            return structuredClone(state);
        },
        async markArchived(invoiceId, at, checksum) {
            const state = documents.get(invoiceId);
            if (!state || state.checksum !== checksum || state.archivedAt) return false;
            state.archivedAt = at;
            return true;
        },
        async claimDelivery(invoiceId, at, staleBefore) {
            const state = documents.get(invoiceId);
            if (!state?.archivedAt || state.deliveredAt) return false;
            if (state.deliveryClaimedAt && state.deliveryClaimedAt >= staleBefore) return false;
            state.deliveryClaimedAt = at;
            return true;
        },
        async markDelivered(invoiceId, { claimedAt, at, to }) {
            const state = documents.get(invoiceId);
            if (!state?.archivedAt || state.deliveredAt) return false;
            if (state.deliveryClaimedAt?.getTime() !== claimedAt.getTime()) return false;
            Object.assign(state, { deliveredAt: at, deliveredTo: to });
            return true;
        },
        async releaseDelivery(invoiceId, claimedAt) {
            const state = documents.get(invoiceId);
            if (
                state &&
                !state.deliveredAt &&
                state.deliveryClaimedAt?.getTime() === claimedAt.getTime()
            ) {
                state.deliveryClaimedAt = null;
            }
        },
        async findDocument(invoiceId) {
            return structuredClone(documents.get(invoiceId) ?? null);
        },
        async listAwaitingDocument({ limit, after }) {
            return pageOf(
                invoices.map((inv) => inv.id).filter((id) => !documents.get(id)?.archivedAt),
                { limit, after },
            );
        },
        async listAwaitingDelivery({ limit, after }) {
            const waiting = [...documents.values()].filter(
                (state) => state.archivedAt && !state.deliveredAt,
            );
            return pageOf(
                waiting.map((state) => state.invoiceId),
                { limit, after },
            );
        },
        async listArchivedDocuments(invoiceIds) {
            return [...new Set(invoiceIds)].filter((id) => documents.get(id)?.archivedAt).sort();
        },
    };
    return store;
}

/** One page of ids, in the order a database sorts them. */
const pageOf = (ids, { limit, after }) =>
    ids
        .filter((id) => after === undefined || id > after)
        .sort()
        .slice(0, limit);

/**
 * An installation that invoices. `settings` is the file, `adapter` the bound
 * tax adapter, `appliedSettings` the settings record, or `null` for an
 * installation that keeps none; the first `failingAuditWrites` writes to the
 * audit log fail. `renderer`, `archive` and `mail` are what the application
 * wires for the invoices' documents, `paymentMethods` the subscribers' payment
 * methods where it takes them.
 */
export function anInvoicingInstallation({
    settings = INVOICING_SETTINGS,
    adapter = invoicingAdapter(),
    appliedSettings = null,
    failingAuditWrites = 0,
    renderer = aRenderer(),
    archive = anArchive(),
    mail = aMailbox(),
    paymentMethods = null,
} = {}) {
    const subscriberRepository = new FakeSubscriberRepository();
    const taxes = new TaxTreatments(settings, adapter);
    const subscribers = new SubscriberService(subscriberRepository, settings, taxes);
    const contracts = new FakeSubscriptionContractRepository();
    const journal = [];
    const store = invoiceStore(journal);
    const audits = [];
    const audit = auditLogFailing(audits, failingAuditWrites);
    const service = new SubscriptionInvoiceService(
        store,
        contracts,
        subscribers,
        taxes,
        settings,
        appliedSettings,
        null,
        audit,
        paymentMethods,
    );
    const documents = new InvoiceDocumentService(
        store,
        renderer,
        archive,
        mail,
        subscribers,
        taxes,
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
        taxes,
        audits,
        /** The audit log both services write to. */
        auditLog: audit,
        service,
        renderer,
        archive,
        mail,
        documents,
        paymentMethods,
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
                correction: null,
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
