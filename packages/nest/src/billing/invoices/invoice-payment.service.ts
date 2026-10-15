// What the gateway reports about money, recorded against the invoices: a
// collection's outcome with the payment it brought, a refund the operator made
// in the gateway, and the credit an invoice whose total is negative leaves
// (`SC-PRIC-029`, `SC-PRIC-083`).
//
// A collection's outcome arrives two ways — the gateway's callback, and the
// run asking the gateway about an attempt — and both record it here, on one
// transaction: the payment with what it settles, in the invoice's turn, and
// the attempt settled with it (`SC-PRIC-036`). However often and in whatever
// order a payment is reported, it is recorded once, by its gateway account and
// the gateway's reference; the database holds that, so of two reports at the
// same moment one records it and the other finds it recorded.
//
// What is written to the audit log follows once the transaction committed, and
// only from the report that recorded it.
//
// Platform-wide: a callback has no tenant, and `PaymentCallbackService` opens
// its transaction inside `RlsBypassPort`, as the run opens its own.

import { Inject, Injectable, Logger, type OnModuleInit, Optional } from '@nestjs/common';
import type {
    CollectionFailureReason,
    CollectionOutcome,
    CreditPart,
    InvoiceCollectionRecord,
    InvoiceCollectionRepository,
    RecordedSubscriberPayment,
    RecordedSubscriberRefund,
    RlsBypassPort,
    SubscriberCreditRecord,
    SubscriberPaymentRepository,
    TransactionContext,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { AdminAuditService, platformJobActor } from '../../admin/admin-audit.service.js';
import { readAcrossTenants } from '../../admin/read-across-tenants.js';
import {
    PaymentCallbackService,
    type CollectionReportedEvent,
    type PaymentEventContext,
    type PaymentEventEffect,
    type PaymentMoneyEventHandler,
    type RefundReportedEvent,
} from '../../payments/payment-callback.service.js';
import { PaymentGatewayRegistry } from '../../payments/payment-gateway-registry.js';
import {
    INVOICE_COLLECTION_REPOSITORY_TOKEN,
    SUBSCRIBER_PAYMENT_REPOSITORY_TOKEN,
} from './invoice-collection.tokens.js';

const JOB = 'subscription-invoices';
const GATEWAY = 'payment-gateway';

/** How many invoices one page of crediting reads. */
const PAGE_SIZE = 100;

/** What recording an attempt's outcome did, on the transaction it was recorded on. */
export interface RecordedCollectionOutcome {
    /** Whether this report settled the attempt, or moved it on its way; `false` where another did first. */
    settled: boolean;
    /** The payment a success brought, where this report recorded it. */
    payment: RecordedSubscriberPayment | null;
}

/** What an audit entry about money records. */
type MoneyAudit =
    | {
          entity: 'SubscriptionInvoice';
          action: 'SUBSCRIPTION_INVOICE_COLLECTION_FAILED';
          changes: {
              number: string;
              attempt: number;
              reason: CollectionFailureReason;
              gatewayCode: string | null;
          };
      }
    | {
          entity: 'SubscriptionInvoice';
          action: 'SUBSCRIPTION_INVOICE_PAYMENT_RECORDED';
          changes: {
              number: string;
              attempt: number;
              paymentRef: string;
              amount: number;
              currency: string;
              settled: number;
          };
      }
    | {
          entity: 'Subscriber';
          action: 'SUBSCRIBER_CREDIT_RECORDED';
          changes: {
              creditId: string;
              amount: number;
              currency: string;
              origin: SubscriberCreditRecord['origin'];
          };
      }
    | {
          entity: 'Subscriber';
          action: 'SUBSCRIBER_REFUND_RECORDED' | 'SUBSCRIBER_REFUND_GIVEN_BACK';
          changes: {
              refundRef: string;
              paymentRef: string;
              amount: number;
              currency: string;
              status: string;
              parts: CreditPart[];
          };
      }
    | {
          entity: 'Subscriber';
          action: 'SUBSCRIBER_REFUND_UNMATCHED';
          changes: { refundRef: string; paymentRef: string; unmatched: number; currency: string };
      };

@Injectable()
export class InvoicePaymentService implements PaymentMoneyEventHandler, OnModuleInit {
    private readonly logger = new Logger(InvoicePaymentService.name);

    constructor(
        @Inject(INVOICE_COLLECTION_REPOSITORY_TOKEN)
        private readonly collections: InvoiceCollectionRepository,
        @Inject(SUBSCRIBER_PAYMENT_REPOSITORY_TOKEN)
        private readonly payments: SubscriberPaymentRepository,
        // Both from `PaymentsModule`; required to start, and optional here
        // only so that the start can say what is missing: see `onModuleInit`.
        @Optional()
        @Inject(PaymentGatewayRegistry)
        private readonly gateways: PaymentGatewayRegistry | null = null,
        @Optional()
        @Inject(PaymentCallbackService)
        private readonly callbacks: PaymentCallbackService | null = null,
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
        @Optional()
        @Inject(AdminAuditService)
        private readonly audit: AdminAuditService | null = null,
    ) {}

    /** Takes the gateway's events about money; refuses to start without the payments to take them from. */
    onModuleInit(): void {
        if (!this.callbacks || !this.gateways) {
            throw new Error(
                'Recording what invoices brought needs PaymentsModule, wired globally as it is by ' +
                    'default, whose callbacks report it.',
            );
        }
        this.callbacks.handleMoneyWith(this);
    }

    /**
     * Records what became of `attempt` on `tx`: a success's payment first, in
     * its invoice's turn, then the attempt. Returns what this report recorded;
     * report it with `reportOutcome` once `tx` committed.
     */
    async recordOutcome(
        attempt: InvoiceCollectionRecord,
        outcome: CollectionOutcome,
        tx: TransactionContext,
    ): Promise<RecordedCollectionOutcome> {
        const at = new Date();
        const payment =
            outcome.status === 'succeeded'
                ? await this.payments.recordPayment(
                      {
                          invoiceId: attempt.invoiceId,
                          collectionId: attempt.id,
                          gatewayAccount: attempt.gatewayAccount,
                          provider: this.providerOf(attempt.gatewayAccount),
                          gatewayRef: outcome.paymentRef,
                          amount: outcome.amountCents / 100,
                          currency: outcome.currency,
                          at,
                      },
                      tx,
                  )
                : null;
        const settled = await this.collections.recordOutcome(attempt.id, outcome, at, tx);
        return { settled, payment };
    }

    /**
     * Logs and audits what a report recorded, after its transaction committed:
     * a failure this report settled, and a payment it recorded — with the
     * credit it left. A payment for an attempt already settled otherwise is
     * recorded all the same, since the money arrived, and said loudly.
     */
    async reportOutcome(
        attempt: InvoiceCollectionRecord,
        outcome: CollectionOutcome,
        recorded: RecordedCollectionOutcome,
    ): Promise<void> {
        if (outcome.status === 'failed' && recorded.settled) {
            this.logger.warn(
                `Invoice ${attempt.invoiceNumber} was not collected (${attempt.attemptKey}): ` +
                    `${outcome.reason}${outcome.gatewayCode ? ` (${outcome.gatewayCode})` : ''}.`,
            );
            await this.writeAudit(attempt.invoiceId, {
                entity: 'SubscriptionInvoice',
                action: 'SUBSCRIPTION_INVOICE_COLLECTION_FAILED',
                changes: {
                    number: attempt.invoiceNumber,
                    attempt: attempt.attempt,
                    reason: outcome.reason,
                    gatewayCode: outcome.gatewayCode,
                },
            });
            return;
        }
        const { payment } = recorded;
        if (outcome.status !== 'succeeded' || !payment) return;
        if (!recorded.settled) {
            this.logger.error(
                `Payment ${outcome.paymentRef} at '${attempt.gatewayAccount}' was reported for ` +
                    `collection attempt ${attempt.attemptKey}, which was settled before as ` +
                    `${attempt.status}; the payment is recorded against invoice ` +
                    `${attempt.invoiceNumber} all the same.`,
            );
        } else {
            this.logger.log(
                `Invoice ${attempt.invoiceNumber} was collected (${attempt.attemptKey}).`,
            );
        }
        await this.writeAudit(attempt.invoiceId, {
            entity: 'SubscriptionInvoice',
            action: 'SUBSCRIPTION_INVOICE_PAYMENT_RECORDED',
            changes: {
                number: attempt.invoiceNumber,
                attempt: attempt.attempt,
                paymentRef: payment.payment.gatewayRef,
                amount: payment.payment.amount,
                currency: payment.payment.currency,
                settled: payment.settled,
            },
        });
        if (payment.credit) await this.auditCredit(payment.credit);
    }

    /**
     * A collection's outcome as the gateway reported it on its own. An attempt
     * this installation does not hold, or one another account sent, is not
     * this callback's to settle.
     */
    async collectionReported(
        event: CollectionReportedEvent,
        context: PaymentEventContext,
    ): Promise<PaymentEventEffect> {
        const attempt = await this.collections.findByKey(event.attemptKey, context.tx);
        if (!attempt || attempt.gatewayAccount !== context.gatewayAccount) {
            this.logger.warn(
                `Payment event ${event.eventId} at '${context.gatewayAccount}' reports collection ` +
                    `attempt ${event.attemptKey}, which ${attempt ? 'was sent to another account' : 'this installation does not hold'}; nothing was recorded.`,
            );
            return 'nothing-to-do';
        }
        if (attempt.paymentRef !== null && attempt.paymentRef !== event.outcome.paymentRef) {
            this.logger.error(
                `Payment event ${event.eventId} reports ${String(event.outcome.paymentRef)} for ` +
                    `collection attempt ${attempt.attemptKey}, which ${attempt.paymentRef} ` +
                    'was recorded for; nothing was recorded.',
            );
            return 'nothing-to-do';
        }
        const recorded = await this.recordOutcome(attempt, event.outcome, context.tx);
        context.afterCommit(() => this.reportOutcome(attempt, event.outcome, recorded));
        return recorded.settled || recorded.payment ? 'took-effect' : 'nothing-to-do';
    }

    /**
     * A refund the operator made in the gateway, recorded against the payment
     * it pays back. A payment of SaaSiCat's that is not recorded yet — its
     * success still on its way — is answered with an error, so the gateway
     * delivers the refund again once it is.
     */
    async refundReported(
        event: RefundReportedEvent,
        context: PaymentEventContext,
    ): Promise<PaymentEventEffect> {
        const { refund } = event;
        // Only a refund of a payment this installation collected is its to
        // record; another installation at the same account sees its own.
        const attempt = await this.collections.findByKey(event.attemptKey, context.tx);
        if (!attempt || attempt.gatewayAccount !== context.gatewayAccount) {
            this.logger.warn(
                `Payment event ${event.eventId} at '${context.gatewayAccount}' reports refund ` +
                    `${refund.refundRef} of collection attempt ${event.attemptKey}, which ` +
                    `${attempt ? 'was sent to another account' : 'this installation does not hold'}; nothing was recorded.`,
            );
            return 'nothing-to-do';
        }
        const recorded = await this.payments.recordRefund(
            {
                gatewayAccount: context.gatewayAccount,
                gatewayRef: refund.refundRef,
                paymentRef: refund.paymentRef,
                amount: refund.amountCents / 100,
                currency: refund.currency,
                status: refundStatusOf(refund.status),
                at: new Date(),
            },
            context.tx,
        );
        if (recorded.outcome === 'unknown-payment') {
            throw new Error(
                `Refund ${refund.refundRef} at '${context.gatewayAccount}' pays back payment ` +
                    `${refund.paymentRef} of collection attempt ${event.attemptKey}, which is not ` +
                    'recorded yet; the gateway delivers the refund again.',
            );
        }
        if (recorded.outcome === 'unchanged') return 'nothing-to-do';
        context.afterCommit(() => this.reportRefund(recorded, refund.paymentRef));
        return 'took-effect';
    }

    /**
     * Whether the invoice still owes something after what is settled against
     * it. One that owes nothing — a payment came for it, a late one included —
     * is collected no further.
     */
    async owes(invoiceId: string): Promise<boolean> {
        const owed = await this.payments.owedBy(invoiceId);
        return owed === null || owed > 0;
    }

    /**
     * Credits every invoice whose total is negative and that is not credited
     * yet, and returns how many it credited. A run calls it after issuing, so
     * a credit stands within the quarter of an hour its invoice was issued in.
     */
    async creditDue(): Promise<number> {
        return readAcrossTenants(this.rlsBypass, async () => {
            let credited = 0;
            let after: string | undefined;
            for (;;) {
                const page = await this.payments.listUncredited({ limit: PAGE_SIZE, after });
                for (const invoiceId of page) {
                    const credit = await this.payments.creditInvoice(invoiceId, new Date());
                    if (!credit) continue;
                    credited += 1;
                    await this.auditCredit(credit);
                }
                if (page.length < PAGE_SIZE) return credited;
                after = page[page.length - 1];
            }
        });
    }

    private async reportRefund(
        recorded: Exclude<RecordedSubscriberRefund, { outcome: 'unknown-payment' | 'unchanged' }>,
        paymentRef: string,
    ): Promise<void> {
        const { refund } = recorded;
        await this.writeAudit(refund.subscriberId, {
            entity: 'Subscriber',
            action:
                recorded.outcome === 'recorded'
                    ? 'SUBSCRIBER_REFUND_RECORDED'
                    : 'SUBSCRIBER_REFUND_GIVEN_BACK',
            changes: {
                refundRef: refund.gatewayRef,
                paymentRef,
                amount: refund.amount,
                currency: refund.currency,
                status: refund.status,
                parts: recorded.parts,
            },
        });
        if (recorded.outcome !== 'recorded' || recorded.unmatched === 0) return;
        this.logger.warn(
            `Refund ${refund.gatewayRef} at '${refund.gatewayAccount}' pays out ` +
                `${recorded.unmatched.toFixed(2)} ${refund.currency} that no credit of subscriber ` +
                `${refund.subscriberId} owes; it is the operator's to reconcile.`,
        );
        await this.writeAudit(refund.subscriberId, {
            entity: 'Subscriber',
            action: 'SUBSCRIBER_REFUND_UNMATCHED',
            changes: {
                refundRef: refund.gatewayRef,
                paymentRef,
                unmatched: recorded.unmatched,
                currency: refund.currency,
            },
        });
    }

    private async auditCredit(credit: SubscriberCreditRecord): Promise<void> {
        await this.writeAudit(credit.subscriberId, {
            entity: 'Subscriber',
            action: 'SUBSCRIBER_CREDIT_RECORDED',
            changes: {
                creditId: credit.id,
                amount: credit.amount,
                currency: credit.currency,
                origin: credit.origin,
            },
        });
    }

    private providerOf(account: string): string {
        const entry = this.gateways?.account(account);
        if (!entry) {
            throw new Error(
                `Collection attempts were sent to '${account}', which config/saas.yaml#payments.accounts ` +
                    'no longer names.',
            );
        }
        return entry.provider;
    }

    /** Writes an audit entry; a write that fails is said loudly and changes nothing recorded. */
    private async writeAudit(entityId: string, entry: MoneyAudit): Promise<void> {
        try {
            await this.audit?.log({
                actor: platformJobActor(entry.entity === 'Subscriber' ? GATEWAY : JOB),
                entity: entry.entity,
                entityId,
                action: entry.action,
                changes: entry.changes,
            });
        } catch (error) {
            this.logger.error(
                `Writing the audit entry ${entry.action} for ${entry.entity} ${entityId} failed.`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }
}

function refundStatusOf(
    status: RefundReportedEvent['refund']['status'],
): 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' {
    switch (status) {
        case 'pending':
            return 'PENDING';
        case 'succeeded':
            return 'SUCCEEDED';
        case 'failed':
            return 'FAILED';
        case 'canceled':
            return 'CANCELED';
    }
}
