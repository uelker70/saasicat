// The turn of an invoice's chain (`SC-PRIC-036`): whatever changes what an
// invoice of a chain owes or how it is collected — a payment, a reversal, a
// cancellation, a collection attempt — locks the chain's first invoice, so two
// of them never read one replacement at once. `chainId` is written once, with
// the invoice, so reading it on the way to the lock reads what the lock is then
// taken on.

import type { PrismaModelDelegateLike } from './prisma-client-token.js';
import { idsOf } from './raw-ids.js';

/** The part of a client a turn is taken with. */
export interface RawPrisma {
    $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/** The part of a client what corrects an invoice is read with. */
export interface ChainPrisma {
    subscriptionInvoiceCancellation: PrismaModelDelegateLike<{
        cancelledInvoiceId: string;
        cancellationInvoiceId: string;
        replacementInvoiceId: string | null;
    }>;
}

/**
 * Takes the turn of the chain `invoiceId` belongs to until the transaction
 * `db` is on ends, and answers the chain's id — its first invoice's; `null`
 * where the invoice does not exist.
 */
export async function lockChainOf(db: RawPrisma, invoiceId: string): Promise<string | null> {
    const [chainId] = idsOf(
        await db.$queryRaw`
            SELECT "id" FROM "subscription_invoices"
             WHERE "id" = (SELECT "chainId" FROM "subscription_invoices" WHERE "id" = ${invoiceId})
               FOR UPDATE`,
    );
    return chainId ?? null;
}

/** Takes the turn of the chain `chainId` — its first invoice's id — until the transaction `db` is on ends. */
export async function lockChain(db: RawPrisma, chainId: string): Promise<void> {
    await db.$queryRaw`
        SELECT "id" FROM "subscription_invoices" WHERE "id" = ${chainId} FOR UPDATE`;
}

/**
 * The invoice that stands in the chain of `invoiceId` (`SC-PRIC-025`): the
 * invoice itself where it is not cancelled, otherwise the replacement of its
 * cancellation, followed on where that is cancelled as well. `null` where a
 * cancellation left no replacement. Read in the chain's turn.
 */
export async function standingInvoiceIdOf(
    db: ChainPrisma,
    invoiceId: string,
): Promise<string | null> {
    let standing = invoiceId;
    for (;;) {
        const cancellation = await db.subscriptionInvoiceCancellation.findUnique({
            where: { cancelledInvoiceId: standing },
            select: { replacementInvoiceId: true },
        });
        if (!cancellation) return standing;
        if (cancellation.replacementInvoiceId === null) return null;
        standing = cancellation.replacementInvoiceId;
    }
}

/** Whether `invoiceId` is cancelled, or is a cancellation invoice: either owes nothing. */
export async function correctedStateOf(
    db: ChainPrisma,
    invoiceId: string,
): Promise<{ cancelled: boolean; isCancellation: boolean }> {
    const rows = await db.subscriptionInvoiceCancellation.findMany({
        where: {
            OR: [{ cancelledInvoiceId: invoiceId }, { cancellationInvoiceId: invoiceId }],
        },
        select: { cancelledInvoiceId: true, cancellationInvoiceId: true },
    });
    return {
        cancelled: rows.some((row) => row.cancelledInvoiceId === invoiceId),
        isCancellation: rows.some((row) => row.cancellationInvoiceId === invoiceId),
    };
}
