// What an invoice still owes and what a credit still holds, as the signed sums
// `owedByInvoice` and `openOfCredit` in `@saasicat/core` compute them — in SQL,
// for the queries that read many at once. The signs are the core's, passed as
// parameters, so the rule is decided there alone. Exact in the database's
// numeric arithmetic.

import { inArray, sql } from 'drizzle-orm';
import { GIVING_BACK_CREDIT_ENTRY_KINDS, REOPENING_SETTLEMENT_KINDS } from '@saasicat/core';

import {
    subscriberCreditEntries,
    subscriberCredits,
    subscriptionInvoiceCancellations,
    subscriptionInvoiceSettlements,
    subscriptionInvoices,
} from './schema.js';

/** What is settled against the invoice a query reads, each settlement signed. */
export const settledOnInvoice = sql`COALESCE((
    SELECT SUM(CASE WHEN ${inArray(subscriptionInvoiceSettlements.kind, [...REOPENING_SETTLEMENT_KINDS])}
                    THEN -${subscriptionInvoiceSettlements.amount}
                    ELSE ${subscriptionInvoiceSettlements.amount} END)
      FROM ${subscriptionInvoiceSettlements}
     WHERE ${subscriptionInvoiceSettlements.invoiceId} = ${subscriptionInvoices.id}
), 0)`;

/** What the invoice a query reads still owes, before its cancellation is asked about. */
export const owedOnInvoice = sql`(${subscriptionInvoices.totalGross} - ${settledOnInvoice})`;

/**
 * Whether the invoice a query reads still owes something: its total exceeds
 * what is settled against it, and it is neither cancelled nor a cancellation
 * invoice.
 */
export const stillOwes = sql`${subscriptionInvoices.totalGross} > ${settledOnInvoice}
AND NOT EXISTS (
    SELECT 1 FROM ${subscriptionInvoiceCancellations}
     WHERE ${subscriptionInvoiceCancellations.cancelledInvoiceId} = ${subscriptionInvoices.id}
        OR ${subscriptionInvoiceCancellations.cancellationInvoiceId} = ${subscriptionInvoices.id}
)`;

/** What was paid out of the credit a query reads, an entry that gives back counted against it. */
export const paidOutOfCredit = sql`COALESCE((
    SELECT SUM(CASE WHEN ${inArray(subscriberCreditEntries.kind, [...GIVING_BACK_CREDIT_ENTRY_KINDS])}
                    THEN -${subscriberCreditEntries.amount}
                    ELSE ${subscriberCreditEntries.amount} END)
      FROM ${subscriberCreditEntries}
     WHERE ${subscriberCreditEntries.creditId} = ${subscriberCredits.id}
), 0)`;

/** What the credit a query reads still holds. */
export const openOfCreditSql = sql`(${subscriberCredits.amount} - ${paidOutOfCredit})`;
