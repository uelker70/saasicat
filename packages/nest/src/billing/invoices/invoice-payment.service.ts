// What the gateway reports about money, recorded against the invoices: a
// collection's outcome with the payment it brought, a refund the operator made
// in the gateway, a reversal that takes a payment back and the gateway giving
// it back, and the credit an invoice whose total is negative leaves
// (`SC-PRIC-029`, `SC-PRIC-083`, `SC-PRIC-084`, `SC-PRIC-086`).
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

import {
    Inject,
    Injectable,
    Logger,
    type OnApplicationBootstrap,
    type OnModuleInit,
    Optional,
} from '@nestjs/common';
import type {
    CollectionFailureReason,
    CollectionOutcome,
    CreditPart,
    InvoiceCollectionRecord,
    InvoiceCollectionRepository,
    InvoicePart,
    LiftedCover,
    ReconciliationCaseKind,
    RecordedSubscriberPayment,
    RecordedSubscriberRefund,
    RecordedSubscriberReversal,
    ReversalWithdrawal,
    RlsBypassPort,
    SubscriberCreditRecord,
    SubscriberPaymentRepository,
    SubscriberReconciliationCaseRecord,
    SubscriberReversalRecord,
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
    type ReversalReportedEvent,
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
          changes: {
              refundRef: string;
              paymentRef: string;
              unmatched: number;
              currency: string;
              caseId: string | null;
          };
      }
    | {
          entity: 'Subscriber';
          action: 'SUBSCRIBER_REVERSAL_RECORDED';
          changes: {
              reversalRef: string;
              paymentRef: string;
              withdrawn: number;
              currency: string;
              /** What it took of each credit the payment left. */
              credits: CreditPart[];
              covering: CreditPart[];
              invoices: InvoicePart[];
              uncovered: LiftedCover[];
              unmatched: number;
          };
      }
    | {
          entity: 'Subscriber';
          action: 'SUBSCRIBER_REVERSAL_UNMATCHED';
          changes: {
              reversalRef: string;
              paymentRef: string;
              unmatched: number;
              currency: string;
              caseId: string | null;
          };
      }
    | {
          entity: 'Subscriber';
          action: 'SUBSCRIBER_REVERSAL_GIVEN_BACK';
          changes: {
              reversalRef: string;
              paymentRef: string;
              givenBack: number;
              currency: string;
              credits: CreditPart[];
              invoices: InvoicePart[];
          };
      }
    | {
          entity: 'Subscriber';
          action: 'SUBSCRIBER_RECONCILIATION_CASE_CLOSED';
          changes: {
              caseId: string;
              kind: ReconciliationCaseKind;
              amount: number;
              currency: string;
              note: string | null;
          };
      };

@Injectable()
export class InvoicePaymentService
    implements PaymentMoneyEventHandler, OnModuleInit, OnApplicationBootstrap
{
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
     * Refuses the start where a credit not paid out is held at an account the
     * configuration no longer names: a refund the operator makes there would
     * never reach the credit, which could then be paid out twice
     * (`SC-PRIC-030`). Read platform-wide, at a boot with no tenant, through
     * the RLS bypass.
     */
    async onApplicationBootstrap(): Promise<void> {
        const held = await readAcrossTenants(this.rlsBypass, () =>
            this.payments.accountsHoldingCredits(),
        );
        const unconfigured = this.gateways!.unconfigured(held);
        if (unconfigured.length === 0) return;
        throw new Error(
            `Credits not paid out are held at ${unconfigured.map((name) => `'${name}'`).join(', ')}, ` +
                'which config/saas.yaml#payments.accounts no longer names. List each account again, ' +
                'with its gateway bound, until its credits are paid out — by a refund there, or a ' +
                "payout recorded on the tenant's page.",
        );
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
     * A reversal the gateway reported — a returned direct debit, a chargeback
     * — or the gateway giving it back, recorded against the payment it takes
     * back. Where it opens the payment's invoice again, the attempt that
     * collected it is marked reversed in the same transaction, so the invoice
     * is collected anew only with another payment method (`SC-PRIC-085`). A
     * payment of SaaSiCat's that is not recorded yet is answered with an
     * error, so the gateway delivers the reversal again once it is.
     */
    async reversalReported(
        event: ReversalReportedEvent,
        context: PaymentEventContext,
    ): Promise<PaymentEventEffect> {
        const { reversal } = event;
        // Only a reversal of a payment this installation collected is its to
        // record; another installation at the same account sees its own.
        const attempt = await this.collections.findByKey(event.attemptKey, context.tx);
        if (!attempt || attempt.gatewayAccount !== context.gatewayAccount) {
            this.logger.warn(
                `Payment event ${event.eventId} at '${context.gatewayAccount}' reports reversal ` +
                    `${reversal.reversalRef} of collection attempt ${event.attemptKey}, which ` +
                    `${attempt ? 'was sent to another account' : 'this installation does not hold'}; nothing was recorded.`,
            );
            return 'nothing-to-do';
        }
        const at = new Date();
        const recorded = await this.payments.recordReversal(
            {
                gatewayAccount: context.gatewayAccount,
                gatewayRef: reversal.reversalRef,
                paymentRef: reversal.paymentRef,
                currency: reversal.currency,
                withdrawn: reversal.withdrawnCents / 100,
                reinstated: reversal.reinstatedCents / 100,
                at,
            },
            context.tx,
        );
        if (recorded.outcome === 'unknown-payment') {
            throw new Error(
                `Reversal ${reversal.reversalRef} at '${context.gatewayAccount}' takes back payment ` +
                    `${reversal.paymentRef} of collection attempt ${event.attemptKey}, which is not ` +
                    'recorded yet; the gateway delivers the reversal again.',
            );
        }
        if (recorded.outcome === 'unchanged') return 'nothing-to-do';
        if (recorded.withdrawal) {
            await this.markWhatOpened(recorded.reversal, recorded.withdrawal, at, context.tx);
        }
        context.afterCommit(() => this.reportReversal(recorded, reversal.paymentRef));
        return 'took-effect';
    }

    /**
     * Marks reversed, where a withdrawal opened an invoice again — itself, or
     * through a cover it lifted —, the attempt whose payment it took back, the
     * attempts whose payments the lifted covers stood for, and every attempt of
     * that invoice that succeeded: none of them settles it any more, and one
     * that succeeded would keep every other attempt from being made
     * (`SC-PRIC-085`, `SC-PRIC-088`).
     */
    private async markWhatOpened(
        reversal: SubscriberReversalRecord,
        withdrawal: ReversalWithdrawal,
        at: Date,
        tx: TransactionContext,
    ): Promise<void> {
        const opened = new Set(
            [...withdrawal.invoices, ...withdrawal.uncovered].map((part) => part.invoiceId),
        );
        if (opened.size === 0) return;
        const attempts = new Set<string>();
        for (const paymentId of new Set([
            reversal.paymentId,
            ...withdrawal.uncovered.map((each) => each.paymentId),
        ])) {
            const payment = await this.payments.findPaymentById(paymentId, tx);
            if (payment) attempts.add(payment.collectionId);
        }
        for (const invoiceId of opened) {
            for (const attempt of await this.collections.listByInvoice(invoiceId, tx)) {
                if (attempt.status === 'SUCCEEDED') attempts.add(attempt.id);
            }
        }
        for (const id of attempts) await this.collections.markReversed(id, at, tx);
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

    /** What the invoice still owes after what is settled against it; throws for one that does not exist. */
    async owed(invoiceId: string): Promise<number> {
        const owed = await this.payments.owedBy(invoiceId);
        if (owed === null) throw new Error(`Invoice ${invoiceId} does not exist.`);
        return owed;
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
        if (recorded.outcome === 'given-back') {
            await this.auditClosedCases(refund.subscriberId, recorded.closedCases);
            return;
        }
        if (recorded.unmatched === 0) return;
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
                caseId: recorded.case?.id ?? null,
            },
        });
    }

    /** Logs and audits what a reversal took back and what the gateway gave back of it. */
    private async reportReversal(
        recorded: Extract<RecordedSubscriberReversal, { outcome: 'recorded' }>,
        paymentRef: string,
    ): Promise<void> {
        const { reversal, withdrawal, reinstatement } = recorded;
        const about = { reversalRef: reversal.gatewayRef, paymentRef, currency: reversal.currency };
        if (withdrawal) {
            this.logger.warn(
                `Reversal ${reversal.gatewayRef} at '${reversal.gatewayAccount}' took back ` +
                    `payment ${paymentRef}: ${reversal.amount.toFixed(2)} ${reversal.currency} ` +
                    'withdrawn so far.',
            );
            await this.writeAudit(reversal.subscriberId, {
                entity: 'Subscriber',
                action: 'SUBSCRIBER_REVERSAL_RECORDED',
                changes: {
                    ...about,
                    withdrawn: reversal.amount,
                    credits: withdrawal.credits,
                    covering: withdrawal.covering,
                    invoices: withdrawal.invoices,
                    uncovered: withdrawal.uncovered,
                    unmatched: withdrawal.unmatched,
                },
            });
            if (withdrawal.unmatched > 0) {
                await this.writeAudit(reversal.subscriberId, {
                    entity: 'Subscriber',
                    action: 'SUBSCRIBER_REVERSAL_UNMATCHED',
                    changes: {
                        ...about,
                        unmatched: withdrawal.unmatched,
                        caseId: withdrawal.case?.id ?? null,
                    },
                });
            }
        }
        if (!reinstatement) return;
        this.logger.log(
            `Reversal ${reversal.gatewayRef} at '${reversal.gatewayAccount}' was given back: ` +
                `${reversal.reinstated.toFixed(2)} ${reversal.currency} so far.`,
        );
        await this.writeAudit(reversal.subscriberId, {
            entity: 'Subscriber',
            action: 'SUBSCRIBER_REVERSAL_GIVEN_BACK',
            changes: {
                ...about,
                givenBack: reversal.reinstated,
                credits: reinstatement.credits,
                invoices: reinstatement.invoices,
            },
        });
        await this.auditClosedCases(reversal.subscriberId, reinstatement.closedCases);
        if (reinstatement.credit) await this.auditCredit(reinstatement.credit);
    }

    /** Audits the cases SaaSiCat closed because the money they were about came back. */
    private async auditClosedCases(
        subscriberId: string,
        closed: readonly SubscriberReconciliationCaseRecord[],
    ): Promise<void> {
        for (const each of closed) {
            await this.writeAudit(subscriberId, {
                entity: 'Subscriber',
                action: 'SUBSCRIBER_RECONCILIATION_CASE_CLOSED',
                changes: {
                    caseId: each.id,
                    kind: each.kind,
                    amount: each.amount,
                    currency: each.currency,
                    note: each.note,
                },
            });
        }
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
