// The correction of an issued invoice (`SC-PRIC-095`): a cancellation invoice
// that states it reversed and asks for nothing, a replacement for what of its
// charges is still owed, and what was paid for it moved onto the replacement —
// or, where the replacement does not take it, into credits — written in one
// transaction, in the turn of the invoice's chain (`SC-PRIC-036`). A collection
// of the cancelled invoice planned and not yet submitted is withdrawn with it.
//
// A line the operator names as not owed, or owed in part, moves by a
// counter-entry written in the same transaction, and each discount that
// reduced it in the share it fell (`SC-PRIC-020`); where nothing is owed any
// more there is no replacement, and everything paid becomes a credit.
//
// The preview and the cancellation take the same steps, so what the operator
// confirms is what is written (`SC-UI-017`): the preview stops before the first
// write and leaves nothing behind.
//
// The replacement names the cancelled invoice's issuer, with a correction of it
// declared in `config/saas.yaml` since (`SC-PRIC-092`), and its subscriber, with
// each correction of the subscriber's legal identity recorded since
// (`SC-SUB-017`) and the details the operator corrects with the cancellation.
// Its tax is decided again for the parties it names over the cancelled
// invoice's charges' period, a VAT identification number counting as validated
// only where the subscriber's record holds that same number with a valid check.
// It is an invoice of its own issue date: the footer lines are those the file
// names then (`SC-PRIC-093`), its payment term runs from it, and it is
// collected with the payment method in use unless what was paid covers it.

import { createHash } from 'node:crypto';

import {
    ConflictException,
    Inject,
    Injectable,
    NotFoundException,
    type OnModuleInit,
    Optional,
    UnprocessableEntityException,
} from '@nestjs/common';
import {
    INVOICE_CANCELLATION_REASON_MAX_LENGTH,
    INVOICE_ERROR_CODES,
    canonicalJson,
    contractPartiesOf,
    correctedSubscriberOf,
    directDebitLeadDaysOf,
    draftCancellationInvoice,
    draftCorrectedReplacementInvoice,
    invoiceContentDraftOf,
    invoiceFooterOf,
    invoicePaymentOf,
    isCorrectableLine,
    lineCorrectionsOf,
    movedPaymentParts,
    paidByShares,
    standingCentsOf,
    subscriberCorrectedSince,
    sumToCents,
    writtenReplacementOf,
    type AdminCancelledInvoice,
    type AdminInvoiceCancellationPlan,
    type CorrectedInvoiceLine,
    type CorrectedInvoiceSubscriber,
    type DiscountReduces,
    type InvoiceCancellationRequest,
    type InvoiceLineOwed,
    type InvoiceCollectionRepository,
    type InvoicePaymentShare,
    type InvoiceSubscriberDetail,
    type MovedPaymentPart,
    type NewCorrectionInvoice,
    type NewSubscriberCharge,
    type PlanCatalogSettings,
    type PlannedReplacementInvoice,
    type RlsBypassPort,
    type SubscriberChargeRecord,
    type SubscriberCreditRecord,
    type SubscriberLedgerRepository,
    type SubscriberPaymentMethodRepository,
    type SubscriberPaymentRepository,
    type SubscriptionContractRepository,
    type SubscriptionInvoiceCancellationRecord,
    type SubscriptionInvoiceRecord,
    type SubscriptionInvoiceRepository,
    type TaxTreatment,
    type TransactionContext,
    type TransactionRunner,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { readAcrossTenants } from '../../admin/read-across-tenants.js';
import { codedError } from '../../errors/coded-error.js';
import { answeringRefusals } from '../../errors/answering-refusals.js';
import { SUBSCRIBER_PAYMENT_METHOD_REPOSITORY_TOKEN } from '../../payments/payments.tokens.js';
import {
    holdsAsSubscriberDetail,
    isDeliverableAddress,
    settleInvoiceCorrections,
} from '../../subscriber/subscriber-details.js';
import { SubscriberService } from '../../subscriber/subscriber.service.js';
import {
    CONTRACT_TRANSACTION_RUNNER_TOKEN,
    SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN,
} from '../../subscription-contract/subscription-contract.tokens.js';
import { TAX_TREATMENTS_TOKEN } from '../../tax/tax.tokens.js';
import type { TaxTreatments } from '../../tax/tax-treatments.js';
import { addOnHoldOf } from '../charges/charge-entries.js';
import { SUBSCRIBER_LEDGER_REPOSITORY_TOKEN } from '../charges/subscriber-charge.tokens.js';
import { withdrawalReductionOf } from '../feature-withdrawal-lines.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from '../plan-catalog.module.js';
import {
    INVOICE_COLLECTION_REPOSITORY_TOKEN,
    SUBSCRIBER_PAYMENT_REPOSITORY_TOKEN,
} from './invoice-collection.tokens.js';
import { SubscriptionInvoiceService } from './subscription-invoice.service.js';
import { SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN } from './subscription-invoice.tokens.js';

/** What cancelling an invoice writes, as the preview shows it and the cancellation writes it. */
export interface InvoiceCancellationPlan extends AdminInvoiceCancellationPlan {
    cancelled: SubscriptionInvoiceRecord;
    cancellation: NewCorrectionInvoice;
    /** `null` where nothing of the cancelled invoice is owed any more. */
    replacement: PlannedReplacementInvoice | null;
    /** What each charge line of the cancelled invoice stands at, and becomes. */
    lines: CorrectedInvoiceLine[];
    /** The counter-entries the cancellation writes, in the order of the lines they move. */
    counterEntries: NewSubscriberCharge[];
    /** The operator's corrections, each with the value it replaced; `null` where none. */
    correctedSubscriber: CorrectedInvoiceSubscriber | null;
    /** How each payment's share of the cancelled invoice moves, the oldest first. */
    moves: MovedPaymentPart[];
}

/** The audit action a cancellation is recorded under (`SC-ADM-020`). */
export const INVOICE_CANCELLED_AUDIT_ACTION = 'SUBSCRIPTION_INVOICE_CANCELLED';

/**
 * The audit entry of a cancellation, whoever made it — an operator's route or
 * the command line. It names the invoices, the reason, which lines moved from
 * what to what and which details were corrected, and whether an address to
 * deliver to was given; the address and the corrected values stand on the
 * cancellation itself.
 */
export function invoiceCancellationAudit(cancelled: CancelledInvoice): {
    entity: 'SubscriptionInvoice';
    entityId: string;
    action: typeof INVOICE_CANCELLED_AUDIT_ACTION;
    changes: {
        tenantId: string;
        number: string | null;
        cancellationNumber: string;
        replacementNumber: string | null;
        reason: string;
        corrected: string[];
        correctedLines: { position: number; standsAt: number; becomes: number }[];
        deliverToGiven: boolean;
        paidOnIssue: number;
        credited: number;
        withdrawnCollections: number;
    };
} {
    const { cancellation, cancellationInvoice, replacement } = cancelled;
    return {
        entity: 'SubscriptionInvoice',
        entityId: cancellation.cancelledInvoiceId,
        action: INVOICE_CANCELLED_AUDIT_ACTION,
        changes: {
            tenantId: cancellationInvoice.tenantId,
            number: cancellationInvoice.correction?.of.number ?? null,
            cancellationNumber: cancellationInvoice.number,
            replacementNumber: replacement?.number ?? null,
            reason: cancellation.reason,
            corrected: Object.keys(cancellation.correctedSubscriber ?? {}),
            correctedLines: cancelled.lines
                .filter((line) => line.becomes !== line.standsAt)
                .map((line) => ({
                    position: line.position,
                    standsAt: line.standsAt / 100,
                    becomes: line.becomes / 100,
                })),
            deliverToGiven: cancellation.deliverTo !== null,
            paidOnIssue: replacement?.paidOnIssue ?? 0,
            credited: cancelled.credits.reduce((sum, credit) => sumToCents(sum, credit.amount), 0),
            withdrawnCollections: cancelled.withdrawnCollections,
        },
    };
}

/** What a cancellation wrote. */
export interface CancelledInvoice extends AdminCancelledInvoice {
    cancellation: SubscriptionInvoiceCancellationRecord;
    cancellationInvoice: SubscriptionInvoiceRecord;
    /** `null` where nothing of the cancelled invoice was owed any more. */
    replacement: SubscriptionInvoiceRecord | null;
    /** What each charge line of the cancelled invoice stood at, and became. */
    lines: CorrectedInvoiceLine[];
    /** The counter-entries it wrote. */
    counterEntries: SubscriberChargeRecord[];
    credits: SubscriberCreditRecord[];
    /** The collections of the cancelled invoice that were planned and are not made. */
    withdrawnCollections: number;
}

@Injectable()
export class InvoiceCancellationService implements OnModuleInit {
    constructor(
        @Inject(SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN)
        private readonly invoices: SubscriptionInvoiceRepository,
        @Inject(SUBSCRIBER_LEDGER_REPOSITORY_TOKEN)
        private readonly ledger: SubscriberLedgerRepository,
        @Inject(SubscriberService)
        private readonly subscribers: SubscriberService,
        // Names the issuer as an invoice issued now names it.
        @Inject(SubscriptionInvoiceService)
        private readonly issuing: SubscriptionInvoiceService,
        @Inject(TAX_TREATMENTS_TOKEN)
        private readonly taxes: TaxTreatments,
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: PlanCatalogSettings,
        // Optional here only so that the start can say why; see `onModuleInit`.
        @Optional()
        @Inject(CONTRACT_TRANSACTION_RUNNER_TOKEN)
        private readonly transactions: TransactionRunner | null = null,
        // Where invoices are collected: what was paid moves, and a planned
        // collection is withdrawn.
        @Optional()
        @Inject(SUBSCRIBER_PAYMENT_REPOSITORY_TOKEN)
        private readonly payments: SubscriberPaymentRepository | null = null,
        @Optional()
        @Inject(INVOICE_COLLECTION_REPOSITORY_TOKEN)
        private readonly collections: InvoiceCollectionRepository | null = null,
        @Optional()
        @Inject(SUBSCRIBER_PAYMENT_METHOD_REPOSITORY_TOKEN)
        private readonly paymentMethods: SubscriberPaymentMethodRepository | null = null,
        // An operator acts across tenants, from a route or from the command
        // line; where row-level security is on, without it the invoice would
        // read as none.
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
        // Where a discount is said to reduce a booking rather than the plan.
        @Optional()
        @Inject(SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN)
        private readonly contracts: SubscriptionContractRepository | null = null,
    ) {}

    /**
     * Refuses to start without the transaction a cancellation is written on:
     * written one statement after another, an interruption would leave a
     * cancellation invoice without its replacement, or what was paid on an
     * invoice that no longer stands.
     */
    onModuleInit(): void {
        const missing = [
            ...(this.transactions
                ? []
                : [
                      'cancelling an invoice needs the transaction the contracts are written on: ' +
                          'give `contractFreeze.transactionRunner`, which `SaaSiCatModule` passes ' +
                          'from the persistence bundle.',
                  ]),
            ...(this.contracts
                ? []
                : [
                      'cancelling an invoice reads the contract lines its discounts came from: ' +
                          'bind `SubscriptionContractRepository`, which tenant billing does.',
                  ]),
        ];
        if (missing.length === 0) return;
        throw new Error(`Invoices cannot start:\n${missing.map((line) => `- ${line}`).join('\n')}`);
    }

    /**
     * What cancelling invoice `invoiceId` of tenant `tenantId` would write at
     * `now`, computed as the cancellation computes it; nothing is written.
     * Refused as the cancellation is.
     */
    preview(
        tenantId: string,
        invoiceId: string,
        request: InvoiceCancellationRequest,
        now: Date = new Date(),
    ): Promise<InvoiceCancellationPlan> {
        return readAcrossTenants(this.rlsBypass, () =>
            this.runner().run((tx) => this.planIn(tenantId, invoiceId, request, now, tx)),
        );
    }

    /**
     * The id of the invoice of tenant `tenantId` numbered `number`, as an
     * operator reads it off the document, or `null` where the tenant has none
     * so numbered.
     */
    invoiceIdNumbered(tenantId: string, number: string): Promise<string | null> {
        return readAcrossTenants(this.rlsBypass, async () => {
            const subscriber = await this.subscribers.findByTenantId(tenantId);
            if (!subscriber) return null;
            const invoices = await this.invoices.listBySubscriber(subscriber.id);
            return invoices.find((invoice) => invoice.number === number)?.id ?? null;
        });
    }

    /**
     * Cancels invoice `invoiceId` of tenant `tenantId` at `now`, for
     * `cancelledBy`. Refused with `SUBSCRIPTION_INVOICE_NOT_FOUND` (404) for no
     * such invoice of the tenant, `SUBSCRIPTION_INVOICE_ALREADY_CANCELLED`
     * (409) for one cancelled already, `SUBSCRIPTION_INVOICE_NOT_YET_ARCHIVED`
     * (409) while its document is not archived, and with `422` for a reason
     * that is blank, longer than one line allows or too long, a correction the
     * subscriber's record would not hold, an address that is no email address,
     * a cancellation invoice, an invoice that states a credit, a subscriber
     * reached by no address, and a replacement that could not be issued — its
     * content incomplete for the tax adapter, a direct debit without its
     * mandate, a treatment the adapter does not support. Nothing is written
     * then, and no number is drawn.
     */
    cancel(
        tenantId: string,
        invoiceId: string,
        request: InvoiceCancellationRequest,
        cancelledBy: string,
        now: Date = new Date(),
    ): Promise<CancelledInvoice> {
        return readAcrossTenants(this.rlsBypass, () =>
            this.cancelIn(tenantId, invoiceId, request, cancelledBy, now),
        );
    }

    private cancelIn(
        tenantId: string,
        invoiceId: string,
        request: InvoiceCancellationRequest,
        cancelledBy: string,
        now: Date,
    ): Promise<CancelledInvoice> {
        return this.runner().run(async (tx) => {
            const plan = await this.planIn(tenantId, invoiceId, request, now, tx);
            refuseChangedSincePreview(plan, request.previewDigest);
            const counterEntries = await this.writtenCounterEntries(plan, tx);
            const issued = await answeringRefusals(
                () =>
                    this.invoices.issueCancellation(
                        {
                            cancelledInvoiceId: invoiceId,
                            cancellation: plan.cancellation,
                            replacement: plan.replacement
                                ? writtenReplacementOf(
                                      plan.replacement,
                                      counterEntries.map((entry) => entry.id),
                                  )
                                : null,
                            reason: plan.reason,
                            correctedSubscriber: plan.correctedSubscriber,
                            deliverTo: plan.deliverTo,
                            cancelledBy,
                            cancelledAt: now,
                        },
                        tx,
                    ),
                {
                    [INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_ALREADY_CANCELLED]: (refusal) =>
                        new ConflictException({
                            code: refusal.code,
                            message: refusal.message,
                            params: refusal.params,
                        }),
                },
            );
            const replacement = issued.replacement;
            if ((replacement === null) !== (plan.replacement === null)) {
                throw new Error(
                    `The cancellation of ${invoiceId} wrote ${replacement ? 'a' : 'no'} replacement ` +
                        `where it planned ${plan.replacement ? 'one' : 'none'}.`,
                );
            }
            const credits = this.payments
                ? await this.payments.moveShares(
                      {
                          cancellationId: issued.cancellation.id,
                          cancelledInvoiceId: invoiceId,
                          replacementInvoiceId: replacement?.id ?? null,
                          parts: plan.moves,
                          at: now,
                      },
                      tx,
                  )
                : [];
            return {
                ...issued,
                replacement,
                lines: plan.lines,
                counterEntries,
                credits,
                withdrawnCollections: await this.withdrawPlanned(invoiceId, now, tx),
            };
        });
    }

    /**
     * Writes the counter-entries of `plan` on `tx`, in its order. Each names the
     * cancelled invoice in its source reference, which a cancellation is made of
     * once, so none is there already; one that was would be a cancellation that
     * did not take its turn.
     */
    private async writtenCounterEntries(
        plan: InvoiceCancellationPlan,
        tx: TransactionContext,
    ): Promise<SubscriberChargeRecord[]> {
        if (plan.counterEntries.length === 0) return [];
        const written = await this.ledger.recordCharges(plan.counterEntries, tx);
        return plan.counterEntries.map((entry) => {
            const record = written.find((each) => each.sourceRef === entry.sourceRef);
            if (!record) {
                throw new Error(
                    `The counter-entry ${entry.sourceRef} of the cancellation of ` +
                        `${plan.cancelled.number} is in the journal already.`,
                );
            }
            return record;
        });
    }

    /** The steps both take, in the turn of the invoice's chain on `tx`. */
    private async planIn(
        tenantId: string,
        invoiceId: string,
        request: InvoiceCancellationRequest,
        now: Date,
        tx: TransactionContext,
    ): Promise<InvoiceCancellationPlan> {
        const chain = await this.invoices.holdChain(invoiceId, tx);
        const cancelled = chain?.invoices.find((invoice) => invoice.id === invoiceId);
        // An invoice of another tenant is none of this one's.
        if (!chain || !cancelled || cancelled.tenantId !== tenantId) {
            throw new NotFoundException(
                codedError(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_NOT_FOUND, { invoiceId }),
            );
        }
        const given = settledRequestOf(request, cancelled.number);
        await this.refuseUncancellable(cancelled, chain.cancellations, given.deliverTo);
        const journal = await this.ledger.listBySubscription(cancelled.subscriptionId, tx);
        const corrections = lineCorrectionsOf(
            cancelled,
            settledLinesOf(request.lines ?? [], cancelled, journal),
            {
                journal,
                reduces: await this.discountReductions(cancelled, journal),
                reason: given.reason,
                bookedAt: now,
            },
        );
        const subscriber = correctedSubscriberOf(
            subscriberCorrectedSince(
                cancelled.subscriber,
                await this.subscribers.listCorrections(cancelled.subscriberId),
                cancelled.issuedAt,
            ),
            given.corrections,
        );
        const configured = contractPartiesOf(
            await this.subscribers.getById(cancelled.subscriberId),
            this.subscribers.issuerNamed(),
        ).issuer;
        const issuer = await this.issuing.issuerFor(cancelled.issuer, configured);
        const method = (await this.paymentMethods?.findActive(cancelled.subscriberId)) ?? null;
        const shares: InvoicePaymentShare[] = this.payments
            ? await this.payments.sharesOf(invoiceId, tx)
            : [];
        // Required with a tax adapter, which invoicing requires.
        const invoicing = this.settings.invoicing!;
        const issue = {
            issuedAt: now,
            timeZone: this.settings.timeZone!,
            numberPrefix: invoicing.numberPrefix,
        };
        // Nothing owed any more needs no treatment: there is no replacement.
        const replacement = corrections.lines.every((line) => line.becomes === 0)
            ? null
            : draftCorrectedReplacementInvoice(
                  cancelled,
                  {
                      ...issue,
                      subscriber: subscriber.subscriber,
                      issuer,
                      footer: invoiceFooterOf(issuer, configured, invoicing.footer ?? []),
                      treatment: await this.treatmentOf(
                          cancelled,
                          journal,
                          subscriber.subscriber,
                          issuer,
                          tx,
                      ),
                      tax: (lines) => this.taxes.invoiceTax(lines),
                      paymentTermDays: invoicing.paymentTermDays,
                      directDebitLeadDays: directDebitLeadDaysOf(invoicing),
                      payment: invoicePaymentOf(method),
                      paid: paidByShares(shares),
                  },
                  corrections,
              );
        if (replacement) this.refuseUnissuable(cancelled, replacement, method?.id ?? null);
        const moves = movedPaymentParts(shares, replacement?.totalGross ?? 0);
        const plan = {
            cancelled,
            cancellation: draftCancellationInvoice(cancelled, issue),
            replacement,
            lines: corrections.lines,
            counterEntries: corrections.counterEntries,
            correctedSubscriber: subscriber.corrected,
            moves,
            movedIn: moves.reduce((sum, part) => sumToCents(sum, part.movedIn), 0),
            credited: moves.reduce((sum, part) => sumToCents(sum, part.credited), 0),
            reason: given.reason,
            deliverTo: given.deliverTo,
        };
        return { ...plan, digest: previewDigestOf(plan) };
    }

    /** Refuses an invoice a cancellation does not correct (`SC-PRIC-095`, `SC-PRIC-036`). */
    private async refuseUncancellable(
        invoice: SubscriptionInvoiceRecord,
        cancellations: readonly SubscriptionInvoiceCancellationRecord[],
        deliverTo: string | null,
    ): Promise<void> {
        const params = { number: invoice.number };
        if (invoice.correction?.kind === 'cancellation') {
            throw new UnprocessableEntityException(
                codedError(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_IS_CANCELLATION, params),
            );
        }
        if (cancellations.some((each) => each.cancelledInvoiceId === invoice.id)) {
            throw new ConflictException(
                codedError(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_ALREADY_CANCELLED, params),
            );
        }
        // Its replacement would state the credit again, and be credited again.
        if (invoice.totalGross < 0) {
            throw new UnprocessableEntityException(
                codedError(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_STATES_A_CREDIT, params),
            );
        }
        const document = await this.invoices.findDocument(invoice.id);
        if (!document?.archivedAt) {
            throw new ConflictException(
                codedError(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_NOT_YET_ARCHIVED, params),
            );
        }
        const record = await this.subscribers.getById(invoice.subscriberId);
        if (!record.invoiceEmail && deliverTo === null) {
            throw new UnprocessableEntityException(
                codedError(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_NO_DELIVERY_ADDRESS, {
                    ...params,
                    subscriberId: invoice.subscriberId,
                }),
            );
        }
    }

    /**
     * Refuses a replacement that asks for less than nothing, which the
     * corrections left a credit, and one that the run would hold rather than
     * issue: a direct debit whose mandate reference cannot be announced
     * (`SC-PRIC-028`), and content the tax adapter requires and the replacement
     * lacks (`SC-PRIC-027`).
     */
    private refuseUnissuable(
        cancelled: SubscriptionInvoiceRecord,
        replacement: PlannedReplacementInvoice,
        methodId: string | null,
    ): void {
        if (replacement.totalGross < 0) {
            throw new UnprocessableEntityException(
                codedError(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_CORRECTION_LEAVES_A_CREDIT, {
                    number: cancelled.number,
                    totalGross: replacement.totalGross,
                }),
            );
        }
        const owed = sumToCents(replacement.totalGross, -replacement.paidOnIssue);
        if (methodId !== null && !replacement.payment && owed > 0) {
            throw new UnprocessableEntityException(
                codedError(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_MANDATE_MISSING, {
                    paymentMethodId: methodId,
                }),
            );
        }
        const missing = this.taxes.invoiceContentGaps(invoiceContentDraftOf(replacement));
        if (missing.length > 0) {
            throw new UnprocessableEntityException(
                codedError(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_CONTENT_INCOMPLETE, {
                    adapter: replacement.taxTreatment.adapter.name,
                    missing: [...missing],
                }),
            );
        }
    }

    /**
     * The treatment the tax adapter decides for the parties the replacement
     * names, over the period the cancelled invoice's charges cover. A case the
     * adapter does not support is refused with its `422`.
     */
    private async treatmentOf(
        cancelled: SubscriptionInvoiceRecord,
        journal: readonly SubscriberChargeRecord[],
        subscriber: SubscriptionInvoiceRecord['subscriber'],
        issuer: SubscriptionInvoiceRecord['issuer'],
        tx: TransactionContext,
    ): Promise<TaxTreatment> {
        const origin = await this.subscribers.taxOriginOfParty(
            cancelled.subscriberId,
            subscriber,
            tx,
        );
        const applied = this.taxes.decide(origin, periodOf(cancelled, journal), {
            country: issuer.country,
            vatId: issuer.vatId,
        });
        // Invoicing starts only beside a tax adapter, which decides every treatment.
        if (!applied.treatment) throw new Error('No tax adapter decided a treatment.');
        return applied.treatment;
    }

    /**
     * What each discount of `invoice` reduces, read off the contract line it
     * came from the way the charge derivation reads it (`othersOf`): a held
     * add-on price, and a feature withdrawal's reduction of a booking, that
     * booking; every other discount the plan.
     */
    private async discountReductions(
        invoice: SubscriptionInvoiceRecord,
        journal: readonly SubscriberChargeRecord[],
    ): Promise<(discount: SubscriberChargeRecord) => DiscountReduces> {
        const onInvoice = new Set(invoice.lines.map((line) => line.chargeId));
        const discounts = journal.filter(
            (charge) => onInvoice.has(charge.id) && charge.source === 'discount',
        );
        const contracts = new Map(
            await Promise.all(
                [...new Set(discounts.map((charge) => charge.contractId))].map(
                    async (contractId) =>
                        [contractId, await this.contractRepository().findById(contractId)] as const,
                ),
            ),
        );
        return (discount) => {
            const line = contracts
                .get(discount.contractId)
                ?.lineItems.find((item) => item.id === discount.contractLineItemId);
            if (!line) {
                throw new Error(
                    `The discount ${discount.id} on invoice ${invoice.number} names a contract ` +
                        'line that is not there.',
                );
            }
            const booking =
                addOnHoldOf(line)?.subscriptionBundleId ??
                withdrawalReductionOf(line)?.subscriptionBundleId ??
                null;
            return booking === null
                ? { source: 'plan' }
                : { source: 'bundle', subscriptionBundleId: booking };
        };
    }

    private contractRepository(): SubscriptionContractRepository {
        // `onModuleInit` refuses a start without it.
        if (!this.contracts) throw new Error('Cancelling an invoice needs the contracts.');
        return this.contracts;
    }

    /**
     * Withdraws the collections of the cancelled invoice planned and not yet
     * submitted, so none of them is (`SC-PRIC-095`); one already submitted is
     * left to its answer, and holds the replacement back until then.
     */
    private async withdrawPlanned(
        invoiceId: string,
        now: Date,
        tx: TransactionContext,
    ): Promise<number> {
        if (!this.collections) return 0;
        let withdrawn = 0;
        for (const attempt of await this.collections.listByInvoice(invoiceId, tx)) {
            if (attempt.status !== 'SCHEDULED') continue;
            if (await this.collections.withdraw(attempt.id, now, tx)) withdrawn += 1;
        }
        return withdrawn;
    }

    private runner(): TransactionRunner {
        // `onModuleInit` refuses a start without it.
        if (!this.transactions)
            throw new Error('Cancelling an invoice needs a transaction runner.');
        return this.transactions;
    }
}

/**
 * The fingerprint of what `plan` would write: SHA-256 over its canonical
 * JSON, the moment the two invoices are issued and the counter-entries booked
 * left out. A preview read a minute before the confirmation writes the same
 * invoices and counter-entries a minute later; the issue day stays in, and
 * with it the due date and the number's year it decides.
 */
function previewDigestOf(plan: Omit<InvoiceCancellationPlan, 'digest'>): string {
    const timeless = <Invoice extends Pick<NewCorrectionInvoice, 'issuedAt'>>(
        invoice: Invoice,
    ) => ({
        ...invoice,
        issuedAt: null,
    });
    const held = {
        ...plan,
        cancellation: timeless(plan.cancellation),
        replacement: plan.replacement && timeless(plan.replacement),
        counterEntries: plan.counterEntries.map((entry) => ({ ...entry, bookedAt: null })),
    };
    return createHash('sha256').update(canonicalJson(held)).digest('hex');
}

/**
 * Refuses a cancellation whose confirmed preview differs from what it would
 * write — a payment came in meanwhile, a correction of the subscriber's legal
 * identity was recorded, the tax treatment moved —, with the new preview, so
 * that what is written is what the operator confirmed (`SC-UI-017`). A request
 * that names no preview, as the command line's, is not held to one.
 */
function refuseChangedSincePreview(
    plan: InvoiceCancellationPlan,
    previewDigest: string | undefined,
): void {
    if (previewDigest === undefined || previewDigest === plan.digest) return;
    throw new ConflictException({
        ...codedError(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_CANCELLATION_PREVIEW_CHANGED, {
            number: plan.cancelled.number,
        }),
        preview: plan,
    });
}

/** The period the invoice's charges cover: from the first start to the last end. */
function periodOf(
    invoice: SubscriptionInvoiceRecord,
    journal: readonly SubscriberChargeRecord[],
): { from: Date; until: Date } {
    const ids = new Set(invoice.lines.map((line) => line.chargeId));
    const charges = journal.filter((charge) => ids.has(charge.id));
    if (charges.length !== ids.size) {
        throw new Error(`The charges of invoice ${invoice.number} are not all in the journal.`);
    }
    const starts = charges.map((charge) => charge.periodStart.getTime());
    const ends = charges.map((charge) => charge.periodEnd.getTime());
    return { from: new Date(Math.min(...starts)), until: new Date(Math.max(...ends)) };
}

/**
 * The lines the operator names as not owed, or owed in part, settled against
 * `invoice` and what its charges stand at in `journal`, or refused with
 * `422`: a line the invoice has, named once, whose charge asks for something,
 * owed at least nothing and below what it stands at, in whole cents.
 *
 * The request may come from outside TypeScript, so `owed` is held to being a
 * number before it is read as one: `null`, `""` or `false` would multiply to
 * nothing owed and write the whole line off. A refusal names what was given
 * as it was given (`asGiven`), so the text `"1"` is not refused as line 1.
 */
function settledLinesOf(
    given: readonly InvoiceLineOwed[],
    invoice: SubscriptionInvoiceRecord,
    journal: readonly SubscriberChargeRecord[],
): InvoiceLineOwed[] {
    const refused = (
        code: keyof typeof INVOICE_ERROR_CODES,
        params: Record<string, number | string>,
    ) =>
        new UnprocessableEntityException(
            codedError(INVOICE_ERROR_CODES[code], { number: invoice.number, ...params }),
        );
    const seen = new Set<number>();
    return given.map(({ position, owed }) => {
        const line = invoice.lines.find((each) => each.position === position);
        if (!line) {
            throw refused('SUBSCRIPTION_INVOICE_LINE_UNKNOWN', { position: asGiven(position) });
        }
        if (seen.has(position))
            throw refused('SUBSCRIPTION_INVOICE_LINE_NAMED_TWICE', { position });
        seen.add(position);
        const charge = journal.find((entry) => entry.id === line.chargeId);
        if (!charge) {
            throw new Error(
                `Line ${position} of invoice ${invoice.number} names a charge not in the journal.`,
            );
        }
        const standsAt = standingCentsOf(charge, journal);
        if (!isCorrectableLine(line, standsAt)) {
            throw refused('SUBSCRIPTION_INVOICE_LINE_NOT_CORRECTABLE', { position });
        }
        const cents = typeof owed === 'number' ? owed * 100 : Number.NaN;
        if (
            !Number.isFinite(cents) ||
            Math.abs(cents - Math.round(cents)) > 1e-6 ||
            Math.round(cents) < 0 ||
            Math.round(cents) >= standsAt
        ) {
            throw refused('SUBSCRIPTION_INVOICE_LINE_OWED_INVALID', {
                position,
                owed: asGiven(owed),
                standsAt: standsAt / 100,
            });
        }
        return { position, owed: Math.round(cents) / 100 };
    });
}

/**
 * A value of the request as its refusal names it: a number as the number, and
 * anything else as the JSON that carried it, so `"1"` does not read as line 1
 * and `null` leaves no gap in the sentence.
 */
function asGiven(value: unknown): number | string {
    if (typeof value === 'number') return value;
    return JSON.stringify(value) ?? String(value);
}

/**
 * The operator's request with each part settled, or refused with `422`: a
 * reason of one line, a correction that holds as the subscriber's detail does,
 * an address shaped like an email address (`SC-ADM-020`, `SC-PRIC-094`).
 */
function settledRequestOf(
    request: InvoiceCancellationRequest,
    number: string,
): {
    reason: string;
    corrections: Partial<Record<InvoiceSubscriberDetail, string | null>>;
    deliverTo: string | null;
} {
    const reason = typeof request.reason === 'string' ? request.reason.trim() : '';
    if (
        reason === '' ||
        reason.length > INVOICE_CANCELLATION_REASON_MAX_LENGTH ||
        !holdsAsSubscriberDetail(reason)
    ) {
        throw new UnprocessableEntityException(
            codedError(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_CANCELLATION_REASON_INVALID, {
                number,
                max: INVOICE_CANCELLATION_REASON_MAX_LENGTH,
            }),
        );
    }
    const address = request.deliverTo?.trim() ?? '';
    if (address !== '' && !isDeliverableAddress(address)) {
        throw new UnprocessableEntityException(
            codedError(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DELIVERY_ADDRESS_INVALID, {
                number,
            }),
        );
    }
    return {
        reason,
        corrections: settleInvoiceCorrections(request.corrections ?? {}),
        deliverTo: address === '' ? null : address,
    };
}
