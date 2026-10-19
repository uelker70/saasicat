// The turn of an invoice's chain (`SC-PRIC-036`): whatever changes what an
// invoice of a chain owes or how it is collected — a payment, a reversal, a
// cancellation, a collection attempt — locks the chain's first invoice, so two
// of them never read one replacement at once. `chainId` is written once, with
// the invoice, so reading it on the way to the lock reads what the lock is then
// taken on.

import { eq, inArray, or } from 'drizzle-orm';
import type { resolveDb } from './client.js';
import { subscriptionInvoiceCancellations, subscriptionInvoices } from './schema.js';

type Db = ReturnType<typeof resolveDb>;

/**
 * Takes the turn of the chain `invoiceId` belongs to until the transaction
 * `db` is on ends, and answers the chain's id — its first invoice's; `null`
 * where the invoice does not exist.
 */
export async function lockChainOf(db: Db, invoiceId: string): Promise<string | null> {
    const [invoice] = await db
        .select({ chainId: subscriptionInvoices.chainId })
        .from(subscriptionInvoices)
        .where(eq(subscriptionInvoices.id, invoiceId));
    if (!invoice) return null;
    await lockChain(db, invoice.chainId);
    return invoice.chainId;
}

/** Takes the turn of the chain `chainId` — its first invoice's id — until the transaction `db` is on ends. */
export async function lockChain(db: Db, chainId: string): Promise<void> {
    await db
        .select({ id: subscriptionInvoices.id })
        .from(subscriptionInvoices)
        .where(eq(subscriptionInvoices.id, chainId))
        .for('update');
}

/**
 * The invoice that stands in the chain of `invoiceId` (`SC-PRIC-025`): the
 * invoice itself where it is not cancelled, otherwise the replacement of its
 * cancellation, followed on where that is cancelled as well. `null` where a
 * cancellation left no replacement. Read in the chain's turn.
 */
export async function standingInvoiceIdOf(db: Db, invoiceId: string): Promise<string | null> {
    let standing = invoiceId;
    for (;;) {
        const [cancellation] = await db
            .select({ replacementInvoiceId: subscriptionInvoiceCancellations.replacementInvoiceId })
            .from(subscriptionInvoiceCancellations)
            .where(eq(subscriptionInvoiceCancellations.cancelledInvoiceId, standing));
        if (!cancellation) return standing;
        if (cancellation.replacementInvoiceId === null) return null;
        standing = cancellation.replacementInvoiceId;
    }
}

/** Whether `invoiceId` is cancelled, or is a cancellation invoice: either owes nothing. */
export async function correctedStateOf(
    db: Db,
    invoiceId: string,
): Promise<{ cancelled: boolean; isCancellation: boolean }> {
    const rows = await db
        .select({
            cancelledInvoiceId: subscriptionInvoiceCancellations.cancelledInvoiceId,
            cancellationInvoiceId: subscriptionInvoiceCancellations.cancellationInvoiceId,
        })
        .from(subscriptionInvoiceCancellations)
        .where(
            or(
                eq(subscriptionInvoiceCancellations.cancelledInvoiceId, invoiceId),
                eq(subscriptionInvoiceCancellations.cancellationInvoiceId, invoiceId),
            ),
        );
    return {
        cancelled: rows.some((row) => row.cancelledInvoiceId === invoiceId),
        isCancellation: rows.some((row) => row.cancellationInvoiceId === invoiceId),
    };
}

/**
 * Whether each of `invoiceIds` is cancelled, or is a cancellation invoice, as
 * `owedByInvoice` takes it.
 */
export async function correctedStatesOf(
    db: Db,
    invoiceIds: readonly string[],
): Promise<(invoiceId: string) => { cancelled: boolean; isCancellation: boolean }> {
    const rows =
        invoiceIds.length === 0
            ? []
            : await db
                  .select({
                      cancelledInvoiceId: subscriptionInvoiceCancellations.cancelledInvoiceId,
                      cancellationInvoiceId: subscriptionInvoiceCancellations.cancellationInvoiceId,
                  })
                  .from(subscriptionInvoiceCancellations)
                  .where(
                      or(
                          inArray(subscriptionInvoiceCancellations.cancelledInvoiceId, [
                              ...invoiceIds,
                          ]),
                          inArray(subscriptionInvoiceCancellations.cancellationInvoiceId, [
                              ...invoiceIds,
                          ]),
                      ),
                  );
    const cancelled = new Set(rows.map((row) => row.cancelledInvoiceId));
    const cancellations = new Set(rows.map((row) => row.cancellationInvoiceId));
    return (invoiceId) => ({
        cancelled: cancelled.has(invoiceId),
        isCancellation: cancellations.has(invoiceId),
    });
}
