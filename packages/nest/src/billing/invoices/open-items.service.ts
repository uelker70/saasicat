// The open items of the installation as the operator reads them (`SC-ADM-044`):
// the invoices that still owe something, the oldest due date first, each with
// how it is paid and its latest collection attempt, the credits the operator
// still owes a subscriber, and what both add up to. What either owes is the
// store's to read, by the rule in `@saasicat/core`; this service names who and
// how, a page at a time, in a few reads per page. The days are the
// installation's; the read is platform-wide, so inside `RlsBypassPort`.

import { Inject, Injectable, Optional } from '@nestjs/common';
import {
    OPEN_ITEMS_PAGE_SIZE,
    dayInZone,
    daysOverdue,
    latestAttemptsOf,
    type AdminOpenCredit,
    type AdminOpenCreditPage,
    type AdminOpenInvoice,
    type AdminOpenInvoicePage,
    type AdminOpenItemTotals,
    type CalendarDay,
    type InvoiceCollectionRecord,
    type InvoiceCollectionRepository,
    type OwedCredit,
    type PlanCatalogSettings,
    type RlsBypassPort,
    type SubscriberPaymentRepository,
    type SubscriberRecord,
    type SubscriberRepository,
    type SubscriptionInvoiceRecord,
    type SubscriptionInvoiceRepository,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { readAcrossTenants } from '../../admin/read-across-tenants.js';
import { SUBSCRIBER_REPOSITORY_TOKEN } from '../../subscriber/subscriber.tokens.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from '../plan-catalog.module.js';
import {
    INVOICE_COLLECTION_REPOSITORY_TOKEN,
    SUBSCRIBER_PAYMENT_REPOSITORY_TOKEN,
} from './invoice-collection.tokens.js';
import { SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN } from './subscription-invoice.tokens.js';

/** The page to read: the first, or the one after `after`, `limit` long. */
function pageOf(after: string | undefined): { limit: number; after?: string } {
    return after === undefined
        ? { limit: OPEN_ITEMS_PAGE_SIZE }
        : { limit: OPEN_ITEMS_PAGE_SIZE, after };
}

/** One open invoice as the operator reads it. */
function openInvoiceOf(
    invoice: SubscriptionInvoiceRecord,
    owed: number,
    attempt: InvoiceCollectionRecord | undefined,
    today: CalendarDay,
): AdminOpenInvoice {
    return {
        id: invoice.id,
        number: invoice.number,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        daysOverdue: daysOverdue(invoice.dueDate, today),
        currency: invoice.currency,
        totalGross: invoice.totalGross,
        owed,
        subscriber: {
            id: invoice.subscriberId,
            customerNumber: invoice.subscriber.customerNumber,
            legalName: invoice.subscriber.legalName,
        },
        tenantId: invoice.tenantId,
        payment: invoice.payment
            ? { type: invoice.payment.type, last4: invoice.payment.last4 }
            : null,
        lastAttempt: attempt
            ? {
                  status: attempt.status,
                  submittedAt: attempt.submittedAt?.toISOString() ?? null,
                  failureReason: attempt.failureReason,
              }
            : null,
    };
}

/** One open credit as the operator reads it, its subscriber as the record names it now. */
function openCreditOf({ credit, open }: OwedCredit, subscriber: SubscriberRecord): AdminOpenCredit {
    return {
        id: credit.id,
        currency: credit.currency,
        amount: credit.amount,
        open,
        origin: credit.origin.kind,
        createdAt: credit.createdAt.toISOString(),
        subscriber: {
            id: subscriber.id,
            customerNumber: subscriber.customerNumber,
            legalName: subscriber.legalName,
        },
        tenantId: credit.tenantId,
    };
}

@Injectable()
export class OpenItemsService {
    constructor(
        @Inject(SUBSCRIBER_PAYMENT_REPOSITORY_TOKEN)
        private readonly payments: SubscriberPaymentRepository,
        @Inject(SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN)
        private readonly invoices: SubscriptionInvoiceRepository,
        @Inject(INVOICE_COLLECTION_REPOSITORY_TOKEN)
        private readonly collections: InvoiceCollectionRepository,
        @Inject(SUBSCRIBER_REPOSITORY_TOKEN)
        private readonly subscribers: SubscriberRepository,
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: PlanCatalogSettings,
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
    ) {}

    /**
     * One page of the invoices that still owe something, the oldest due date
     * first — of those overdue today alone, where `overdue` is set —, each
     * with what it owes, how many days it is overdue, how it is paid and its
     * latest collection attempt; the page after the invoice `after` names,
     * where it is given.
     */
    async invoicesPage(
        query: { overdue?: boolean; after?: string },
        now: Date = new Date(),
    ): Promise<AdminOpenInvoicePage> {
        const today = this.todayOf(now);
        const overdueOnly = query.overdue === true;
        return readAcrossTenants(this.rlsBypass, async () => {
            const page = await this.payments.listOpenInvoices(
                overdueOnly ? { ...pageOf(query.after), overdueOn: today } : pageOf(query.after),
            );
            const ids = page.invoices.map(({ invoiceId }) => invoiceId);
            const records = new Map(
                (await this.invoices.findByIds(ids)).map((invoice) => [invoice.id, invoice]),
            );
            const attempts = latestAttemptsOf(await this.collections.listByInvoices(ids));
            const invoices = page.invoices.flatMap(({ invoiceId, owed }) => {
                const invoice = records.get(invoiceId);
                return invoice
                    ? [openInvoiceOf(invoice, owed, attempts.get(invoiceId), today)]
                    : [];
            });
            return {
                today,
                overdueOnly,
                invoices,
                next: page.hasMore ? (ids[ids.length - 1] ?? null) : null,
            };
        });
    }

    /**
     * One page of the credits the operator still owes, the oldest first, each
     * with the subscriber as its record names it now; the page after the
     * credit `after` names, where it is given.
     */
    async creditsPage(query: { after?: string }): Promise<AdminOpenCreditPage> {
        const timeZone = this.zone();
        return readAcrossTenants(this.rlsBypass, async () => {
            const page = await this.payments.listOpenCredits(pageOf(query.after));
            const subscribers = new Map(
                (
                    await this.subscribers.findByIds([
                        ...new Set(page.credits.map(({ credit }) => credit.subscriberId)),
                    ])
                ).map((subscriber) => [subscriber.id, subscriber]),
            );
            const credits = page.credits.flatMap((owed) => {
                const subscriber = subscribers.get(owed.credit.subscriberId);
                return subscriber ? [openCreditOf(owed, subscriber)] : [];
            });
            const last = page.credits[page.credits.length - 1];
            return { credits, next: page.hasMore && last ? last.credit.id : null, timeZone };
        });
    }

    /** What the open invoices and credits add up to per currency, of the invoices what is overdue today. */
    async totals(now: Date = new Date()): Promise<AdminOpenItemTotals> {
        const today = this.todayOf(now);
        return readAcrossTenants(this.rlsBypass, async () => ({
            today,
            ...(await this.payments.openItemTotals(today)),
        }));
    }

    private todayOf(now: Date): CalendarDay {
        return dayInZone(now, this.zone());
    }

    /** The installation's time zone, which invoicing requires to start. */
    private zone(): string {
        const zone = this.settings.timeZone;
        if (!zone) {
            throw new Error('Invoicing runs without a time zone, which its start refuses.');
        }
        return zone;
    }
}
