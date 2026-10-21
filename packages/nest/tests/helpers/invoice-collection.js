// An installation that collects its invoices, in memory: the invoice run's
// stores, the subscribers' payment methods, a scripted gateway at the one
// account the file names, the record of what the subscriber is told, and the
// attempts, kept as the persistence contract holds both adapters to keep them
// — one open per invoice, none after one succeeded, none while an attempt of
// another invoice of its chain is on its way or with a payment method one of
// the chain's was reversed on, an outcome recorded once, a hold taken by one
// run, a planned attempt taken up by one.

import { afterEach, beforeEach, mock } from 'node:test';
import { Logger } from '@nestjs/common';
import {
    COLLECTION_NOT_SENT_PAID,
    FOLLOWED_UP_COLLECTION_STATUSES,
    REVERSIBLE_COLLECTION_STATUSES,
    UNSETTLED_COLLECTION_STATUSES,
    collectionAttemptKey,
    collectionOutcomeColumns,
    lastCollectionOf,
    refusesFirstAttempt,
    refusesPlannedAttempt,
} from '@saasicat/core';

import {
    InvoiceCancellationService,
    InvoiceCollectionService,
    InvoicePaymentService,
} from '../../dist/billing/index.js';
import { PaymentCallbackService, PaymentGatewayRegistry } from '../../dist/payments/index.js';
import { FakeTransactionRunner } from '../../dist/testing/index.js';
import { auditLogFailing } from './audit-log.js';
import { heldToTheStoresRules } from './charge-journal.js';
import { aMailbox } from './invoice-documents.js';
import { INVOICING_SETTINGS, anInvoicingInstallation, berlin } from './invoice-run.js';
import {
    MAIN_ACCOUNT,
    MemoryPaymentEventLog,
    MemoryPaymentMethods,
    RollbackRunner,
    ScriptedGateway,
    paymentsCatalog,
} from './payments.js';
import { MemorySubscriberPayments } from './subscriber-payments.js';
import { noticeRecord } from './version-notices.js';

/** 06:15 in Berlin on 1 February, when the invoices of February are issued. */
export const ISSUED = new Date('2026-02-01T05:15:00.000Z');

/** `days` days and `minutes` minutes after `at`. */
export const after = (at, { days = 0, minutes = 0 } = {}) =>
    new Date(at.getTime() + days * 86_400_000 + minutes * 60_000);

/** The first run after the invoices of February were issued. */
export const FIRST_RUN = after(ISSUED, { minutes: 15 });

/**
 * Runs the clock from `at` in every test of the suite that calls it: the
 * service stamps every hold, failure and announcement with it, and judges every
 * hold by it, whatever moment a run is called for.
 */
export function clockFrom(at) {
    beforeEach(() => mock.timers.enable({ apis: ['Date'], now: at }));
    afterEach(() => mock.timers.reset());
}

/** Moves the clock to `at`, and answers it. */
export function clockAt(at) {
    mock.timers.setTime(at.getTime());
    return at;
}

/** `ms` milliseconds after the moment `attempt` was last taken on. */
export const sinceHeld = (attempt, ms) => new Date(attempt.heldAt.getTime() + ms);

/** The audit entries of `action`, as what they changed. */
export const entriesOf = (audits, action) =>
    audits.filter((entry) => entry.action === action).map((entry) => entry.changes);

/** Leaves the log out of the output of a test that provokes it. */
export function quietLog() {
    mock.method(Logger.prototype, 'warn', () => {});
    mock.method(Logger.prototype, 'error', () => {});
}

/**
 * An installation with one subscriber paying by `method`, its February invoice
 * issued and handed to the mail at `mailedAt`.
 */
export async function anInvoiceToCollect(method = 'card', { mailedAt = ISSUED, mail } = {}) {
    const installation = aCollectingInstallation({ mail });
    const paying = await installation.aPayingSubscriber('t1', method);
    const invoice = await installation.anInvoiceMailed(paying.subscriber.id, ISSUED, mailedAt);
    return { ...installation, ...paying, invoice };
}

/** An installation that invoices and takes payment methods at one account. */
export const COLLECTING_SETTINGS = {
    ...INVOICING_SETTINGS,
    payments: paymentsCatalog().payments,
};

/**
 * The attempts in memory, beside the invoices and documents of `store` and
 * the subscribers' payment methods. `owes` says whether an invoice still owes
 * something; one that owes nothing is collected no further. `owedOf` is what
 * it owes, which an attempt is written for in its turn — its total unless a
 * test says otherwise.
 */
export function collectionStore(
    store,
    paymentMethods,
    owes = () => true,
    owedOf = (invoiceId) => store.invoices.find((invoice) => invoice.id === invoiceId).totalGross,
) {
    const attempts = [];
    const chainOf = (invoiceId) => {
        const chainId = store.invoices.find((invoice) => invoice.id === invoiceId)?.chainId;
        return new Set(
            store.invoices.filter((invoice) => invoice.chainId === chainId).map((each) => each.id),
        );
    };
    /** Whether another invoice of the chain holds an attempt of `invoiceId` with `paymentMethodId` back. */
    const heldBack = (invoiceId, paymentMethodId) => {
        const chain = chainOf(invoiceId);
        return attempts.some(
            (each) =>
                each.invoiceId !== invoiceId &&
                chain.has(each.invoiceId) &&
                (UNSETTLED_COLLECTION_STATUSES.includes(each.status) ||
                    (each.status === 'REVERSED' && each.paymentMethodId === paymentMethodId)),
        );
    };
    const pageOf = (ids, { limit, after }) =>
        ids
            .filter((id) => after === undefined || id > after)
            .sort()
            .slice(0, limit);
    /** Writes an invoice's next attempt in its turn, unless one of it is open or succeeded. */
    const writeNext = async (request, refuses, state) => {
        // The turn: what a second caller reads is what the first one wrote.
        await new Promise((resolve) => setImmediate(resolve));
        if (!store.invoices.some((invoice) => invoice.id === request.invoiceId)) {
            throw new Error(`no invoice ${request.invoiceId}`);
        }
        if (!owes(request.invoiceId)) return null;
        const earlier = attempts.filter((each) => each.invoiceId === request.invoiceId);
        if (refuses(earlier)) return null;
        if (heldBack(request.invoiceId, request.paymentMethodId)) return null;
        const number = lastCollectionOf(earlier) + 1;
        const written = {
            id: `attempt-${attempts.length + 1}`,
            ...request,
            amount: await owedOf(request.invoiceId),
            attempt: number,
            attemptKey: collectionAttemptKey(request.invoiceId, number),
            paymentRef: null,
            failureReason: null,
            failureCode: null,
            resolvedAt: null,
            announcedAt: null,
            followedUpAt: null,
            ...state,
        };
        attempts.push(written);
        return structuredClone(written);
    };
    /** Throws the error a test set under `name`, once. */
    const throwOnce = (name) => {
        const error = collections[name];
        if (!error) return;
        collections[name] = null;
        throw error;
    };
    const collections = {
        attempts,
        /** An error the next `recordOutcome` throws instead of writing, once. */
        failNextRecord: null,
        /** An error the next `plan` throws instead of writing, once. */
        failNextPlan: null,
        /** An error the next `announce` throws instead of writing, once. */
        failNextAnnounce: null,
        async listDue(today, page) {
            const due = store.invoices.filter((invoice) => {
                const document = store.documents.get(invoice.id);
                const chain = chainOf(invoice.id);
                return (
                    invoice.payment !== null &&
                    document?.deliveredAt &&
                    (invoice.collectionDate === null || invoice.collectionDate <= today) &&
                    !attempts.some((attempt) => attempt.invoiceId === invoice.id) &&
                    !store.cancellations.some((each) => each.cancelledInvoiceId === invoice.id) &&
                    !attempts.some(
                        (attempt) =>
                            chain.has(attempt.invoiceId) &&
                            UNSETTLED_COLLECTION_STATUSES.includes(attempt.status),
                    )
                );
            });
            return pageOf(
                due.map((invoice) => invoice.id),
                page,
            );
        },
        async startAttempt(attempt) {
            const { at, ...request } = attempt;
            return writeNext(request, refusesFirstAttempt, {
                status: 'SUBMITTED',
                submittedAt: at,
                heldAt: at,
                collectOn: null,
            });
        },
        async plan(plan) {
            throwOnce('failNextPlan');
            const { collectOn, after, ...request } = plan;
            return writeNext(request, (earlier) => refusesPlannedAttempt(earlier, after), {
                status: 'SCHEDULED',
                submittedAt: null,
                heldAt: null,
                collectOn,
            });
        },
        async announce(id, collectOn, at) {
            throwOnce('failNextAnnounce');
            const attempt = attempts.find((each) => each.id === id);
            if (attempt?.status !== 'SCHEDULED' || attempt.announcedAt !== null) return false;
            Object.assign(attempt, { collectOn, announcedAt: at });
            return true;
        },
        async submitPlanned(id, at) {
            const attempt = attempts.find((each) => each.id === id);
            if (attempt?.status !== 'SCHEDULED' || !owes(attempt.invoiceId)) return null;
            Object.assign(attempt, { status: 'SUBMITTED', submittedAt: at, heldAt: at });
            return structuredClone(attempt);
        },
        async withdraw(id, at) {
            const attempt = attempts.find((each) => each.id === id);
            if (attempt?.status !== 'SCHEDULED') return false;
            Object.assign(attempt, { status: 'WITHDRAWN', resolvedAt: at });
            return true;
        },
        async listPlanned(page) {
            return pageOf(
                attempts.filter((each) => each.status === 'SCHEDULED').map((each) => each.id),
                page,
            );
        },
        async listToFollowUp(page) {
            return pageOf(
                attempts
                    .filter(
                        (each) =>
                            FOLLOWED_UP_COLLECTION_STATUSES.includes(each.status) &&
                            each.followedUpAt === null,
                    )
                    .map((each) => each.id),
                page,
            );
        },
        async listCollectableAgain(page) {
            const collectable = store.invoices.filter((invoice) => {
                const last = attempts
                    .filter((each) => each.invoiceId === invoice.id)
                    .sort((a, b) => b.attempt - a.attempt)[0];
                const inUse = paymentMethods.rows.find(
                    (row) => row.subscriberId === invoice.subscriberId && row.status === 'ACTIVE',
                );
                return (
                    last !== undefined &&
                    inUse !== undefined &&
                    (last.status === 'WITHDRAWN' ||
                        (FOLLOWED_UP_COLLECTION_STATUSES.includes(last.status) &&
                            last.followedUpAt !== null)) &&
                    inUse.id !== last.paymentMethodId &&
                    !attempts.some(
                        (each) =>
                            each.invoiceId === invoice.id &&
                            each.status === 'REVERSED' &&
                            (each.followedUpAt === null || each.paymentMethodId === inUse.id),
                    ) &&
                    owes(invoice.id)
                );
            });
            return pageOf(
                collectable.map((invoice) => invoice.id),
                page,
            );
        },
        async markFollowedUp(id, at) {
            const attempt = attempts.find((each) => each.id === id);
            if (
                !FOLLOWED_UP_COLLECTION_STATUSES.includes(attempt?.status) ||
                attempt.followedUpAt !== null
            ) {
                return false;
            }
            attempt.followedUpAt = at;
            return true;
        },
        async markReversed(id, at) {
            const attempt = attempts.find((each) => each.id === id);
            if (!attempt || !REVERSIBLE_COLLECTION_STATUSES.includes(attempt.status)) return false;
            Object.assign(attempt, { status: 'REVERSED', resolvedAt: at, followedUpAt: null });
            return true;
        },
        async recordOutcome(id, outcome, at) {
            throwOnce('failNextRecord');
            const attempt = attempts.find((each) => each.id === id);
            if (!attempt) return false;
            if (UNSETTLED_COLLECTION_STATUSES.includes(attempt.status)) {
                Object.assign(attempt, collectionOutcomeColumns(outcome, at));
                return true;
            }
            // A success for an attempt recorded as failed: what was planned
            // after it is withdrawn, and it succeeds where nothing else of its
            // invoice is on its way or succeeded.
            if (outcome.status !== 'succeeded' || attempt.status !== 'FAILED') return false;
            const ofInvoice = attempts.filter((each) => each.invoiceId === attempt.invoiceId);
            for (const planned of ofInvoice.filter((each) => each.status === 'SCHEDULED')) {
                Object.assign(planned, { status: 'WITHDRAWN', resolvedAt: at });
            }
            const blocked = ofInvoice.some(
                (each) =>
                    each.id !== id &&
                    (UNSETTLED_COLLECTION_STATUSES.includes(each.status) ||
                        each.status === 'SUCCEEDED'),
            );
            if (blocked) return false;
            Object.assign(attempt, collectionOutcomeColumns(outcome, at));
            return true;
        },
        async abandonPaid(id, at) {
            const attempt = attempts.find((each) => each.id === id);
            if (attempt?.status !== 'SUBMITTED') return 'settled';
            if (owes(attempt.invoiceId)) {
                attempt.heldAt = at;
                return 'resend';
            }
            Object.assign(attempt, collectionOutcomeColumns(COLLECTION_NOT_SENT_PAID, at));
            return 'abandoned';
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
        async findByKey(attemptKey) {
            const attempt = attempts.find((each) => each.attemptKey === attemptKey);
            return attempt ? structuredClone(attempt) : null;
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
    mail = aMailbox(),
} = {}) {
    const paymentMethods = new MemoryPaymentMethods();
    const installation = anInvoicingInstallation({ settings, paymentMethods, mail });
    const payments = new MemorySubscriberPayments(
        installation.store.invoices,
        installation.store.cancellations,
    );
    const collections = collectionStore(
        installation.store,
        paymentMethods,
        (invoiceId) => payments.stillOwes(invoiceId),
        (invoiceId) => payments.owedBy(invoiceId),
    );
    const notices = noticeRecord();
    const gateway = new ScriptedGateway('stripe');
    const gateways = new PaymentGatewayRegistry(settings, { [MAIN_ACCOUNT]: gateway });
    const audits = [];
    const eventLog = new MemoryPaymentEventLog();
    const transactions = new RollbackRunner([payments, eventLog]);
    const callbacks = new PaymentCallbackService(gateways, eventLog, transactions);
    const money = new InvoicePaymentService(
        collections,
        payments,
        gateways,
        callbacks,
        null,
        auditLogFailing(audits, failingAuditWrites),
    );
    money.onModuleInit();
    const collection = new InvoiceCollectionService(
        collections,
        installation.store,
        settings,
        gateways,
        paymentMethods,
        null,
        auditLogFailing(audits, failingAuditWrites),
        notices,
        installation.mail,
        installation.subscribers,
        money,
        transactions,
    );
    // Corrects an issued invoice: the journal as the ledger reads it, and the
    // platform's transaction, which the invoices in memory need none of.
    let counterEntries = 0;
    const cancellation = new InvoiceCancellationService(
        installation.store,
        {
            listBySubscription: async (subscriptionId) =>
                structuredClone(
                    installation.journal.filter(
                        (charge) => charge.subscriptionId === subscriptionId,
                    ),
                ),
            // Where a cancellation writes its counter-entries, held to what a store refuses.
            recordCharges: async (charges) => {
                heldToTheStoresRules(charges, installation.journal);
                return charges.map((charge) => {
                    counterEntries += 1;
                    const written = {
                        ...structuredClone(charge),
                        id: `counter-entry-${counterEntries}`,
                        createdAt: charge.bookedAt,
                    };
                    installation.journal.push(written);
                    return structuredClone(written);
                });
            },
        },
        installation.subscribers,
        installation.service,
        installation.taxes,
        settings,
        new FakeTransactionRunner(),
        payments,
        collections,
        paymentMethods,
        null,
        installation.contracts,
    );
    cancellation.onModuleInit();
    return {
        ...installation,
        paymentMethods,
        payments,
        cancellation,
        eventLog,
        callbacks,
        money,
        collections,
        notices,
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
