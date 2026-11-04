// What a subscriber's account shows its tenant (`SC-PRIC-049`): per currency,
// what its invoices still owe and of that what is overdue, and beside it what
// the subscriber is owed, to be paid out — its credit. The two are never set
// off against each other: a credit is paid out, not taken off an invoice.
//
// Read from the standings the invoice list beside it shows, so the summary and
// the list never disagree. An invoice whose total is negative is to be
// refunded from the moment it is issued, while the credit it gives rise to is
// recorded by a later run; until then it counts here by its own amount, as the
// list says it is to be refunded, and afterwards by its credit, never twice.
// Charges that stand on no invoice yet are not shown: they are owed once an
// invoice names them.

import type { InvoiceStanding, StandingInvoice } from './invoice-standing.js';
import { toCents } from './money.js';
import type { SubscriberCreditStanding } from './subscriber-payment.types.js';

/** One currency of a subscriber's account. */
export interface TenantAccountBalance {
    currency: string;
    /** What the subscriber's invoices still owe. */
    owed: number;
    /** Of `owed`, what was due before today. */
    overdue: number;
    /** What the subscriber is owed, to be paid out. */
    credit: number;
}

/** A subscriber's account, one balance per currency in which anything is open, by currency. */
export interface TenantAccount {
    balances: TenantAccountBalance[];
}

/** An invoice with where it stands, as the tenant's list reads it. */
export interface AccountInvoice {
    invoice: Pick<StandingInvoice, 'id'> & { currency: string };
    standing: InvoiceStanding;
}

/** The balances of the subscriber whose invoices `standings` and credits `credits` are. */
export function tenantAccountOf(
    standings: readonly AccountInvoice[],
    credits: readonly SubscriberCreditStanding[],
): TenantAccount {
    const cents = new Map<string, { owed: number; overdue: number; credit: number }>();
    const of = (currency: string) => {
        const known = cents.get(currency);
        if (known) return known;
        const fresh = { owed: 0, overdue: 0, credit: 0 };
        cents.set(currency, fresh);
        return fresh;
    };
    const credited = new Set(
        credits.flatMap(({ credit: { origin } }) =>
            origin.kind === 'invoice' ? [origin.invoiceId] : [],
        ),
    );
    for (const { invoice, standing } of standings) {
        const payment = standing.payment;
        if (payment?.kind === 'open' || payment?.kind === 'reversed') {
            const balance = of(invoice.currency);
            balance.owed += toCents(payment.owed);
            if (payment.overdue) balance.overdue += toCents(payment.owed);
        } else if (payment?.kind === 'to-be-refunded' && !credited.has(invoice.id)) {
            of(invoice.currency).credit += toCents(payment.open);
        }
    }
    for (const { credit, open } of credits) {
        of(credit.currency).credit += toCents(open);
    }
    return {
        balances: [...cents]
            .filter(([, balance]) => balance.owed > 0 || balance.credit > 0)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([currency, balance]) => ({
                currency,
                owed: balance.owed / 100,
                overdue: balance.overdue / 100,
                credit: balance.credit / 100,
            })),
    };
}
