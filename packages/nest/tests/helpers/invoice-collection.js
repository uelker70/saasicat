// An installation that collects its invoices, in memory: the invoice run's
// stores, the subscribers' payment methods, a scripted gateway at the one
// account the file names, and the attempts, kept as the persistence contract
// holds both adapters to keep them — one not settled per invoice, none after
// one succeeded, an outcome recorded once, a hold taken by one run.

import {
    UNSETTLED_COLLECTION_STATUSES,
    collectionAttemptKey,
    collectionOutcomeColumns,
} from '@saasicat/core';

import { InvoiceCollectionService } from '../../dist/billing/index.js';
import { PaymentGatewayRegistry } from '../../dist/payments/index.js';
import { auditLogFailing } from './audit-log.js';
import { INVOICING_SETTINGS, anInvoicingInstallation, berlin } from './invoice-run.js';
import {
    MAIN_ACCOUNT,
    MemoryPaymentMethods,
    ScriptedGateway,
    paymentsCatalog,
} from './payments.js';

/** An installation that invoices and takes payment methods at one account. */
export const COLLECTING_SETTINGS = {
    ...INVOICING_SETTINGS,
    payments: paymentsCatalog().payments,
};

const BLOCKING = new Set([...UNSETTLED_COLLECTION_STATUSES, 'SUCCEEDED']);

/** The attempts in memory, beside the invoices and documents of `store`. */
export function collectionStore(store) {
    const attempts = [];
    const pageOf = (ids, { limit, after }) =>
        ids
            .filter((id) => after === undefined || id > after)
            .sort()
            .slice(0, limit);
    const collections = {
        attempts,
        /** An error the next `recordOutcome` throws instead of writing, once. */
        failNextRecord: null,
        async listDue(today, page) {
            const due = store.invoices.filter((invoice) => {
                const document = store.documents.get(invoice.id);
                return (
                    invoice.payment !== null &&
                    document?.deliveredAt &&
                    (invoice.collectionDate === null || invoice.collectionDate <= today) &&
                    !attempts.some((attempt) => attempt.invoiceId === invoice.id)
                );
            });
            return pageOf(
                due.map((invoice) => invoice.id),
                page,
            );
        },
        async startAttempt(attempt) {
            // The turn: what a second caller reads is what the first one wrote.
            await new Promise((resolve) => setImmediate(resolve));
            if (!store.invoices.some((invoice) => invoice.id === attempt.invoiceId)) {
                throw new Error(`no invoice ${attempt.invoiceId}`);
            }
            const earlier = attempts.filter((each) => each.invoiceId === attempt.invoiceId);
            if (earlier.some((each) => BLOCKING.has(each.status))) return null;
            const number = earlier.length + 1;
            const { at, ...request } = attempt;
            const started = {
                id: `attempt-${attempts.length + 1}`,
                ...request,
                attempt: number,
                attemptKey: collectionAttemptKey(attempt.invoiceId, number),
                status: 'SUBMITTED',
                paymentRef: null,
                failureReason: null,
                failureCode: null,
                submittedAt: at,
                heldAt: at,
                resolvedAt: null,
            };
            attempts.push(started);
            return structuredClone(started);
        },
        async recordOutcome(id, outcome, at) {
            if (collections.failNextRecord) {
                const error = collections.failNextRecord;
                collections.failNextRecord = null;
                throw error;
            }
            const attempt = attempts.find((each) => each.id === id);
            if (!attempt || !UNSETTLED_COLLECTION_STATUSES.includes(attempt.status)) return false;
            Object.assign(attempt, collectionOutcomeColumns(outcome, at));
            return true;
        },
        async hold(id, heldBefore, at) {
            const attempt = attempts.find((each) => each.id === id);
            if (!attempt || !UNSETTLED_COLLECTION_STATUSES.includes(attempt.status)) return false;
            if (attempt.heldAt >= heldBefore) return false;
            attempt.heldAt = at;
            return true;
        },
        async listUnsettled({ submittedBefore, pendingBefore }, page) {
            const open = attempts.filter(
                (each) =>
                    (each.status === 'SUBMITTED' && each.heldAt < submittedBefore) ||
                    (each.status === 'PENDING' && each.heldAt < pendingBefore),
            );
            return pageOf(
                open.map((each) => each.id),
                page,
            );
        },
        async findById(id) {
            return structuredClone(attempts.find((each) => each.id === id) ?? null);
        },
        async listByInvoice(invoiceId) {
            return structuredClone(attempts.filter((each) => each.invoiceId === invoiceId));
        },
        async accountsInUse() {
            return [
                ...new Set(
                    attempts
                        .filter((each) => UNSETTLED_COLLECTION_STATUSES.includes(each.status))
                        .map((each) => each.gatewayAccount),
                ),
            ].sort();
        },
    };
    return collections;
}

/**
 * An installation that issues, mails and collects invoices. `settings` is the
 * file; the first `failingAuditWrites` writes to the audit log fail.
 */
export function aCollectingInstallation({
    settings = COLLECTING_SETTINGS,
    failingAuditWrites = 0,
} = {}) {
    const paymentMethods = new MemoryPaymentMethods();
    const installation = anInvoicingInstallation({ settings, paymentMethods });
    const collections = collectionStore(installation.store);
    const gateway = new ScriptedGateway('stripe');
    const gateways = new PaymentGatewayRegistry(settings, { [MAIN_ACCOUNT]: gateway });
    const audits = [];
    const collection = new InvoiceCollectionService(
        collections,
        installation.store,
        settings,
        gateways,
        paymentMethods,
        null,
        auditLogFailing(audits, failingAuditWrites),
    );
    return {
        ...installation,
        paymentMethods,
        collections,
        gateway,
        gateways,
        audits,
        collection,
        /** A subscriber with a contract charged its February, and the payment method `method` in use. */
        async aPayingSubscriber(tenantId = 't1', method = 'card') {
            const subscriber = await installation.aSubscriber(tenantId, {
                invoiceEmail: `billing@${tenantId}.example`,
            });
            const confirmed = await paymentMethods.recordConfirmed(
                paymentMethodOf(subscriber.id, method),
            );
            const contract = await installation.aContract(subscriber);
            installation.charge(contract, 'plan');
            installation.charge(contract, 'discount');
            return { subscriber, contract, method: confirmed.method };
        },
        /** The invoice of `subscriberId`, issued at `issuedAt` and handed to the mail at `mailedAt`. */
        async anInvoiceMailed(subscriberId, issuedAt, mailedAt = issuedAt) {
            await installation.run(issuedAt);
            const invoice = installation.store.invoices.find(
                (each) => each.subscriberId === subscriberId,
            );
            installation.store.documents.set(invoice.id, {
                invoiceId: invoice.id,
                checksum: 'a'.repeat(64),
                mediaType: 'application/pdf',
                fileName: `${invoice.number}.pdf`,
                size: 1,
                renderedAt: issuedAt,
                archivedAt: issuedAt,
                deliveryClaimedAt: mailedAt,
                deliveredAt: mailedAt,
                deliveredTo: 'billing@example.com',
            });
            return invoice;
        },
        /** The run at `now`. */
        collect(now) {
            return collection.collectDue(now);
        },
    };
}

/** A payment method the gateway confirmed for `subscriberId`: a card, or a direct debit. */
export function paymentMethodOf(subscriberId, type, overrides = {}) {
    const debit = type === 'sepa_debit';
    return {
        subscriberId,
        gatewayAccount: MAIN_ACCOUNT,
        provider: 'stripe',
        customerRef: `cus_${subscriberId}`,
        paymentMethodRef: `pm_${type}_${subscriberId}`,
        type,
        brand: debit ? null : 'visa',
        last4: debit ? '3000' : '4242',
        expiryMonth: debit ? null : 12,
        expiryYear: debit ? null : 2029,
        country: 'DE',
        bankCode: debit ? '37040044' : null,
        mandateReference: debit ? `MANDAT-${subscriberId}` : null,
        confirmedAt: berlin('2026-01-15'),
        ...overrides,
    };
}
