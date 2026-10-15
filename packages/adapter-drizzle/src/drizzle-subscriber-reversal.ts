// A reversal against `subscriber_reversals`, and the entries it writes
// against the credits and the invoices its payment reached.
//
// What a reversal withdrew and what the gateway gave back of it are reported in
// total, so a report arriving twice or out of order applies only what grew
// since the reversal was last recorded. That is decided in the turn of every
// invoice the payment settles, with every credit of its subscriber held, and
// the reversal's own row held as well: of two reports at the same moment one
// applies the change and the other finds it applied.

import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import type {
    CoveringCredit,
    RecordedSubscriberReversal,
    ReportedSubscriberReversal,
    ReversalReinstatement,
    ReversalWithdrawal,
    ReversibleCredit,
    SubscriberPaymentRecord,
    SubscriberReversalRecord,
} from '@saasicat/core';
import {
    CASE_CLOSED_REVERSAL_GIVEN_BACK,
    casesCovered,
    netByInvoice,
    paidOutByCredit,
    reinstatementParts,
    reversalEntryColumns,
    settledAmountOf,
    subscriberReversalColumns,
    toCents,
    toDecimalString,
    toSubscriberCreditEntryRecord,
    toSubscriberCreditRecord,
    toSubscriberPaymentRecord,
    toSubscriberReconciliationCaseRecord,
    toSubscriberReversalRecord,
    withdrawalParts,
} from '@saasicat/core';
import { closeCasesOf, openCase } from './drizzle-reconciliation-cases.js';
import {
    createCredit,
    type Db,
    holdCredits,
    lockInvoice,
    openOf,
    owedIn,
} from './drizzle-subscriber-payment-rows.js';
import {
    subscriberCreditEntries,
    subscriberCredits,
    subscriberPayments,
    subscriberReconciliationCases,
    subscriberReversals,
    subscriptionInvoiceSettlements,
} from './schema.js';

/** Records a reversal as the gateway reports it; see `SubscriberPaymentRepository.recordReversal`. */
export async function recordReversalIn(
    db: Db,
    reported: ReportedSubscriberReversal,
): Promise<RecordedSubscriberReversal> {
    const [paymentRow] = await db
        .select()
        .from(subscriberPayments)
        .where(
            and(
                eq(subscriberPayments.gatewayAccount, reported.gatewayAccount),
                eq(subscriberPayments.gatewayRef, reported.paymentRef),
            ),
        );
    if (!paymentRow) return { outcome: 'unknown-payment' };
    const payment = toSubscriberPaymentRecord(paymentRow);
    if (reported.currency !== payment.currency) {
        throw new Error(
            `Reversal ${reported.gatewayRef} at '${reported.gatewayAccount}' is in ` +
                `${reported.currency}, and payment ${payment.gatewayRef} it takes back in ` +
                `${payment.currency}.`,
        );
    }
    await takeTurns(db, payment);
    let reversal = await heldReversal(db, reported, payment);
    const withdrawn = toCents(reported.withdrawn) - toCents(reversal.amount);
    let withdrawal: ReversalWithdrawal | null = null;
    if (withdrawn > 0) {
        const taken = await withdraw(db, reversal, payment, withdrawn / 100, reported.at);
        reversal = {
            ...reversal,
            amount: reported.withdrawn,
            fromCredit: (toCents(reversal.fromCredit) + toCents(taken.fromCredit)) / 100,
        };
        await db
            .update(subscriberReversals)
            .set({
                amount: toDecimalString(reversal.amount),
                fromCredit: toDecimalString(reversal.fromCredit),
            })
            .where(eq(subscriberReversals.id, reversal.id));
        withdrawal = taken.withdrawal;
    }
    // Never more than it withdrew: what the gateway gives back returns what
    // the reversal took, and nothing beyond.
    const given =
        Math.min(toCents(reported.reinstated), toCents(reversal.amount)) -
        toCents(reversal.reinstated);
    let reinstatement: ReversalReinstatement | null = null;
    if (given > 0) {
        reinstatement = await reinstate(db, reversal, payment, given / 100, reported.at);
        reversal = {
            ...reversal,
            reinstated: (toCents(reversal.reinstated) + given) / 100,
            reinstatedAt: reported.at,
        };
        await db
            .update(subscriberReversals)
            .set({ reinstated: toDecimalString(reversal.reinstated), reinstatedAt: reported.at })
            .where(eq(subscriberReversals.id, reversal.id));
    }
    if (!withdrawal && !reinstatement) return { outcome: 'unchanged', reversal };
    return { outcome: 'recorded', reversal, withdrawal, reinstatement };
}

/**
 * Takes the turn of every invoice the payment settles, in one order, then
 * holds the subscriber's credits — the order a payment and a refund take them
 * in, so none of them waits on another in a circle.
 */
async function takeTurns(db: Db, payment: SubscriberPaymentRecord): Promise<void> {
    const settled = await db
        .select({ invoiceId: subscriptionInvoiceSettlements.invoiceId })
        .from(subscriptionInvoiceSettlements)
        .where(eq(subscriptionInvoiceSettlements.paymentId, payment.id));
    const invoiceIds = [
        ...new Set([payment.invoiceId, ...settled.map((row) => row.invoiceId)]),
    ].sort((a, b) => a.localeCompare(b, 'en'));
    for (const invoiceId of invoiceIds) await lockInvoice(db, invoiceId);
    await holdCredits(db, payment.subscriberId);
}

/** The reversal under its gateway account and reference, written where it is new, and held. */
async function heldReversal(
    db: Db,
    reported: ReportedSubscriberReversal,
    payment: SubscriberPaymentRecord,
): Promise<SubscriberReversalRecord> {
    await db
        .insert(subscriberReversals)
        .values({ id: randomUUID(), ...subscriberReversalColumns(reported, payment) })
        .onConflictDoNothing();
    const [row] = await db
        .select()
        .from(subscriberReversals)
        .where(
            and(
                eq(subscriberReversals.gatewayAccount, reported.gatewayAccount),
                eq(subscriberReversals.gatewayRef, reported.gatewayRef),
            ),
        )
        .for('update');
    if (!row) throw new Error(`Reversal ${reported.gatewayRef} was neither written nor found.`);
    const reversal = toSubscriberReversalRecord(row);
    if (reversal.paymentId !== payment.id) {
        throw new Error(
            `Reversal ${reported.gatewayRef} at '${reported.gatewayAccount}' is recorded against ` +
                `payment ${reversal.paymentId}, and reported against ${payment.id}.`,
        );
    }
    return reversal;
}

/** Writes what `amount`, newly withdrawn, takes back of what the payment brought. */
async function withdraw(
    db: Db,
    reversal: SubscriberReversalRecord,
    payment: SubscriberPaymentRecord,
    amount: number,
    at: Date,
): Promise<{ fromCredit: number; withdrawal: ReversalWithdrawal }> {
    const settlements = await db
        .select()
        .from(subscriptionInvoiceSettlements)
        .where(eq(subscriptionInvoiceSettlements.paymentId, payment.id))
        .orderBy(
            asc(subscriptionInvoiceSettlements.recordedAt),
            asc(subscriptionInvoiceSettlements.id),
        );
    const invoices = netByInvoice(
        settlements.map((row) => ({ invoiceId: row.invoiceId, amount: settledAmountOf(row) })),
    ).map((net) => ({ invoiceId: net.invoiceId, left: net.amount }));
    const parts = withdrawalParts(
        amount,
        await reversibleCredit(db, payment),
        invoices,
        await coveringCredits(
            db,
            payment,
            invoices.map((each) => each.invoiceId),
        ),
    );
    const takenOfCredits = parts.credit ? [parts.credit, ...parts.covering] : parts.covering;
    for (const part of takenOfCredits) {
        await db.insert(subscriberCreditEntries).values({
            id: randomUUID(),
            ...reversalEntryColumns(part.creditId, reversal, 'REVERSAL', part.amount, at),
        });
    }
    for (const part of parts.invoices) {
        await db.insert(subscriptionInvoiceSettlements).values({
            id: randomUUID(),
            invoiceId: part.invoiceId,
            paymentId: payment.id,
            kind: 'REVERSAL',
            amount: toDecimalString(part.amount),
            reversalId: reversal.id,
            recordedAt: at,
        });
    }
    const opened =
        parts.unmatched > 0
            ? await openCase(db, {
                  kind: 'REVERSAL_UNMATCHED',
                  amount: parts.unmatched,
                  currency: payment.currency,
                  payment,
                  about: reversal,
                  at,
              })
            : null;
    return {
        fromCredit: parts.fromCredit,
        withdrawal: {
            credit: parts.credit,
            covering: parts.covering,
            invoices: parts.invoices,
            unmatched: parts.unmatched,
            case: opened,
        },
    };
}

/**
 * The open credits that other payments collected for `invoiceIds` left, the
 * oldest first: what covers what the reversal would open again of them.
 */
async function coveringCredits(
    db: Db,
    payment: SubscriberPaymentRecord,
    invoiceIds: readonly string[],
): Promise<CoveringCredit[]> {
    if (invoiceIds.length === 0) return [];
    const rows = await db
        .select({ id: subscriberCredits.id })
        .from(subscriberCredits)
        .innerJoin(subscriberPayments, eq(subscriberPayments.id, subscriberCredits.originPaymentId))
        .where(
            and(
                inArray(subscriberPayments.invoiceId, [...invoiceIds]),
                ne(subscriberPayments.id, payment.id),
            ),
        )
        .orderBy(asc(subscriberCredits.createdAt), asc(subscriberCredits.id));
    const covering: CoveringCredit[] = [];
    for (const row of rows) covering.push({ creditId: row.id, open: await openOf(db, row.id) });
    return covering;
}

/**
 * The credit the payment left, with what of it no reversal of the payment
 * took yet and what is still open of it; `null` where it left none.
 */
async function reversibleCredit(
    db: Db,
    payment: SubscriberPaymentRecord,
): Promise<ReversibleCredit | null> {
    const [row] = await db
        .select()
        .from(subscriberCredits)
        .where(eq(subscriberCredits.originPaymentId, payment.id));
    if (!row) return null;
    const credit = toSubscriberCreditRecord(row);
    const reversals = await db
        .select()
        .from(subscriberReversals)
        .where(eq(subscriberReversals.paymentId, payment.id));
    const taken = reversals
        .map(toSubscriberReversalRecord)
        .reduce((sum, each) => sum + toCents(each.fromCredit), 0);
    return {
        creditId: credit.id,
        left: (toCents(credit.amount) - taken) / 100,
        open: await openOf(db, credit.id),
    };
}

/** Writes what `amount`, newly given back by the gateway, returns of what the reversal took. */
async function reinstate(
    db: Db,
    reversal: SubscriberReversalRecord,
    payment: SubscriberPaymentRecord,
    amount: number,
    at: Date,
): Promise<ReversalReinstatement> {
    const cases = (
        await db
            .select()
            .from(subscriberReconciliationCases)
            .where(eq(subscriberReconciliationCases.reversalId, reversal.id))
            .orderBy(
                asc(subscriberReconciliationCases.recordedAt),
                asc(subscriberReconciliationCases.id),
            )
    ).map(toSubscriberReconciliationCaseRecord);
    const unmatched = cases.reduce((sum, each) => sum + toCents(each.amount), 0);
    // What the gateway gave back before covered the unmatched part first.
    const coveredBefore = Math.min(toCents(reversal.reinstated), unmatched);
    const entries = (
        await db
            .select()
            .from(subscriberCreditEntries)
            .where(eq(subscriberCreditEntries.reversalId, reversal.id))
    ).map(toSubscriberCreditEntryRecord);
    const settlements = await db
        .select()
        .from(subscriptionInvoiceSettlements)
        .where(eq(subscriptionInvoiceSettlements.reversalId, reversal.id))
        .orderBy(
            asc(subscriptionInvoiceSettlements.recordedAt),
            asc(subscriptionInvoiceSettlements.id),
        );
    const invoices: { invoiceId: string; left: number; owed: number }[] = [];
    for (const net of netByInvoice(
        settlements.map((row) => ({ invoiceId: row.invoiceId, amount: settledAmountOf(row) })),
    )) {
        const owed = await owedIn(db, await lockInvoice(db, net.invoiceId));
        invoices.push({ invoiceId: net.invoiceId, left: -net.amount, owed });
    }
    const parts = reinstatementParts(amount, {
        unmatched: (unmatched - coveredBefore) / 100,
        credits: paidOutByCredit(entries).map((part) => ({
            creditId: part.creditId,
            left: part.amount,
        })),
        invoices,
    });
    const closedCases = await closeCasesOf(
        db,
        { reversalId: reversal.id },
        CASE_CLOSED_REVERSAL_GIVEN_BACK,
        at,
        casesCovered(cases, (coveredBefore + toCents(parts.covered)) / 100),
    );
    for (const part of parts.credits) {
        await db.insert(subscriberCreditEntries).values({
            id: randomUUID(),
            ...reversalEntryColumns(
                part.creditId,
                reversal,
                'REVERSAL_TAKEN_BACK',
                part.amount,
                at,
            ),
        });
    }
    for (const part of parts.invoices) {
        await db.insert(subscriptionInvoiceSettlements).values({
            id: randomUUID(),
            invoiceId: part.invoiceId,
            paymentId: payment.id,
            kind: 'REINSTATEMENT',
            amount: toDecimalString(part.amount),
            reversalId: reversal.id,
            recordedAt: at,
        });
    }
    const credit =
        parts.credited > 0
            ? await createCredit(db, payment, parts.credited, { originReversalId: reversal.id }, at)
            : null;
    return { closedCases, credits: parts.credits, invoices: parts.invoices, credit };
}
