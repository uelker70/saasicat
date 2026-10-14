// The run that collects the invoices that announced how they are paid
// (`SC-PRIC-079`).
//
// It first takes on the attempts that are not settled: one whose answer was
// lost is asked about at the gateway, and sent again as the same request under
// the same key only where the gateway holds nothing under it; a direct debit
// on its way is asked about once an hour (`SC-PRIC-034`). It then collects the
// invoices that have reached the subscriber: by card at once, by direct debit
// from the day the invoice announced. Each attempt is started in the
// invoice's turn and written as submitted before its request leaves
// (`SC-PRIC-036`), so of several instances one sends it, and a request that
// left is never followed by a second one under a new key without the gateway
// having been asked.
//
// An invoice is collected only as it announced it. Where the subscriber's
// payment method in use is another, or a direct debit's invoice reached the
// subscriber less than the lead time before its date, it waits, and the audit
// log says why once per process (`SC-PRIC-028`). A failure is recorded with
// its reason and written to the audit log once; what follows it is not this
// run's to decide.
//
// Platform-wide, so inside `RlsBypassPort`.

import { Inject, Injectable, Logger, type OnModuleInit, Optional } from '@nestjs/common';
import {
    INVOICE_COLLECTION_ASK_EVERY_MS,
    INVOICE_COLLECTION_LEASE_MS,
    INVOICE_ERROR_CODES,
    addDaysToDay,
    dayInZone,
    directDebitLeadDaysOf,
    toCents,
    type CalendarDay,
    type CollectInvoiceInput,
    type CollectionFailureReason,
    type CollectionOutcome,
    type InvoiceCollectionRecord,
    type InvoiceCollectionRepository,
    type PlanCatalogSettings,
    type RlsBypassPort,
    type SubscriberPaymentMethodRepository,
    type SubscriptionInvoiceDocumentRecord,
    type SubscriptionInvoiceRecord,
    type SubscriptionInvoiceRepository,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { AdminAuditService, platformJobActor } from '../../admin/admin-audit.service.js';
import { readAcrossTenants } from '../../admin/read-across-tenants.js';
import { withTimeout } from '../../core/with-timeout.js';
import {
    PaymentGatewayRegistry,
    type PaymentGatewayAccount,
} from '../../payments/payment-gateway-registry.js';
import { SUBSCRIBER_PAYMENT_METHOD_REPOSITORY_TOKEN } from '../../payments/payments.tokens.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from '../plan-catalog.module.js';
import { AuditedOnce } from './audited-once.js';
import { INVOICE_COLLECTION_REPOSITORY_TOKEN } from './invoice-collection.tokens.js';
import { SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN } from './subscription-invoice.tokens.js';

/** The name the run writes its audit entries under: `job:platform:subscription-invoices`. */
const JOB = 'subscription-invoices';

/** How many invoices or attempts one page of the run reads. */
const PAGE_SIZE = 100;

/**
 * How long a gateway may take to answer, before the attempt counts as
 * unanswered. Shorter than the lease, so the run that sent it is done waiting
 * before another may take it on.
 */
export const INVOICE_COLLECTION_TIMEOUT_MS = 60_000;

/** What a collection run did. */
export interface InvoiceCollectionRun {
    /** Attempts the gateway answered as collected. */
    collected: number;
    /** Direct debits on their way. */
    pending: number;
    /** Attempts the gateway answered as failed. */
    failed: number;
    /** Invoices not collected as they announced it, which wait for a new announcement. */
    waiting: number;
    /** Requests without an answer; each is asked about by a run after the lease. */
    unanswered: number;
}

/** Why an invoice is not collected as it announced it: the coded reason and what it names. */
type Waiting =
    | {
          code: typeof INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_PAYMENT_METHOD_CHANGED;
          params: { announced: string; paymentMethodId: string | null };
      }
    | {
          code: typeof INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_ANNOUNCED_TOO_LATE;
          params: { deliveredOn: CalendarDay; leadDays: number; collectionDate: CalendarDay };
      };

/** What an audit entry about a collection records. */
type CollectionAudit =
    | {
          action: 'SUBSCRIPTION_INVOICE_COLLECTION_FAILED';
          changes: {
              number: string;
              attempt: number;
              reason: CollectionFailureReason;
              gatewayCode: string | null;
          };
      }
    | {
          action: 'SUBSCRIPTION_INVOICE_COLLECTION_WAITING';
          changes: { number: string } & Waiting;
      };

@Injectable()
export class InvoiceCollectionService implements OnModuleInit {
    private readonly logger = new Logger(InvoiceCollectionService.name);
    private readonly audited = new AuditedOnce();
    private readonly timeoutMs = INVOICE_COLLECTION_TIMEOUT_MS;

    constructor(
        @Inject(INVOICE_COLLECTION_REPOSITORY_TOKEN)
        private readonly collections: InvoiceCollectionRepository,
        @Inject(SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN)
        private readonly invoices: SubscriptionInvoiceRepository,
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: PlanCatalogSettings,
        // Both from `PaymentsModule`; required to start, and optional here only
        // so that the start can say what is missing: see `onModuleInit`.
        @Optional()
        @Inject(PaymentGatewayRegistry)
        private readonly gateways: PaymentGatewayRegistry | null = null,
        @Optional()
        @Inject(SUBSCRIBER_PAYMENT_METHOD_REPOSITORY_TOKEN)
        private readonly paymentMethods: SubscriberPaymentMethodRepository | null = null,
        // The run is the installation's, not a tenant's.
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
        @Optional()
        @Inject(AdminAuditService)
        private readonly audit: AdminAuditService | null = null,
    ) {}

    /**
     * Refuses to start without the gateways and the payment methods: an
     * invoice is collected through the account its payment method is held at.
     */
    onModuleInit(): void {
        if (this.gateways && this.paymentMethods && this.settings.payments) return;
        throw new Error(
            'Invoices cannot start:\n- collecting invoices needs the payment accounts under payments ' +
                'in config/saas.yaml and PaymentsModule, wired globally as it is by default, which ' +
                'binds a gateway for each account.',
        );
    }

    /** Settles what is open, then collects every invoice due at `now`. */
    async collectDue(now: Date): Promise<InvoiceCollectionRun> {
        return readAcrossTenants(this.rlsBypass, async () => {
            const run: InvoiceCollectionRun = {
                collected: 0,
                pending: 0,
                failed: 0,
                waiting: 0,
                unanswered: 0,
            };
            const before = {
                submittedBefore: new Date(now.getTime() - INVOICE_COLLECTION_LEASE_MS),
                pendingBefore: new Date(now.getTime() - INVOICE_COLLECTION_ASK_EVERY_MS),
            };
            await this.eachPage(
                (page) => this.collections.listUnsettled(before, page),
                (id) => this.settleOne(id, before, run),
            );
            const today = dayInZone(now, this.timeZone());
            await this.eachPage(
                (page) => this.collections.listDue(today, page),
                (invoiceId) => this.collectOne(invoiceId, run),
            );
            return run;
        });
    }

    private async collectOne(invoiceId: string, run: InvoiceCollectionRun): Promise<void> {
        const invoice = await this.invoices.findById(invoiceId);
        const document = invoice && (await this.invoices.findDocument(invoiceId));
        if (!invoice?.payment || !document) {
            throw new Error(
                `Invoice ${invoiceId} is due for collection and has no payment or mail.`,
            );
        }
        const method = await this.paymentMethods!.findActive(invoice.subscriberId);
        const announced = invoice.payment.paymentMethodId;
        if (method?.id !== announced) {
            await this.recordWaiting(invoice, {
                code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_PAYMENT_METHOD_CHANGED,
                params: { announced, paymentMethodId: method?.id ?? null },
            });
            run.waiting += 1;
            return;
        }
        const late = this.announcedTooLate(invoice, document);
        if (late) {
            await this.recordWaiting(invoice, late);
            run.waiting += 1;
            return;
        }
        const account = this.accountOf(method.gatewayAccount);
        // Stamped with the moment it is taken on, not the start of the run,
        // for the reason the mail's claim is.
        const attempt = await this.collections.startAttempt({
            invoiceId: invoice.id,
            gatewayAccount: method.gatewayAccount,
            paymentMethodId: method.id,
            paymentMethodType: method.type,
            customerRef: method.customerRef,
            paymentMethodRef: method.paymentMethodRef,
            invoiceNumber: invoice.number,
            amount: invoice.totalGross,
            currency: invoice.currency,
            at: new Date(),
        });
        // Another instance started it first, or one of its attempts is open.
        if (!attempt) return;
        await this.send(account, attempt, run);
    }

    /**
     * Why a direct debit is not collected on the day its invoice announced,
     * or `null` where it is: the invoice reached the subscriber at least the
     * lead time before that day, as `config/saas.yaml` names it now.
     */
    private announcedTooLate(
        invoice: SubscriptionInvoiceRecord,
        document: SubscriptionInvoiceDocumentRecord,
    ): Waiting | null {
        if (invoice.collectionDate === null || !document.deliveredAt) return null;
        const leadDays = directDebitLeadDaysOf(this.settings.invoicing ?? {});
        const deliveredOn = dayInZone(document.deliveredAt, this.timeZone());
        if (addDaysToDay(deliveredOn, leadDays) <= invoice.collectionDate) return null;
        return {
            code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_ANNOUNCED_TOO_LATE,
            params: { deliveredOn, leadDays, collectionDate: invoice.collectionDate },
        };
    }

    /**
     * Takes on an attempt that is not settled — where no other run took it on
     * since the lease or the last question — and finds out what became of it:
     * from the gateway, and where the gateway holds nothing under its key, by
     * sending the same request again.
     */
    private async settleOne(
        id: string,
        before: { submittedBefore: Date; pendingBefore: Date },
        run: InvoiceCollectionRun,
    ): Promise<void> {
        const attempt = await this.collections.findById(id);
        if (!attempt) return;
        const heldBefore =
            attempt.status === 'SUBMITTED' ? before.submittedBefore : before.pendingBefore;
        if (!(await this.collections.hold(id, heldBefore, new Date()))) return;
        const account = this.accountOf(attempt.gatewayAccount);
        let found: CollectionOutcome | null;
        try {
            found = await withTimeout(
                () =>
                    account.gateway.findCollection({
                        attemptKey: attempt.attemptKey,
                        customerRef: attempt.customerRef,
                        paymentRef: attempt.paymentRef,
                        submittedAt: attempt.submittedAt,
                    }),
                this.timeoutMs,
            );
        } catch (error) {
            this.unanswered(attempt, 'did not say what became of it', error);
            run.unanswered += 1;
            return;
        }
        if (found) {
            await this.record(attempt, found, run);
            return;
        }
        if (attempt.status !== 'SUBMITTED') {
            this.logger.error(
                `Collection attempt ${attempt.attemptKey} is on its way, and the gateway of ` +
                    `'${attempt.gatewayAccount}' holds nothing under its key; it is asked again.`,
            );
            run.unanswered += 1;
            return;
        }
        // The request never reached the gateway: the same request, under the
        // same key, cannot charge twice.
        await this.send(account, attempt, run);
    }

    /** Sends the attempt's request and records the answer; no answer leaves it to a later run. */
    private async send(
        account: PaymentGatewayAccount,
        attempt: InvoiceCollectionRecord,
        run: InvoiceCollectionRun,
    ): Promise<void> {
        let outcome: CollectionOutcome;
        try {
            outcome = await withTimeout(
                () => account.gateway.collect(requestOf(attempt)),
                this.timeoutMs,
            );
        } catch (error) {
            this.unanswered(attempt, 'did not answer the request', error);
            run.unanswered += 1;
            return;
        }
        await this.record(attempt, outcome, run);
    }

    /**
     * Records what became of an attempt. Where another run settled it first,
     * nothing is counted here; a failure this run records is written to the
     * audit log, once, since only one run records it.
     */
    private async record(
        attempt: InvoiceCollectionRecord,
        outcome: CollectionOutcome,
        run: InvoiceCollectionRun,
    ): Promise<void> {
        if (!(await this.collections.recordOutcome(attempt.id, outcome, new Date()))) return;
        if (outcome.status === 'succeeded') {
            run.collected += 1;
            this.logger.log(
                `Invoice ${attempt.invoiceNumber} was collected (${attempt.attemptKey}).`,
            );
            return;
        }
        if (outcome.status === 'pending') {
            run.pending += 1;
            return;
        }
        run.failed += 1;
        this.logger.warn(
            `Invoice ${attempt.invoiceNumber} was not collected (${attempt.attemptKey}): ` +
                `${outcome.reason}${outcome.gatewayCode ? ` (${outcome.gatewayCode})` : ''}.`,
        );
        await this.writeAudit(attempt.invoiceId, {
            action: 'SUBSCRIPTION_INVOICE_COLLECTION_FAILED',
            changes: {
                number: attempt.invoiceNumber,
                attempt: attempt.attempt,
                reason: outcome.reason,
                gatewayCode: outcome.gatewayCode,
            },
        });
    }

    /** Logs a request whose answer is unknown; a run after the lease asks the gateway about it. */
    private unanswered(attempt: InvoiceCollectionRecord, what: string, error: unknown): void {
        this.logger.error(
            `The gateway of '${attempt.gatewayAccount}' ${what} for collection attempt ` +
                `${attempt.attemptKey}; a run after ${INVOICE_COLLECTION_LEASE_MS / 60_000} minutes ` +
                'asks it what became of it before anything is sent again.',
            error instanceof Error ? error.stack : String(error),
        );
    }

    private async recordWaiting(
        invoice: SubscriptionInvoiceRecord,
        waiting: Waiting,
    ): Promise<void> {
        this.logger.warn(
            `Invoice ${invoice.number} is not collected as it announced: ${waiting.code} ` +
                `${JSON.stringify(waiting.params)}.`,
        );
        await this.audited.record(`${invoice.id}|${waiting.code}`, () =>
            this.writeAudit(invoice.id, {
                action: 'SUBSCRIPTION_INVOICE_COLLECTION_WAITING',
                changes: { number: invoice.number, ...waiting },
            }),
        );
    }

    /**
     * Writes an audit entry about an invoice; `true` where it was written or
     * there is no audit log. A write that fails is said loudly and leaves the
     * collection as it stands.
     */
    private async writeAudit(invoiceId: string, entry: CollectionAudit): Promise<boolean> {
        try {
            await this.audit?.log({
                actor: platformJobActor(JOB),
                entity: 'SubscriptionInvoice',
                entityId: invoiceId,
                action: entry.action,
                changes: entry.changes,
            });
            return true;
        } catch (error) {
            this.logger.error(
                `Writing the audit entry ${entry.action} for invoice ${invoiceId} failed.`,
                error instanceof Error ? error.stack : String(error),
            );
            return false;
        }
    }

    /** The account an attempt goes to; one the configuration no longer names is not reachable. */
    private accountOf(name: string): PaymentGatewayAccount {
        const account = this.gateways!.account(name);
        if (!account) {
            throw new Error(
                `The payment account '${name}' is not configured, and holds a collection.`,
            );
        }
        return account;
    }

    private timeZone(): string {
        // Required with a tax adapter, which invoicing requires.
        return this.settings.timeZone!;
    }

    private async eachPage(
        list: (page: { limit: number; after?: string }) => Promise<string[]>,
        each: (id: string) => Promise<void>,
    ): Promise<void> {
        let after: string | undefined;
        for (;;) {
            const page = await list({ limit: PAGE_SIZE, after });
            for (const id of page) {
                await each(id).catch((error: unknown) => {
                    this.logger.error(
                        `The collection of ${id} could not be handled; the next run tries again.`,
                        error instanceof Error ? error.stack : String(error),
                    );
                });
            }
            if (page.length < PAGE_SIZE) return;
            after = page.at(-1);
        }
    }
}

/** The request an attempt makes, the same however often it is sent. */
function requestOf(attempt: InvoiceCollectionRecord): CollectInvoiceInput {
    return {
        attemptKey: attempt.attemptKey,
        invoiceId: attempt.invoiceId,
        invoiceNumber: attempt.invoiceNumber,
        amountCents: toCents(attempt.amount),
        currency: attempt.currency,
        customerRef: attempt.customerRef,
        paymentMethodRef: attempt.paymentMethodRef,
        type: attempt.paymentMethodType,
    };
}
