// A subscriber's credits as the operator reads them, and the payout the
// operator records against one where the gateway can no longer refund it — its
// account no longer configured, or the payment past the gateway's own refund
// period (`SC-PRIC-031`, `SC-PRIC-083`). SaaSiCat pays nothing out itself: a
// payout is recorded once it left, with the reference the operator's bank
// statement names, and never beyond what the credit still owes.

import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import {
    INVOICE_ERROR_CODES,
    dayInZone,
    type AdminSubscriberCredit,
    type AdminSubscriberCreditEntry,
    type AdminSubscriberCredits,
    type AdminSubscriberPayout,
    type PlanCatalogSettings,
    type SubscriberCreditStanding,
    type SubscriberPaymentRepository,
    type SubscriberRepository,
    type SubscriptionInvoiceRepository,
} from '@saasicat/core';

import { codedError } from '../../errors/coded-error.js';
import { SUBSCRIBER_REPOSITORY_TOKEN } from '../../subscriber/subscriber.tokens.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from '../plan-catalog.module.js';
import { SUBSCRIBER_PAYMENT_REPOSITORY_TOKEN } from './invoice-collection.tokens.js';
import { SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN } from './subscription-invoice.tokens.js';

/** What recording a payout did: the entry it wrote, and the credits as they stand after it. */
export interface RecordedPayout {
    entry: AdminSubscriberCreditEntry;
    credits: AdminSubscriberCredits;
}

@Injectable()
export class SubscriberCreditService {
    constructor(
        @Inject(SUBSCRIBER_PAYMENT_REPOSITORY_TOKEN)
        private readonly payments: SubscriberPaymentRepository,
        @Inject(SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN)
        private readonly invoices: SubscriptionInvoiceRepository,
        @Inject(SUBSCRIBER_REPOSITORY_TOKEN)
        private readonly subscribers: SubscriberRepository,
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: PlanCatalogSettings,
    ) {}

    /** The credits of the tenant's subscriber, the oldest first; none for a tenant without one. */
    async creditsOf(tenantId: string): Promise<AdminSubscriberCredits> {
        const subscriber = await this.subscribers.findByTenantId(tenantId);
        if (!subscriber) return { credits: [] };
        return this.viewOf(await this.payments.listCredits(subscriber.id));
    }

    /**
     * Records a payout the operator made against one credit of the tenant's
     * subscriber. Refused where the credit is another subscriber's — the
     * tenant's page reaches only its own —, where the day it left is still to
     * come in the installation's zone, and where it exceeds what the credit
     * still owes; nothing is written then.
     */
    async payOut(
        tenantId: string,
        creditId: string,
        payout: AdminSubscriberPayout,
        recordedBy: string,
        now: Date = new Date(),
    ): Promise<RecordedPayout> {
        const subscriber = await this.subscribers.findByTenantId(tenantId);
        if (!subscriber) throw creditNotFound(creditId);
        const own = await this.payments.listCredits(subscriber.id);
        if (!own.some(({ credit }) => credit.id === creditId)) throw creditNotFound(creditId);
        const zone = this.settings.timeZone;
        if (!zone) {
            throw new Error('Invoicing runs without a time zone, which its start refuses.');
        }
        const today = dayInZone(now, zone);
        if (payout.paidOn > today) {
            throw new BadRequestException(
                codedError(INVOICE_ERROR_CODES.SUBSCRIBER_PAYOUT_NOT_MADE_YET, {
                    paidOn: payout.paidOn,
                    today,
                }),
            );
        }
        const recorded = await this.payments.recordPayout({
            creditId,
            amount: payout.amount,
            reference: payout.reference.trim(),
            paidOn: payout.paidOn,
            note: payout.note?.trim() || null,
            recordedBy,
            at: now,
        });
        if (recorded.outcome === 'unknown-credit') throw creditNotFound(creditId);
        if (recorded.outcome === 'exceeds-open') {
            throw new ConflictException(
                codedError(INVOICE_ERROR_CODES.SUBSCRIBER_PAYOUT_EXCEEDS_CREDIT, {
                    creditId,
                    open: recorded.open.toFixed(2),
                }),
            );
        }
        return {
            entry: entryViewOf(recorded.entry),
            credits: await this.viewOf(await this.payments.listCredits(subscriber.id)),
        };
    }

    /** The credits with where each comes from named as the operator knows it: by invoice number. */
    private async viewOf(standings: SubscriberCreditStanding[]): Promise<AdminSubscriberCredits> {
        const numbers = new Map<string, string | null>();
        const numberOf = async (invoiceId: string): Promise<string | null> => {
            if (!numbers.has(invoiceId)) {
                numbers.set(invoiceId, (await this.invoices.findById(invoiceId))?.number ?? null);
            }
            return numbers.get(invoiceId) ?? null;
        };
        const credits: AdminSubscriberCredit[] = [];
        for (const { credit, entries, open } of standings) {
            const { origin } = credit;
            let shown: AdminSubscriberCredit['origin'];
            if (origin.kind === 'invoice') {
                shown = { kind: 'invoice', invoiceNumber: await numberOf(origin.invoiceId) };
            } else {
                const payment = await this.payments.findPaymentById(origin.paymentId);
                shown = {
                    kind: 'payment',
                    paymentRef: payment?.gatewayRef ?? origin.paymentId,
                    invoiceNumber: payment ? await numberOf(payment.invoiceId) : null,
                };
            }
            credits.push({
                id: credit.id,
                amount: credit.amount,
                currency: credit.currency,
                origin: shown,
                createdAt: credit.createdAt.toISOString(),
                open,
                entries: entries.map(entryViewOf),
            });
        }
        return { credits };
    }
}

function entryViewOf(
    entry: SubscriberCreditStanding['entries'][number],
): AdminSubscriberCreditEntry {
    return {
        kind: entry.kind,
        amount: entry.amount,
        reference: entry.reference,
        paidOn: entry.paidOn,
        note: entry.note,
        recordedAt: entry.recordedAt.toISOString(),
    };
}

function creditNotFound(creditId: string): NotFoundException {
    return new NotFoundException(
        codedError(INVOICE_ERROR_CODES.SUBSCRIBER_CREDIT_NOT_FOUND, { creditId }),
    );
}
