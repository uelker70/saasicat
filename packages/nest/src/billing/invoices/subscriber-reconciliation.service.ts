// What the operator reconciles: the cases the gateway reported and nothing
// matched, on a list of their own and closed with a note, and a tenant's
// invoices with what each still owes beside its open cases (`SC-ADM-033`).
//
// The list is platform-wide, and the operator's routes read it inside
// `RlsBypassPort`, as they read the tenant they are asked about.

import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
    INVOICE_ERROR_CODES,
    type AdminReconciliationCase,
    type AdminReconciliationCases,
    type AdminTenantPayments,
    type ReconciliationCaseState,
    type SubscriberPaymentRepository,
    type SubscriberReconciliationCaseRecord,
    type SubscriberRepository,
    type SubscriptionInvoiceRepository,
} from '@saasicat/core';

import { codedError } from '../../errors/coded-error.js';
import { SUBSCRIBER_REPOSITORY_TOKEN } from '../../subscriber/subscriber.tokens.js';
import { SUBSCRIBER_PAYMENT_REPOSITORY_TOKEN } from './invoice-collection.tokens.js';
import { SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN } from './subscription-invoice.tokens.js';

/** How many cases one page of the list holds, and how many open cases a tenant's page shows. */
export const RECONCILIATION_PAGE_SIZE = 50;

/** What closing a case did: the case as it stands, and what it was before. */
export interface ClosedCase {
    case: AdminReconciliationCase;
    record: SubscriberReconciliationCaseRecord;
}

@Injectable()
export class SubscriberReconciliationService {
    constructor(
        @Inject(SUBSCRIBER_PAYMENT_REPOSITORY_TOKEN)
        private readonly payments: SubscriberPaymentRepository,
        @Inject(SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN)
        private readonly invoices: SubscriptionInvoiceRepository,
        @Inject(SUBSCRIBER_REPOSITORY_TOKEN)
        private readonly subscribers: SubscriberRepository,
    ) {}

    /** One page of the cases in `state`, the oldest first, after the case `after` names. */
    async cases(state: ReconciliationCaseState, after?: string): Promise<AdminReconciliationCases> {
        const page = await this.payments.listCases(
            { state },
            { limit: RECONCILIATION_PAGE_SIZE + 1, after },
        );
        const shown = page.slice(0, RECONCILIATION_PAGE_SIZE);
        return {
            cases: await this.viewsOf(shown),
            next: page.length > RECONCILIATION_PAGE_SIZE ? (shown.at(-1)?.id ?? null) : null,
        };
    }

    /**
     * Closes an open case with the operator's note. Refused where there is no
     * such case, and where it is closed already — by the operator, or by
     * SaaSiCat because the money came back —; nothing is written then.
     */
    async close(caseId: string, note: string, closedBy: string): Promise<ClosedCase> {
        const closed = await this.payments.closeCase({
            caseId,
            note: note.trim(),
            closedBy,
            at: new Date(),
        });
        if (closed.outcome === 'unknown-case') {
            throw new NotFoundException(
                codedError(INVOICE_ERROR_CODES.SUBSCRIBER_RECONCILIATION_CASE_NOT_FOUND, {
                    caseId,
                }),
            );
        }
        if (closed.outcome === 'already-closed') {
            throw new ConflictException(
                codedError(INVOICE_ERROR_CODES.SUBSCRIBER_RECONCILIATION_CASE_CLOSED, {
                    caseId,
                    closedAt: closed.case.closedAt?.toISOString() ?? '',
                }),
            );
        }
        const [view] = await this.viewsOf([closed.case]);
        if (!view) throw new Error(`The case ${caseId} was closed and cannot be read.`);
        return { case: view, record: closed.case };
    }

    /**
     * The tenant's invoices, the latest first, each with what it still owes,
     * what it corrects and the cancellation invoice that cancelled it, and its
     * cases still open, the oldest first; none for a tenant without a
     * subscriber.
     */
    async paymentsOf(tenantId: string): Promise<AdminTenantPayments> {
        const subscriber = await this.subscribers.findByTenantId(tenantId);
        if (!subscriber) return { invoices: [], openCases: [] };
        const invoices = await this.invoices.listBySubscriber(subscriber.id);
        const owed = new Map(
            (await this.payments.owedByInvoices(invoices.map((invoice) => invoice.id))).map(
                (each) => [each.invoiceId, each.owed],
            ),
        );
        const open = await this.payments.listCases(
            { state: 'open', subscriberId: subscriber.id },
            { limit: RECONCILIATION_PAGE_SIZE },
        );
        // A cancellation invoice belongs to the subscriber of the invoice it
        // cancels, so the list that holds one holds the other.
        const cancelledBy = new Map(
            invoices.flatMap((invoice) =>
                invoice.correction?.kind === 'cancellation'
                    ? [
                          [
                              invoice.correction.of.invoiceId,
                              { invoiceId: invoice.id, number: invoice.number },
                          ] as const,
                      ]
                    : [],
            ),
        );
        return {
            invoices: invoices.map((invoice) => ({
                id: invoice.id,
                number: invoice.number,
                issuedAt: invoice.issuedAt.toISOString(),
                dueDate: invoice.dueDate,
                totalGross: invoice.totalGross,
                currency: invoice.currency,
                owed: owed.get(invoice.id) ?? invoice.totalGross,
                correction: invoice.correction
                    ? { kind: invoice.correction.kind, of: invoice.correction.of }
                    : null,
                cancelledBy: cancelledBy.get(invoice.id) ?? null,
            })),
            openCases: await this.viewsOf(open),
        };
    }

    /**
     * The cases with whom and what each is about named as the operator knows
     * them. A page is short and its cases few; each subscriber, payment and
     * invoice is read once for it.
     */
    private async viewsOf(
        cases: readonly SubscriberReconciliationCaseRecord[],
    ): Promise<AdminReconciliationCase[]> {
        const subscriberOf = once((id: string) => this.subscribers.findById(id));
        const paymentOf = once((id: string) => this.payments.findPaymentById(id));
        const invoiceOf = once((id: string) => this.invoices.findById(id));
        const views: AdminReconciliationCase[] = [];
        for (const each of cases) {
            const subscriber = await subscriberOf(each.subscriberId);
            const payment = await paymentOf(each.paymentId);
            const invoice = payment ? await invoiceOf(payment.invoiceId) : null;
            views.push({
                id: each.id,
                kind: each.kind,
                amount: each.amount,
                currency: each.currency,
                tenantId: each.tenantId,
                subscriber: {
                    id: each.subscriberId,
                    customerNumber: subscriber?.customerNumber ?? '',
                    legalName: subscriber?.legalName ?? '',
                },
                payment: {
                    ref: payment?.gatewayRef ?? each.paymentId,
                    invoiceNumber: invoice?.number ?? null,
                },
                gatewayAccount: each.gatewayAccount,
                reference: each.gatewayRef,
                recordedAt: each.recordedAt.toISOString(),
                closedAt: each.closedAt?.toISOString() ?? null,
                closedBy: each.closedBy,
                note: each.note,
            });
        }
        return views;
    }
}

/** `read`, asked once per id however often it is called with it. */
function once<T>(read: (id: string) => Promise<T>): (id: string) => Promise<T> {
    const seen = new Map<string, Promise<T>>();
    return (id) => {
        const known = seen.get(id);
        if (known) return known;
        const reading = read(id);
        seen.set(id, reading);
        return reading;
    };
}
