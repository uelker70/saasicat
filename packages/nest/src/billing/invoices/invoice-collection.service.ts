// The run that collects the invoices that announced how they are paid, and
// decides what follows when a collection fails or its payment is reversed
// (`SC-PRIC-080`, `SC-PRIC-082`, `SC-PRIC-085`).
//
// It first takes on the attempts that are not settled: one whose answer was
// lost is asked about at the gateway, and sent again as the same request under
// the same key only where the gateway holds nothing under it; a direct debit
// on its way is asked about once an hour (`SC-PRIC-034`).
//
// It collects the invoices that reached the subscriber and have no attempt
// yet: by card at once, by direct debit from the day the invoice announced. One
// whose payment method in use is another than it named, or whose direct debit
// reached the subscriber less than the lead time before its day, is planned
// instead.
//
// It then follows each failure up, once: where the reason can pass the same
// payment method is planned once more, where another payment method replaced
// it that one is planned, and the subscriber's notice is recorded from what
// was planned. A reversal that opened an invoice again is followed up as well,
// once no other attempt of the invoice is on its way: the subscriber's notice
// is recorded, and nothing of the invoice is planned again with a payment
// method one of its payments was reversed on. An invoice whose last attempt
// failed or was reversed and was followed up, or was withdrawn, is planned
// again once its subscriber uses another payment method.
//
// It tells the subscriber of every failure and reversal not yet told, and last takes up
// what is planned. A planned attempt whose payment method is no longer in use
// is withdrawn; a planned direct debit is announced to the subscriber first —
// after the failure before it reached them — and its day is fixed when the
// announcement goes out, the lead time after and never earlier than planned,
// so it cannot be announced too late (`SC-PRIC-028`); what is due is sent.
//
// Each attempt is started or taken up in the invoice's turn and written as
// submitted before its request leaves (`SC-PRIC-036`), so of several instances
// one sends it, and a request that left is never followed by a second one under
// a new key without the gateway having been asked. What the subscriber is told
// goes to their invoice email and is recorded with the other notices, each
// once; one not sent is tried again by the next run.
//
// Platform-wide, so inside `RlsBypassPort`.

import {
    Inject,
    Injectable,
    Logger,
    type OnApplicationBootstrap,
    type OnModuleInit,
    Optional,
} from '@nestjs/common';
import {
    COLLECTION_NOT_SENT_REVERSED,
    INVOICE_COLLECTION_ASK_EVERY_MS,
    INVOICE_COLLECTION_LEASE_MS,
    INVOICE_ERROR_CODES,
    UNSETTLED_COLLECTION_STATUSES,
    addDaysToDay,
    announcedCollectionDay,
    chargedAgainOn,
    dayInZone,
    directDebitLeadDaysOf,
    isChargedAgain,
    sentCollectionOf,
    toCents,
    toCollectionAnnouncedNotice,
    toCollectionFailedNotice,
    toCollectionReversedNotice,
    type CalendarDay,
    type CollectInvoiceInput,
    type CollectionAnnouncedNotice,
    type CollectionFailedNotice,
    type CollectionReversedNotice,
    type CollectionFailureNext,
    type CollectionFailureReason,
    type CollectionOutcome,
    type InvoiceCollectionNotice,
    type InvoiceCollectionRecord,
    type InvoiceCollectionRepository,
    type InvoiceMailPort,
    type PaymentMethodType,
    type PlanCatalogSettings,
    type RlsBypassPort,
    type SubmittedInvoiceCollection,
    type SubscriberPaymentMethodRecord,
    type SubscriberPaymentMethodRepository,
    type SubscriptionInvoiceDocumentRecord,
    type SubscriptionInvoiceRecord,
    type SubscriptionInvoiceRepository,
    type SubscriptionNoticeDelivery,
    type SubscriptionNoticeRecord,
    type SubscriptionNoticeRepository,
    type TransactionRunner,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { AdminAuditService, platformJobActor } from '../../admin/admin-audit.service.js';
import { readAcrossTenants } from '../../admin/read-across-tenants.js';
import { withTimeout } from '../../core/with-timeout.js';
import {
    PaymentGatewayRegistry,
    type PaymentGatewayAccount,
} from '../../payments/payment-gateway-registry.js';
import {
    PAYMENT_TRANSACTION_RUNNER_TOKEN,
    SUBSCRIBER_PAYMENT_METHOD_REPOSITORY_TOKEN,
} from '../../payments/payments.tokens.js';
import { SubscriberService } from '../../subscriber/subscriber.service.js';
import {
    NOTICE_CLAIM_LEASE_MS,
    NOTICE_DELIVERY_TIMEOUT_MS,
    NoticeSender,
} from '../notice-sender.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from '../plan-catalog.module.js';
import { AuditedOnce } from './audited-once.js';
import { INVOICE_MAIL_PORT_TOKEN } from './invoice-document.tokens.js';
import {
    INVOICE_COLLECTION_NOTICE_REPOSITORY_TOKEN,
    INVOICE_COLLECTION_REPOSITORY_TOKEN,
} from './invoice-collection.tokens.js';
import { InvoicePaymentService } from './invoice-payment.service.js';
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
    /** Attempts planned: after a failure, or with another payment method than the one tried. */
    planned: number;
    /** Planned direct debits announced to the subscriber. */
    announced: number;
    /** Failures the subscriber was told of. */
    told: number;
    /** Invoices nothing can collect yet, which wait for a payment method. */
    waiting: number;
    /** Requests without an answer; each is asked about by a run after the lease. */
    unanswered: number;
}

/** Why an invoice is not collected or announced yet: the coded reason and what it names. */
type Waiting =
    | {
          code: typeof INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_NO_PAYMENT_METHOD;
          params: { subscriberId: string };
      }
    | {
          code: typeof INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_MANDATE_MISSING;
          params: { paymentMethodId: string };
      }
    | {
          code: typeof INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_FAILURE_NOT_TOLD;
          params: { attemptKey: string };
      };

/** Why an attempt was planned rather than sent at once. */
type PlannedBecause =
    /** The same payment method, once more after a failure whose reason can pass. */
    | 'retry'
    /** The payment method in use is another than the invoice named, or than the one tried. */
    | 'payment-method-replaced'
    /** The invoice reached the subscriber less than the lead time before its direct debit's day. */
    | 'announced-too-late';

/** What an audit entry about a collection records. */
type CollectionAudit =
    | {
          action: 'SUBSCRIPTION_INVOICE_COLLECTION_PLANNED';
          changes: {
              number: string;
              attempt: number;
              paymentMethodType: PaymentMethodType;
              collectOn: CalendarDay;
              because: PlannedBecause;
          };
      }
    | {
          action: 'SUBSCRIPTION_INVOICE_COLLECTION_ANNOUNCED';
          changes: { number: string; attempt: number; collectOn: CalendarDay };
      }
    | {
          action: 'SUBSCRIPTION_INVOICE_COLLECTION_WITHDRAWN';
          changes: {
              number: string;
              attempt: number;
              paymentMethodId: string;
              /** The invoice owes nothing any more, or its payment method was replaced. */
              because: 'paid' | 'payment-method-replaced';
          };
      }
    | {
          action: 'SUBSCRIPTION_INVOICE_COLLECTION_ABANDONED';
          changes: { number: string; attempt: number };
      }
    | {
          action: 'SUBSCRIPTION_INVOICE_COLLECTION_WAITING';
          changes: { number: string } & Waiting;
      };

@Injectable()
export class InvoiceCollectionService implements OnModuleInit, OnApplicationBootstrap {
    private readonly logger = new Logger(InvoiceCollectionService.name);
    private readonly audited = new AuditedOnce();
    private readonly timeoutMs = INVOICE_COLLECTION_TIMEOUT_MS;
    /** Sends what the subscriber is told, once each: through the mail port, to the invoice email. */
    private readonly sender: NoticeSender<InvoiceCollectionNotice> | null;

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
        // Required to start as well, for what the subscriber is told.
        @Optional()
        @Inject(INVOICE_COLLECTION_NOTICE_REPOSITORY_TOKEN)
        private readonly notices: SubscriptionNoticeRepository | null = null,
        @Optional()
        @Inject(INVOICE_MAIL_PORT_TOKEN)
        private readonly mail: InvoiceMailPort | null = null,
        @Optional()
        @Inject(SubscriberService)
        private readonly subscribers: SubscriberService | null = null,
        // What a collection brought is recorded with its outcome, on one
        // transaction; both are required to start, like the gateways.
        @Optional()
        @Inject(InvoicePaymentService)
        private readonly payments: InvoicePaymentService | null = null,
        @Optional()
        @Inject(PAYMENT_TRANSACTION_RUNNER_TOKEN)
        private readonly transactions: TransactionRunner | null = null,
    ) {
        this.sender = notices
            ? new NoticeSender<InvoiceCollectionNotice>(notices, {
                  deliver: (notice) => this.mailNotice(notice),
              })
            : null;
    }

    /**
     * Refuses to start without the gateways and the payment methods — an
     * invoice is collected through the account its payment method is held at
     * — and without what tells the subscriber: the record of notices, the
     * invoice mail and the subscribers' invoice email.
     */
    onModuleInit(): void {
        const problems: string[] = [];
        if (
            !this.gateways ||
            !this.paymentMethods ||
            !this.transactions ||
            !this.settings.payments
        ) {
            problems.push(
                'collecting invoices needs the payment accounts under payments in ' +
                    'config/saas.yaml and PaymentsModule, wired globally as it is by default, ' +
                    'which binds a gateway for each account.',
            );
        }
        if (!this.payments) {
            problems.push(
                'collecting invoices records what each collection brought: pass ' +
                    'chargeJournal.invoices.payments, such as ' +
                    'persistence.entitlement.subscriberPaymentRepository.',
            );
        }
        if (!this.notices || !this.mail || !this.subscribers) {
            problems.push(
                'collecting invoices tells the subscriber of a failure and announces a direct ' +
                    'debit again: pass chargeJournal.invoices.notices, such as ' +
                    'persistence.tenantBilling.subscriptionNotices, beside chargeJournal.invoices.mail.',
            );
        }
        if (problems.length === 0) return;
        throw new Error(
            `Invoices cannot start:\n${problems.map((problem) => `- ${problem}`).join('\n')}`,
        );
    }

    /**
     * Refuses the start where an attempt that is not settled was sent to an
     * account the configuration no longer names: only that account can say
     * what became of it, so it would stay open for good, and a direct debit
     * on its way can still be collected or returned there (`SC-PRIC-030`).
     * Read platform-wide, at a boot with no tenant, through the RLS bypass.
     */
    async onApplicationBootstrap(): Promise<void> {
        const held = await readAcrossTenants(this.rlsBypass, () =>
            this.collections.accountsInUse(),
        );
        const unconfigured = this.gateways!.unconfigured(held);
        if (unconfigured.length === 0) return;
        throw new Error(
            `Collections not settled are held at ${unconfigured.map((name) => `'${name}'`).join(', ')}, ` +
                'which config/saas.yaml#payments.accounts no longer names. List each account again, ' +
                'with its gateway bound, until its collections have settled.',
        );
    }

    /**
     * Settles what is open, collects or plans every invoice due on the day of
     * `now`, decides what follows a failure, tells the subscriber of the
     * failures still untold, and takes up what is planned. What is open is judged by the
     * clock, which stamps every hold, and not by `now`: a cutoff from another
     * clock than the stamp's lets two runs take the same attempt on wherever
     * `now` runs ahead of it. `now` names the day.
     */
    async collectDue(now: Date): Promise<InvoiceCollectionRun> {
        return readAcrossTenants(this.rlsBypass, async () => {
            const run: InvoiceCollectionRun = {
                collected: 0,
                pending: 0,
                failed: 0,
                planned: 0,
                announced: 0,
                told: 0,
                waiting: 0,
                unanswered: 0,
            };
            const before = unsettledBefore(new Date());
            await this.eachPage(
                (page) => this.collections.listUnsettled(before, page),
                (id) => this.settleOne(id, run),
            );
            const today = dayInZone(now, this.timeZone());
            await this.eachPage(
                (page) => this.collections.listDue(today, page),
                (invoiceId) => this.collectOne(invoiceId, today, run),
            );
            // A replacement is planned before the failures are followed up, so a
            // failure whose plan was withdrawn is told from its replacement in
            // the same run.
            await this.eachPage(
                (page) => this.collections.listCollectableAgain(page),
                (invoiceId) => this.planAgain(invoiceId, today, run),
            );
            // After the first collections, so a failure among them is told,
            // and what follows it planned, in the same run.
            await this.eachPage(
                (page) => this.collections.listToFollowUp(page),
                (id) => this.followUp(id, today, run),
            );
            // Before what is planned, so the subscriber hears of a failure
            // before the direct debit announced again after it.
            await this.tellUntold(run);
            await this.eachPage(
                (page) => this.collections.listPlanned(page),
                (id) => this.takeUp(id, today, run),
            );
            return run;
        });
    }

    /**
     * Collects an invoice that has no attempt yet, as it announced: with the
     * payment method it named, from the day it named. Where that is not how
     * it can be collected, the collection is planned instead.
     */
    private async collectOne(
        invoiceId: string,
        today: CalendarDay,
        run: InvoiceCollectionRun,
    ): Promise<void> {
        const invoice = await this.invoiceOf(invoiceId);
        const document = await this.invoices.findDocument(invoiceId);
        if (!invoice.payment || !document) {
            throw new Error(
                `Invoice ${invoiceId} is due for collection and has no payment or mail.`,
            );
        }
        const method = await this.paymentMethods!.findActive(invoice.subscriberId);
        if (!method) {
            await this.recordWaiting(invoice, noPaymentMethod(invoice), run);
            return;
        }
        if (method.id !== invoice.payment.paymentMethodId) {
            await this.planWith(invoice, 0, method, today, 'payment-method-replaced', run);
            return;
        }
        if (this.announcedTooLate(invoice, document)) {
            await this.planWith(invoice, 0, method, today, 'announced-too-late', run);
            return;
        }
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
            amount: await this.recording().payments.owed(invoice.id),
            currency: invoice.currency,
            at: new Date(),
        });
        // Another instance started it first, or one of its attempts is open.
        if (!attempt) return;
        await this.send(this.accountOf(method.gatewayAccount), sentCollectionOf(attempt), run);
    }

    /**
     * Whether a direct debit cannot be collected on the day its invoice
     * announced: the invoice reached the subscriber less than the lead time
     * before that day, as `config/saas.yaml` names it now.
     */
    private announcedTooLate(
        invoice: SubscriptionInvoiceRecord,
        document: SubscriptionInvoiceDocumentRecord,
    ): boolean {
        if (invoice.collectionDate === null || !document.deliveredAt) return false;
        const deliveredOn = dayInZone(document.deliveredAt, this.timeZone());
        return addDaysToDay(deliveredOn, this.leadDays()) > invoice.collectionDate;
    }

    /** Decides what follows a failed or a reversed attempt, once. */
    private async followUp(
        id: string,
        today: CalendarDay,
        run: InvoiceCollectionRun,
    ): Promise<void> {
        const attempt = await this.collections.findById(id);
        if (attempt?.status === 'REVERSED') {
            await this.followUpReversal(attempt);
            return;
        }
        await this.followUpFailure(id, today, run);
    }

    /**
     * Decides what follows a reversal that opened the attempt's invoice again,
     * once: records what the subscriber is told — the invoice open again, and
     * that it is collected with the payment method now in use where another
     * replaced the reversed one, or otherwise asked for a replacement — and
     * marks the attempt. Nothing is planned here: the invoice is planned again,
     * with another payment method only, once it is followed up. Where the
     * invoice owes nothing by now — the gateway gave the reversal back, or the
     * subscriber paid —, nobody is told.
     *
     * The invoice open again is the one that stands in the chain of the
     * attempt's: the replacement, where the invoice it collected was cancelled
     * since and the reversal opened the replacement by the payment's share
     * (`SC-PRIC-085`).
     */
    private async followUpReversal(reversed: InvoiceCollectionRecord): Promise<void> {
        if (reversed.followedUpAt !== null) return;
        const standingId = await this.standingIdOf(reversed.invoiceId);
        const owed = standingId === null ? 0 : await this.recording().payments.owed(standingId);
        if (standingId === null || owed <= 0) {
            await this.collections.markFollowedUp(reversed.id, new Date());
            return;
        }
        const attempts = await this.collections.listByInvoice(reversed.invoiceId);
        const ofStanding =
            standingId === reversed.invoiceId
                ? []
                : await this.collections.listByInvoice(standingId);
        // Attempts reversed together — the one whose payment was taken back,
        // and one that succeeded beside it — tell the subscriber once, from the
        // latest of them.
        const reversedAt = reversed.resolvedAt?.getTime() ?? 0;
        const toldByALater = attempts.some(
            (each) =>
                each.status === 'REVERSED' &&
                each.attempt > reversed.attempt &&
                (each.followedUpAt === null || each.followedUpAt.getTime() >= reversedAt),
        );
        if (toldByALater) {
            await this.collections.markFollowedUp(reversed.id, new Date());
            return;
        }
        // Another attempt on its way may still pay the invoice: the subscriber
        // is told once it settled, so the notice says what follows.
        if (
            [...attempts, ...ofStanding].some((each) =>
                UNSETTLED_COLLECTION_STATUSES.includes(each.status),
            )
        ) {
            return;
        }
        const invoice = await this.invoiceOf(standingId);
        const method = await this.paymentMethods!.findActive(invoice.subscriberId);
        const notice: CollectionReversedNotice = {
            kind: 'collection-reversed',
            ...aboutInvoice(invoice),
            paymentMethodType: reversed.paymentMethodType,
            owed,
            // What `planAgain` will do: collect with the payment method in use
            // where neither the last attempt nor a reversal was made with it.
            next:
                method &&
                method.id !== [...attempts, ...ofStanding].at(-1)?.paymentMethodId &&
                !reversedOn([...attempts, ...ofStanding]).has(method.id)
                    ? { action: 'collected-with-payment-method-in-use' }
                    : { action: 'replace-payment-method' },
        };
        await this.notices!.record(
            [
                {
                    tenantId: invoice.tenantId,
                    subscriptionId: invoice.subscriptionId,
                    kind: 'collection-reversed',
                    subject: reversed.attemptKey,
                    content: notice,
                },
            ],
            new Date(),
        );
        await this.collections.markFollowedUp(reversed.id, new Date());
    }

    /**
     * The invoice that stands in the chain of `invoiceId`: itself where it is
     * not cancelled, otherwise the replacement of its cancellation, followed on
     * where that is cancelled as well; `null` where a cancellation left none
     * (`SC-PRIC-036`).
     */
    private async standingIdOf(invoiceId: string): Promise<string | null> {
        let standing = invoiceId;
        for (;;) {
            const cancellation = await this.invoices.findCancellation(standing);
            if (!cancellation || cancellation.cancelledInvoiceId !== standing) return standing;
            if (cancellation.replacementInvoiceId === null) return null;
            standing = cancellation.replacementInvoiceId;
        }
    }

    /**
     * Decides what follows a failure, once: plans the next attempt where one
     * is made, then records what the subscriber is told from the attempt that
     * follows — the one planned now, or the one a run that stopped before it
     * recorded the notice planned — and marks the failure last. So the notice
     * always says what was planned, and a run that stops anywhere leaves the
     * failure to be followed up again with the same outcome.
     */
    private async followUpFailure(
        id: string,
        today: CalendarDay,
        run: InvoiceCollectionRun,
    ): Promise<void> {
        const failed = await this.collections.findById(id);
        if (failed?.status !== 'FAILED' || failed.followedUpAt !== null) return;
        // A payment came for the invoice — a late one beside this attempt —, or
        // it was cancelled since and owes nothing: nothing follows, and there
        // is no failure left to tell; a replacement is collected with an
        // announcement of its own. Nor where a payment of the invoice was
        // reversed on this payment method: the reversal's notice tells the
        // subscriber what follows, once.
        if (
            !(await this.recording().payments.owes(failed.invoiceId)) ||
            reversedOn(await this.collections.listByInvoice(failed.invoiceId)).has(
                failed.paymentMethodId,
            )
        ) {
            await this.collections.markFollowedUp(failed.id, new Date());
            return;
        }
        const invoice = await this.invoiceOf(failed.invoiceId);
        const next = await this.attemptAfter(invoice, failed, today, run);
        // Not settled yet: followed up again once the replacement is planned.
        if (next === undefined) return;
        const notice: CollectionFailedNotice = {
            kind: 'collection-failed',
            ...aboutInvoice(invoice),
            paymentMethodType: failed.paymentMethodType,
            reason: failureOf(failed).reason,
            next: toldNext(next),
        };
        await this.notices!.record(
            [
                {
                    tenantId: invoice.tenantId,
                    subscriptionId: invoice.subscriptionId,
                    kind: 'collection-failed',
                    subject: failed.attemptKey,
                    content: notice,
                },
            ],
            new Date(),
        );
        await this.collections.markFollowedUp(failed.id, new Date());
    }

    /**
     * The attempt that follows `failed`: the first one after it that still
     * stands — planned by an earlier run, or now with the payment method in
     * use — or `null` where none is made until the payment method is replaced.
     * `undefined` where that is not settled yet: the attempt after it was
     * planned with a payment method no longer in use, or withdrawn for that,
     * and the one in use is planned in its place by a run to come.
     */
    private async attemptAfter(
        invoice: SubscriptionInvoiceRecord,
        failed: InvoiceCollectionRecord,
        today: CalendarDay,
        run: InvoiceCollectionRun,
    ): Promise<InvoiceCollectionRecord | null | undefined> {
        const later = (attempts: readonly InvoiceCollectionRecord[]) =>
            attempts.filter((each) => each.attempt > failed.attempt);
        const attempts = await this.collections.listByInvoice(invoice.id);
        const active = await this.paymentMethods!.findActive(invoice.subscriberId);
        const method = active && !reversedOn(attempts).has(active.id) ? active : null;
        const after = later(attempts);
        const standing = after.find((each) => each.status !== 'WITHDRAWN');
        if (
            standing &&
            (standing.status !== 'SCHEDULED' || standing.paymentMethodId === method?.id)
        ) {
            return standing;
        }
        if (standing || after.length > 0) return method ? undefined : null;
        const decided =
            method && this.nextAfter(failed, attempts, method, failureOf(failed).failedAt, today);
        if (!method || !decided) return null;
        const planned = await this.planWith(
            invoice,
            failed.attempt,
            method,
            decided.collectOn,
            decided.because,
            run,
        );
        // Where another run planned first, the next run follows its plan up.
        return planned ?? undefined;
    }

    /**
     * Plans an invoice with the payment method that replaced the one its last
     * attempt was made with: after a failure that was followed up, or after a
     * plan was withdrawn. The payment method in use is read again, since it
     * may have changed since the invoice was listed.
     */
    private async planAgain(
        invoiceId: string,
        today: CalendarDay,
        run: InvoiceCollectionRun,
    ): Promise<void> {
        const attempts = await this.collections.listByInvoice(invoiceId);
        const last = attempts.at(-1);
        const ended =
            last?.status === 'WITHDRAWN' ||
            ((last?.status === 'FAILED' || last?.status === 'REVERSED') &&
                last.followedUpAt !== null);
        const untold = attempts.some(
            (each) => each.status === 'REVERSED' && each.followedUpAt === null,
        );
        if (!last || !ended || untold) return;
        const invoice = await this.invoiceOf(invoiceId);
        const method = await this.paymentMethods!.findActive(invoice.subscriberId);
        if (!method || method.id === last.paymentMethodId || reversedOn(attempts).has(method.id)) {
            return;
        }
        await this.planWith(invoice, last.attempt, method, today, 'payment-method-replaced', run);
    }

    /**
     * The attempt that follows a failure where the subscriber has `method` in
     * use: one with it where it replaced the payment method that failed, the
     * same one once more seven days after where the reason can pass, and
     * otherwise none until the payment method is replaced.
     */
    private nextAfter(
        failed: InvoiceCollectionRecord,
        attempts: readonly InvoiceCollectionRecord[],
        method: SubscriberPaymentMethodRecord,
        failedAt: Date,
        today: CalendarDay,
    ): { collectOn: CalendarDay; because: PlannedBecause } | null {
        if (method.id !== failed.paymentMethodId) {
            return { collectOn: today, because: 'payment-method-replaced' };
        }
        if (!isChargedAgain(failed, attempts)) return null;
        return {
            collectOn: chargedAgainOn(dayInZone(failedAt, this.timeZone())),
            because: 'retry',
        };
    }

    /**
     * Plans the invoice's next attempt with `method`, from `collectOn`, as the
     * one after attempt `after` — the last this run read, so a decision made
     * from attempts another run has added to since plans nothing — and
     * returns it, or `null` where nothing was planned.
     */
    private async planWith(
        invoice: SubscriptionInvoiceRecord,
        after: number,
        method: SubscriberPaymentMethodRecord,
        collectOn: CalendarDay,
        because: PlannedBecause,
        run: InvoiceCollectionRun,
    ): Promise<InvoiceCollectionRecord | null> {
        const planned = await this.collections.plan({
            invoiceId: invoice.id,
            after,
            gatewayAccount: method.gatewayAccount,
            paymentMethodId: method.id,
            paymentMethodType: method.type,
            customerRef: method.customerRef,
            paymentMethodRef: method.paymentMethodRef,
            invoiceNumber: invoice.number,
            amount: await this.recording().payments.owed(invoice.id),
            currency: invoice.currency,
            collectOn,
        });
        // Another instance planned it first, or one of its attempts is open.
        if (!planned) return null;
        run.planned += 1;
        await this.writeAudit(invoice.id, {
            action: 'SUBSCRIPTION_INVOICE_COLLECTION_PLANNED',
            changes: {
                number: invoice.number,
                attempt: planned.attempt,
                paymentMethodType: method.type,
                collectOn,
                because,
            },
        });
        return planned;
    }

    /**
     * Takes up a planned attempt: withdraws it where its payment method is no
     * longer in use, announces a direct debit not announced yet, and sends it
     * on its day.
     */
    private async takeUp(id: string, today: CalendarDay, run: InvoiceCollectionRun): Promise<void> {
        const attempt = await this.collections.findById(id);
        if (attempt?.status !== 'SCHEDULED') return;
        const invoice = await this.invoiceOf(attempt.invoiceId);
        const method = await this.paymentMethods!.findActive(invoice.subscriberId);
        const paid = !(await this.recording().payments.owes(invoice.id));
        if (paid || method?.id !== attempt.paymentMethodId) {
            if (!(await this.collections.withdraw(id, new Date()))) return;
            await this.writeAudit(invoice.id, {
                action: 'SUBSCRIPTION_INVOICE_COLLECTION_WITHDRAWN',
                changes: {
                    number: invoice.number,
                    attempt: attempt.attempt,
                    paymentMethodId: attempt.paymentMethodId,
                    because: paid ? 'paid' : 'payment-method-replaced',
                },
            });
            return;
        }
        if (attempt.paymentMethodType === 'sepa_debit' && attempt.announcedAt === null) {
            await this.announce(attempt, invoice, method, today, run);
            return;
        }
        if (plannedDayOf(attempt) > today) return;
        const submitted = await this.collections.submitPlanned(id, new Date());
        // Another run took it up first.
        if (!submitted) return;
        await this.send(this.accountOf(submitted.gatewayAccount), submitted, run);
    }

    /**
     * Announces a planned direct debit to the subscriber, for the day the lead
     * time after this one, and not before the day it was planned for; that day
     * is recorded once the announcement went out (`SC-PRIC-028`). One that went
     * out without being recorded — a run that stopped in between — is recorded
     * from what was sent.
     */
    private async announce(
        attempt: InvoiceCollectionRecord,
        invoice: SubscriptionInvoiceRecord,
        method: SubscriberPaymentMethodRecord,
        today: CalendarDay,
        run: InvoiceCollectionRun,
    ): Promise<void> {
        if (!method.mandateReference) {
            await this.recordWaiting(
                invoice,
                {
                    code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_MANDATE_MISSING,
                    params: { paymentMethodId: method.id },
                },
                run,
            );
            return;
        }
        // The failures and reversals first, then what was told: each is
        // recorded before the plan this announces, so every one is read, and a
        // notice recorded between the two reads is among what was told.
        const attempts = await this.collections.listByInvoice(invoice.id);
        const told = await this.notices!.listForSubscription(invoice.subscriptionId);
        const untold = untoldFailure(attempts, told);
        if (untold) {
            await this.recordWaiting(
                invoice,
                {
                    code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_FAILURE_NOT_TOLD,
                    params: { attemptKey: untold.attemptKey },
                },
                run,
            );
            return;
        }
        const notice: CollectionAnnouncedNotice = {
            kind: 'collection-announced',
            ...aboutInvoice(invoice),
            collectOn: announcedCollectionDay(plannedDayOf(attempt), today, this.leadDays()),
            mandateReference: method.mandateReference,
            last4: method.last4,
        };
        const outcome = await this.sender!.tell(
            notice,
            attempt.attemptKey,
            NOTICE_DELIVERY_TIMEOUT_MS,
        );
        if (outcome === 'told') {
            await this.recordAnnounced(attempt, invoice, notice.collectOn, new Date(), run);
            return;
        }
        if (outcome !== null) return;
        const sent = told.find(
            (record) =>
                record.kind === 'collection-announced' &&
                record.subject === attempt.attemptKey &&
                record.deliveredAt !== null,
        );
        if (!sent?.deliveredAt) return;
        const collectOn = toCollectionAnnouncedNotice(sent.content, sent.id).collectOn;
        await this.recordAnnounced(attempt, invoice, collectOn, sent.deliveredAt, run);
    }

    private async recordAnnounced(
        attempt: InvoiceCollectionRecord,
        invoice: SubscriptionInvoiceRecord,
        collectOn: CalendarDay,
        at: Date,
        run: InvoiceCollectionRun,
    ): Promise<void> {
        if (!(await this.collections.announce(attempt.id, collectOn, at))) return;
        run.announced += 1;
        await this.writeAudit(invoice.id, {
            action: 'SUBSCRIPTION_INVOICE_COLLECTION_ANNOUNCED',
            changes: { number: invoice.number, attempt: attempt.attempt, collectOn },
        });
    }

    /**
     * Sends the failures and reversals not told yet: recorded, and not sent,
     * or sent and not answered. One that cannot be read or sent is said in the
     * log and left for the next run, and the others go on.
     */
    private async tellUntold(run: InvoiceCollectionRun): Promise<void> {
        const staleBefore = new Date(Date.now() - NOTICE_CLAIM_LEASE_MS);
        for (const { kind, read, about } of TOLD_BY_THE_RUN) {
            const untold = await this.notices!.listUndelivered(kind, staleBefore);
            for (const record of untold) {
                try {
                    const outcome = await this.sender!.tell(
                        read(record.content, record.id),
                        record.subject,
                        NOTICE_DELIVERY_TIMEOUT_MS,
                    );
                    if (outcome === 'told') run.told += 1;
                } catch (error) {
                    this.logger.error(
                        `The notice ${record.id} of ${about} could not be sent; the next run ` +
                            'tries again.',
                        error instanceof Error ? error.stack : String(error),
                    );
                }
            }
        }
    }

    /** Hands a notice to the mail port, for the subscriber's invoice email. */
    private async mailNotice(notice: InvoiceCollectionNotice): Promise<SubscriptionNoticeDelivery> {
        const subscriber = await this.subscribers!.getById(notice.subscriberId);
        const to = subscriber.invoiceEmail;
        if (!to) {
            throw new Error(
                `Subscriber ${notice.subscriberId} has no invoice email to tell of ` +
                    `${notice.kind} for invoice ${notice.invoiceNumber}.`,
            );
        }
        await this.mail!.tell({ notice, to });
        return { recipients: [to], channel: 'email' };
    }

    /**
     * Takes on an attempt that is not settled — where no other run took it on
     * since the lease or the last question — and finds out what became of it:
     * from the gateway, and where the gateway holds nothing under its key, by
     * sending the same request again.
     */
    private async settleOne(id: string, run: InvoiceCollectionRun): Promise<void> {
        const found = await this.collections.findById(id);
        if (!found) return;
        const attempt = sentCollectionOf(found);
        // Judged from the moment the hold is stamped with, so that a hold
        // lasts the lease on one clock.
        const at = new Date();
        const before = unsettledBefore(at);
        const heldBefore =
            attempt.status === 'SUBMITTED' ? before.submittedBefore : before.pendingBefore;
        if (!(await this.collections.hold(id, heldBefore, at))) return;
        const account = this.accountOf(attempt.gatewayAccount);
        let answer: CollectionOutcome | null;
        try {
            answer = await withTimeout(
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
        if (answer) {
            await this.record(attempt, answer, run);
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
        // The request never reached the gateway. Where a payment came for the
        // invoice meanwhile — a late one for an earlier attempt —, nothing is
        // sent again, and nothing where a report settled the attempt in the
        // meantime; otherwise the same request, under the same key, cannot
        // charge twice. A report that arrives after the decision names a
        // request the gateway holds, and a repeat under its key creates
        // nothing new (`PaymentGateway.collect`). Nor is it sent where a
        // payment of the invoice was reversed on its payment method since:
        // that would collect with it again.
        const decided = await this.collections.abandonPaid(attempt.id, new Date());
        if (decided === 'settled') return;
        if (
            decided === 'resend' &&
            reversedOn(await this.collections.listByInvoice(attempt.invoiceId)).has(
                attempt.paymentMethodId,
            )
        ) {
            await this.collections.recordOutcome(
                attempt.id,
                COLLECTION_NOT_SENT_REVERSED,
                new Date(),
            );
            return;
        }
        if (decided === 'abandoned') {
            this.logger.log(
                `Collection attempt ${attempt.attemptKey} is not sent again: invoice ` +
                    `${attempt.invoiceNumber} was paid meanwhile.`,
            );
            await this.writeAudit(attempt.invoiceId, {
                action: 'SUBSCRIPTION_INVOICE_COLLECTION_ABANDONED',
                changes: { number: attempt.invoiceNumber, attempt: attempt.attempt },
            });
            return;
        }
        await this.send(account, attempt, run);
    }

    /** Sends the attempt's request and records the answer; no answer leaves it to a later run. */
    private async send(
        account: PaymentGatewayAccount,
        attempt: SubmittedInvoiceCollection,
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
     * Records what became of an attempt, with the payment a success brought,
     * on one transaction. Where another run or the gateway's callback settled
     * it first, nothing is counted here; what this run recorded is logged and
     * audited once, since only one report records it. What follows a failure
     * is decided by the next run that follows the invoice up.
     */
    private async record(
        attempt: InvoiceCollectionRecord,
        outcome: CollectionOutcome,
        run: InvoiceCollectionRun,
    ): Promise<void> {
        const { payments, transactions } = this.recording();
        const recorded = await transactions.run((tx) =>
            payments.recordOutcome(attempt, outcome, tx),
        );
        await payments.reportOutcome(attempt, outcome, recorded);
        if (!recorded.settled) return;
        if (outcome.status === 'succeeded') run.collected += 1;
        else if (outcome.status === 'pending') run.pending += 1;
        else run.failed += 1;
    }

    /** What records an outcome, which the start made sure of. */
    private recording(): { payments: InvoicePaymentService; transactions: TransactionRunner } {
        const { payments, transactions } = this;
        if (!payments || !transactions) {
            throw new Error('Collecting invoices started without what records its outcomes.');
        }
        return { payments, transactions };
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
        run: InvoiceCollectionRun,
    ): Promise<void> {
        run.waiting += 1;
        this.logger.warn(
            `Invoice ${invoice.number} is not collected yet: ${waiting.code} ` +
                `${JSON.stringify(waiting.params)}.`,
        );
        // Once per invoice, reason and what the reason names: a debit held
        // behind a second failure is a wait of its own.
        await this.audited.record(
            `${invoice.id}|${waiting.code}|${JSON.stringify(waiting.params)}`,
            () =>
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

    private async invoiceOf(invoiceId: string): Promise<SubscriptionInvoiceRecord> {
        const invoice = await this.invoices.findById(invoiceId);
        if (!invoice) throw new Error(`Invoice ${invoiceId} has collections and does not exist.`);
        return invoice;
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

    private leadDays(): number {
        return directDebitLeadDaysOf(this.settings.invoicing ?? {});
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

/**
 * Before when an attempt was last taken on for another run to take it on, seen
 * from `at`: a submitted one after the lease, one on its way after the hour.
 */
function unsettledBefore(at: Date): { submittedBefore: Date; pendingBefore: Date } {
    return {
        submittedBefore: new Date(at.getTime() - INVOICE_COLLECTION_LEASE_MS),
        pendingBefore: new Date(at.getTime() - INVOICE_COLLECTION_ASK_EVERY_MS),
    };
}

/**
 * The payment methods a payment of the invoice was reversed on: none of them
 * collects the invoice again (`SC-PRIC-085`).
 */
function reversedOn(attempts: readonly InvoiceCollectionRecord[]): Set<string> {
    return new Set(
        attempts.filter((each) => each.status === 'REVERSED').map((each) => each.paymentMethodId),
    );
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

/** What every collection notice says of its invoice. */
function aboutInvoice(invoice: SubscriptionInvoiceRecord) {
    return {
        tenantId: invoice.tenantId,
        subscriptionId: invoice.subscriptionId,
        subscriberId: invoice.subscriberId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        amount: invoice.totalGross,
        currency: invoice.currency,
    };
}

/** The notices the run sends once it recorded them, each with its reader. */
const TOLD_BY_THE_RUN = [
    { kind: 'collection-failed', read: toCollectionFailedNotice, about: 'a failed collection' },
    { kind: 'collection-reversed', read: toCollectionReversedNotice, about: 'a reversed payment' },
] as const;

/**
 * The first of the invoice's `attempts` the subscriber has not been told of: a
 * failure whose notice is not delivered, or not recorded at all, and a
 * reversal whose notice is recorded and not delivered — one that opened
 * nothing that still owes is told nothing, and holds nothing. A failure on a
 * payment method a payment of the invoice was reversed on, and one followed up
 * before a reversal of the invoice, is the reversal's to tell, and holds what
 * the reversal holds. A direct debit announced again waits for it, so the
 * subscriber hears of the failure or the reversal before of the debit that
 * follows it.
 */
function untoldFailure(
    attempts: readonly InvoiceCollectionRecord[],
    told: readonly SubscriptionNoticeRecord[],
): InvoiceCollectionRecord | null {
    const of = (kind: SubscriptionNoticeRecord['kind'], delivered: boolean) =>
        new Set(
            told
                .filter(
                    (record) => record.kind === kind && (!delivered || record.deliveredAt !== null),
                )
                .map((record) => record.subject),
        );
    const failedTold = of('collection-failed', true);
    const reversedRecorded = of('collection-reversed', false);
    const reversedTold = of('collection-reversed', true);
    const reversedMethods = reversedOn(attempts);
    const lastReversedAt = Math.max(
        0,
        ...attempts
            .filter((each) => each.status === 'REVERSED')
            .map((each) => each.resolvedAt?.getTime() ?? 0),
    );
    const theReversalsToTell = (failed: InvoiceCollectionRecord) =>
        reversedMethods.has(failed.paymentMethodId) ||
        (failed.followedUpAt !== null && failed.followedUpAt.getTime() <= lastReversedAt);
    return (
        attempts.find(
            (each) =>
                (each.status === 'FAILED' &&
                    !failedTold.has(each.attemptKey) &&
                    !theReversalsToTell(each)) ||
                (each.status === 'REVERSED' &&
                    reversedRecorded.has(each.attemptKey) &&
                    !reversedTold.has(each.attemptKey)),
        ) ?? null
    );
}

/** The day a planned attempt is collected from, which its read refuses to be without. */
function plannedDayOf(attempt: InvoiceCollectionRecord): CalendarDay {
    if (attempt.collectOn === null) {
        throw new Error(`The planned collection attempt ${attempt.attemptKey} names no day.`);
    }
    return attempt.collectOn;
}

/** Why a failed attempt failed, and when; a failure is written with both. */
function failureOf(failed: InvoiceCollectionRecord): {
    reason: CollectionFailureReason;
    failedAt: Date;
} {
    if (failed.failureReason === null || failed.resolvedAt === null) {
        throw new Error(
            `The failed collection attempt ${failed.attemptKey} names no reason or day.`,
        );
    }
    return { reason: failed.failureReason, failedAt: failed.resolvedAt };
}

/**
 * What the subscriber is told follows a failure, from the attempt that
 * follows it: a card charged on the day it was planned for, a direct debit
 * announced again, or nothing until the payment method is replaced.
 */
function toldNext(next: InvoiceCollectionRecord | null): CollectionFailureNext {
    if (next === null) return { action: 'replace-payment-method' };
    if (next.paymentMethodType === 'card') {
        return { action: 'charged-again', on: plannedDayOf(next) };
    }
    return { action: 'announced-again' };
}

function noPaymentMethod(invoice: SubscriptionInvoiceRecord): Waiting {
    return {
        code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_NO_PAYMENT_METHOD,
        params: { subscriberId: invoice.subscriberId },
    };
}
