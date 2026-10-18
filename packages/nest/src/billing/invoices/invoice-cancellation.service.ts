// The correction of an issued invoice (`SC-PRIC-025`): a cancellation invoice
// that states it reversed and asks for nothing, a replacement for its charges,
// and what was paid for it moved onto the replacement — or, where the
// replacement does not take it, into credits — written in one transaction, in
// the turn of the invoice's chain (`SC-PRIC-036`). A collection of the
// cancelled invoice planned and not yet submitted is withdrawn with it.
//
// The preview and the cancellation take the same steps, so what the operator
// confirms is what is written (`SC-UI-017`): the preview stops before the first
// write and leaves nothing behind.
//
// The replacement names the cancelled invoice's issuer, with a correction of it
// declared in `config/saas.yaml` since (`SC-PRIC-026`), and its subscriber, with
// each correction of the subscriber's legal identity recorded since
// (`SC-SUB-017`) and the details the operator corrects with the cancellation.
// Its tax is decided again for the parties it names over the cancelled
// invoice's charges' period, a VAT identification number counting as validated
// only where the subscriber's record holds that same number with a valid check.
// It is an invoice of its own issue date: the footer lines are those the file
// names then (`SC-PRIC-077`), its payment term runs from it, and it is
// collected with the payment method in use unless what was paid covers it.

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
    INVOICE_ERROR_CODES,
    contractPartiesOf,
    correctedSubscriberOf,
    directDebitLeadDaysOf,
    draftCancellationInvoice,
    draftReplacementInvoice,
    invoiceContentDraftOf,
    invoiceFooterOf,
    invoicePaymentOf,
    movedPaymentParts,
    subscriberCorrectedSince,
    sumToCents,
    type CorrectedInvoiceSubscriber,
    type InvoiceCollectionRepository,
    type InvoicePaymentShare,
    type InvoiceSubscriberDetail,
    type MovedPaymentPart,
    type NewCorrectionInvoice,
    type PlanCatalogSettings,
    type SubscriberCreditRecord,
    type SubscriberLedgerRepository,
    type SubscriberPaymentMethodRepository,
    type SubscriberPaymentRepository,
    type SubscriptionInvoiceCancellationRecord,
    type SubscriptionInvoiceRecord,
    type SubscriptionInvoiceRepository,
    type TaxTreatment,
    type TransactionContext,
    type TransactionRunner,
} from '@saasicat/core';

import { codedError } from '../../errors/coded-error.js';
import { answeringRefusals } from '../../errors/answering-refusals.js';
import { SUBSCRIBER_PAYMENT_METHOD_REPOSITORY_TOKEN } from '../../payments/payments.tokens.js';
import { SubscriberService } from '../../subscriber/subscriber.service.js';
import { CONTRACT_TRANSACTION_RUNNER_TOKEN } from '../../subscription-contract/subscription-contract.tokens.js';
import { TAX_TREATMENTS_TOKEN } from '../../tax/tax.tokens.js';
import type { TaxTreatments } from '../../tax/tax-treatments.js';
import { SUBSCRIBER_LEDGER_REPOSITORY_TOKEN } from '../charges/subscriber-charge.tokens.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from '../plan-catalog.module.js';
import {
    INVOICE_COLLECTION_REPOSITORY_TOKEN,
    SUBSCRIBER_PAYMENT_REPOSITORY_TOKEN,
} from './invoice-collection.tokens.js';
import { SubscriptionInvoiceService } from './subscription-invoice.service.js';
import { SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN } from './subscription-invoice.tokens.js';

/** What the operator gives a cancellation. */
export interface InvoiceCancellationRequest {
    /** Why the invoice is cancelled; both invoices name it (`SC-ADM-020`). */
    reason: string;
    /** Details of the subscriber the cancelled invoice named wrongly, as the replacement names them. */
    corrections?: Partial<Record<InvoiceSubscriberDetail, string | null>>;
    /**
     * Where the subscriber's record holds no invoice email: the address both
     * invoices are delivered to (`SC-PRIC-047`).
     */
    deliverTo?: string | null;
}

/** What cancelling an invoice writes, as the preview shows it and the cancellation writes it. */
export interface InvoiceCancellationPlan {
    cancelled: SubscriptionInvoiceRecord;
    cancellation: NewCorrectionInvoice;
    replacement: NewCorrectionInvoice;
    /** The operator's corrections, each with the value it replaced; `null` where none. */
    correctedSubscriber: CorrectedInvoiceSubscriber | null;
    /** How each payment's share of the cancelled invoice moves, the oldest first. */
    moves: MovedPaymentPart[];
    /** What the replacement takes over of what was paid. */
    movedIn: number;
    /** What becomes a credit for the operator to refund. */
    credited: number;
}

/** What a cancellation wrote. */
export interface CancelledInvoice {
    cancellation: SubscriptionInvoiceCancellationRecord;
    cancellationInvoice: SubscriptionInvoiceRecord;
    replacement: SubscriptionInvoiceRecord;
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
    ) {}

    /**
     * Refuses to start without the transaction a cancellation is written on:
     * written one statement after another, an interruption would leave a
     * cancellation invoice without its replacement, or what was paid on an
     * invoice that no longer stands.
     */
    onModuleInit(): void {
        if (this.transactions) return;
        throw new Error(
            'Invoices cannot start:\n- cancelling an invoice needs the transaction the contracts ' +
                'are written on: give `contractFreeze.transactionRunner`, which `SaaSiCatModule` ' +
                'passes from the persistence bundle.',
        );
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
        return this.runner().run((tx) => this.planIn(tenantId, invoiceId, request, now, tx));
    }

    /**
     * Cancels invoice `invoiceId` of tenant `tenantId` at `now`, for
     * `cancelledBy`. Refused with `SUBSCRIPTION_INVOICE_NOT_FOUND` (404) for no
     * such invoice of the tenant, `SUBSCRIPTION_INVOICE_ALREADY_CANCELLED`
     * (409) for one cancelled already, `SUBSCRIPTION_INVOICE_NOT_YET_ARCHIVED`
     * (409) while its document is not archived, and with `422` for a
     * cancellation invoice, an invoice that states a credit, a subscriber
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
        return this.runner().run(async (tx) => {
            const plan = await this.planIn(tenantId, invoiceId, request, now, tx);
            const issued = await answeringRefusals(
                () =>
                    this.invoices.issueCancellation(
                        {
                            cancelledInvoiceId: invoiceId,
                            cancellation: plan.cancellation,
                            replacement: plan.replacement,
                            reason: request.reason,
                            correctedSubscriber: plan.correctedSubscriber,
                            deliverTo: request.deliverTo ?? null,
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
            if (!replacement)
                throw new Error(`The cancellation of ${invoiceId} wrote no replacement.`);
            const credits = this.payments
                ? await this.payments.moveShares(
                      {
                          cancellationId: issued.cancellation.id,
                          cancelledInvoiceId: invoiceId,
                          replacementInvoiceId: replacement.id,
                          parts: plan.moves,
                          at: now,
                      },
                      tx,
                  )
                : [];
            return {
                ...issued,
                replacement,
                credits,
                withdrawnCollections: await this.withdrawPlanned(invoiceId, now, tx),
            };
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
        await this.refuseUncancellable(cancelled, chain.cancellations, request);
        const subscriber = correctedSubscriberOf(
            subscriberCorrectedSince(
                cancelled.subscriber,
                await this.subscribers.listCorrections(cancelled.subscriberId),
                cancelled.issuedAt,
            ),
            request.corrections ?? {},
        );
        const configured = contractPartiesOf(
            await this.subscribers.getById(cancelled.subscriberId),
            this.subscribers.issuerNamed(),
        ).issuer;
        const issuer = await this.issuing.issuerFor(cancelled.issuer, configured);
        const treatment = await this.treatmentOf(cancelled, subscriber.subscriber, issuer, tx);
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
        const replacement = draftReplacementInvoice(cancelled, {
            ...issue,
            subscriber: subscriber.subscriber,
            issuer,
            footer: invoiceFooterOf(issuer, configured, invoicing.footer ?? []),
            treatment,
            tax: (lines) => this.taxes.invoiceTax(lines),
            paymentTermDays: invoicing.paymentTermDays,
            directDebitLeadDays: directDebitLeadDaysOf(invoicing),
            payment: invoicePaymentOf(method),
            paid: shares.reduce((sum, share) => sumToCents(sum, share.amount), 0),
        });
        this.refuseUnissuable(replacement, method?.id ?? null);
        const moves = movedPaymentParts(shares, replacement.totalGross);
        return {
            cancelled,
            cancellation: draftCancellationInvoice(cancelled, issue),
            replacement,
            correctedSubscriber: subscriber.corrected,
            moves,
            movedIn: moves.reduce((sum, part) => sumToCents(sum, part.movedIn), 0),
            credited: moves.reduce((sum, part) => sumToCents(sum, part.credited), 0),
        };
    }

    /** Refuses an invoice a cancellation does not correct (`SC-PRIC-025`, `SC-PRIC-036`). */
    private async refuseUncancellable(
        invoice: SubscriptionInvoiceRecord,
        cancellations: readonly SubscriptionInvoiceCancellationRecord[],
        request: InvoiceCancellationRequest,
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
        if (!record.invoiceEmail && !request.deliverTo?.trim()) {
            throw new UnprocessableEntityException(
                codedError(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_NO_DELIVERY_ADDRESS, {
                    ...params,
                    subscriberId: invoice.subscriberId,
                }),
            );
        }
    }

    /**
     * Refuses a replacement that the run would hold rather than issue: a direct
     * debit whose mandate reference cannot be announced (`SC-PRIC-028`), and
     * content the tax adapter requires and the replacement lacks
     * (`SC-PRIC-027`).
     */
    private refuseUnissuable(replacement: NewCorrectionInvoice, methodId: string | null): void {
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
        subscriber: SubscriptionInvoiceRecord['subscriber'],
        issuer: SubscriptionInvoiceRecord['issuer'],
        tx: TransactionContext,
    ): Promise<TaxTreatment> {
        const origin = await this.subscribers.taxOriginOfParty(
            cancelled.subscriberId,
            subscriber,
            tx,
        );
        const applied = this.taxes.decide(origin, await this.periodOf(cancelled), {
            country: issuer.country,
            vatId: issuer.vatId,
        });
        // Invoicing starts only beside a tax adapter, which decides every treatment.
        if (!applied.treatment) throw new Error('No tax adapter decided a treatment.');
        return applied.treatment;
    }

    /** The period the invoice's charges cover: from the first start to the last end. */
    private async periodOf(
        invoice: SubscriptionInvoiceRecord,
    ): Promise<{ from: Date; until: Date }> {
        const ids = new Set(invoice.lines.map((line) => line.chargeId));
        const charges = (await this.ledger.listBySubscription(invoice.subscriptionId)).filter(
            (charge) => ids.has(charge.id),
        );
        if (charges.length !== ids.size) {
            throw new Error(`The charges of invoice ${invoice.number} are not all in the journal.`);
        }
        const starts = charges.map((charge) => charge.periodStart.getTime());
        const ends = charges.map((charge) => charge.periodEnd.getTime());
        return { from: new Date(Math.min(...starts)), until: new Date(Math.max(...ends)) };
    }

    /**
     * Withdraws the collections of the cancelled invoice planned and not yet
     * submitted, so none of them is (`SC-PRIC-025`); one already submitted is
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
