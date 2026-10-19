// A reversal against `subscriber_reversals`, and the entries it writes
// against the credits and the invoices its payment reached.
//
// What a reversal withdrew and what the gateway gave back of it are reported in
// total, so a report arriving twice or out of order applies only what grew
// since the reversal was last recorded. That is decided in the turn of the
// chain of every invoice the payment settles, with every credit of its
// subscriber held, and
// the reversal's own row held as well: of two reports at the same moment one
// applies the change and the other finds it applied.

import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import type {
    CoveringCredit,
    CreditPart,
    InvoicePart,
    LiftedCover,
    RecordedSubscriberReversal,
    ReportedSubscriberReversal,
    ReversalReinstatement,
    ReversalWithdrawal,
    ReversibleCredit,
    ReversibleInvoice,
    SubscriberPaymentRecord,
    SubscriberReconciliationCaseRecord,
    SubscriberReversalRecord,
} from '@saasicat/core';
import {
    CASE_CLOSED_REVERSAL_GIVEN_BACK,
    casesCovered,
    coversLifted,
    coversOf,
    inWithdrawalOrder,
    netByInvoice,
    paidOutByCredit,
    reinstatementParts,
    reopenedByStanding,
    reversalEntryColumns,
    reversibleCreditsOf,
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
import { lockChain, standingInvoiceIdOf } from './drizzle-invoice-chain.js';
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
    subscriptionInvoices,
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
        const givenBack = await reinstate(db, reversal, payment, given / 100, reported.at);
        reinstatement = givenBack.reinstatement;
        reversal = {
            ...reversal,
            reinstated: (toCents(reversal.reinstated) + given) / 100,
            reinstatedToCases:
                (toCents(reversal.reinstatedToCases) + toCents(givenBack.toCases)) / 100,
            reinstatedAt: reported.at,
        };
        await db
            .update(subscriberReversals)
            .set({
                reinstated: toDecimalString(reversal.reinstated),
                reinstatedToCases: toDecimalString(reversal.reinstatedToCases),
                reinstatedAt: reported.at,
            })
            .where(eq(subscriberReversals.id, reversal.id));
    }
    if (!withdrawal && !reinstatement) return { outcome: 'unchanged', reversal };
    return { outcome: 'recorded', reversal, withdrawal, reinstatement };
}

/**
 * Takes the turn of the chain of every invoice the payment settles — the
 * chains' first invoices, in one order —, then holds the subscriber's credits:
 * the order a payment and a refund take them in, so none of them waits on
 * another in a circle.
 */
async function takeTurns(db: Db, payment: SubscriberPaymentRecord): Promise<void> {
    const settled = await db
        .select({ invoiceId: subscriptionInvoiceSettlements.invoiceId })
        .from(subscriptionInvoiceSettlements)
        .where(eq(subscriptionInvoiceSettlements.paymentId, payment.id));
    const invoiceIds = [...new Set([payment.invoiceId, ...settled.map((row) => row.invoiceId)])];
    const chains = await db
        .select({ chainId: subscriptionInvoices.chainId })
        .from(subscriptionInvoices)
        .where(inArray(subscriptionInvoices.id, invoiceIds));
    const firsts = [...new Set(chains.map((row) => row.chainId))].sort((a, b) =>
        a.localeCompare(b, 'en'),
    );
    for (const first of firsts) await lockChain(db, first);
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
    const brought = await broughtBy(db, payment);
    const parts = withdrawalParts(amount, brought.own, brought.invoices, brought.covering);
    const covers: { creditId: string; reversalId: string; amount: number }[] = [];
    for (const credit of brought.own) {
        for (const cover of await coversGivenBy(db, credit.creditId, payment)) {
            covers.push({ creditId: credit.creditId, ...cover });
        }
    }
    const { lifted, unmatched } = coversLifted(parts, covers);
    // What the withdrawal took of each own credit: its open part, and what it
    // lifted of the covers that credit gave.
    const takenOfOwn = new Map<string, number>();
    for (const part of [...parts.credits, ...lifted]) {
        takenOfOwn.set(part.creditId, (takenOfOwn.get(part.creditId) ?? 0) + toCents(part.amount));
    }
    const credits = brought.own
        .filter((credit) => (takenOfOwn.get(credit.creditId) ?? 0) > 0)
        .map((credit) => ({
            creditId: credit.creditId,
            amount: (takenOfOwn.get(credit.creditId) ?? 0) / 100,
        }));
    await writeTaken(
        db,
        reversal,
        { credits: [...credits, ...parts.covering], invoices: parts.invoices },
        at,
    );
    // Lifted once the withdrawal is written: a lifted cover is taken again of
    // what the covering credits still hold after it.
    const uncovered: LiftedCover[] = [];
    for (const cover of lifted) {
        uncovered.push(await liftCover(db, cover.creditId, cover, at));
    }
    const opened = await caseOf(db, reversal, payment, unmatched, at);
    return {
        fromCredit: parts.fromCredit,
        withdrawal: {
            credits,
            covering: parts.covering,
            invoices: parts.invoices,
            uncovered,
            unmatched,
            case: opened,
        },
    };
}

/**
 * What the payment brought, as a withdrawal of it reads it now: the credits it
 * left, what it still settles on each invoice, and the open credits other
 * payments collected for those invoices left.
 */
async function broughtBy(
    db: Db,
    payment: SubscriberPaymentRecord,
): Promise<{ own: ReversibleCredit[]; invoices: ReversibleInvoice[]; covering: CoveringCredit[] }> {
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
    return {
        own: await reversibleCredits(db, payment),
        invoices,
        covering: await coveringCredits(
            db,
            payment,
            invoices.map((each) => each.invoiceId),
        ),
    };
}

/**
 * Writes what the reversal takes: an entry on each credit, and a settlement
 * that opens each invoice again against the reversal's payment.
 */
async function writeTaken(
    db: Db,
    reversal: SubscriberReversalRecord,
    taken: { credits: readonly CreditPart[]; invoices: readonly InvoicePart[] },
    at: Date,
): Promise<void> {
    for (const part of taken.credits) {
        await db.insert(subscriberCreditEntries).values({
            id: randomUUID(),
            ...reversalEntryColumns(part.creditId, reversal, 'REVERSAL', part.amount, at),
        });
    }
    for (const part of taken.invoices) {
        await db.insert(subscriptionInvoiceSettlements).values({
            id: randomUUID(),
            invoiceId: part.invoiceId,
            paymentId: reversal.paymentId,
            kind: 'REVERSAL',
            amount: toDecimalString(part.amount),
            reversalId: reversal.id,
            recordedAt: at,
        });
    }
}

/** The case `unmatched` of the reversal opens, where it matched anything at all. */
async function caseOf(
    db: Db,
    reversal: SubscriberReversalRecord,
    payment: SubscriberPaymentRecord,
    unmatched: number,
    at: Date,
): Promise<SubscriberReconciliationCaseRecord | null> {
    if (unmatched <= 0) return null;
    return openCase(db, {
        kind: 'REVERSAL_UNMATCHED',
        amount: unmatched,
        currency: payment.currency,
        payment,
        about: reversal,
        at,
    });
}

/**
 * The covers the credit `creditId`, which `payment` left, gave other reversals
 * of its invoice and still holds, in the order they were given.
 */
async function coversGivenBy(
    db: Db,
    creditId: string,
    payment: SubscriberPaymentRecord,
): Promise<{ reversalId: string; amount: number }[]> {
    const own = await db
        .select({ id: subscriberReversals.id })
        .from(subscriberReversals)
        .where(eq(subscriberReversals.paymentId, payment.id));
    const entries = (
        await db
            .select()
            .from(subscriberCreditEntries)
            .where(eq(subscriberCreditEntries.creditId, creditId))
            .orderBy(asc(subscriberCreditEntries.recordedAt), asc(subscriberCreditEntries.id))
    ).map(toSubscriberCreditEntryRecord);
    return coversOf(entries, new Set(own.map((each) => each.id)));
}

/**
 * Lifts what the reversal `cover` names took of the credit `creditId`: it is
 * given back to the credit, and that reversal takes it as a withdrawal of its
 * payment would without the credit, as everything stands now (`SC-PRIC-090`)
 * — the credits its payment left first, a cancellation's share among them,
 * then the open credits other payments left for its invoices, then the
 * invoices, each by no more than the payment still settles there. The
 * withdrawal lifting it is written first, so a credit it took covers only what
 * it left of it. What reaches the payment's credits beyond their open part is
 * a case, as is what goes beyond everything the payment brought; a cover one
 * of those credits gave a further reversal is not lifted in turn.
 */
async function liftCover(
    db: Db,
    creditId: string,
    cover: { reversalId: string; amount: number },
    at: Date,
): Promise<LiftedCover> {
    const [row] = await db
        .select()
        .from(subscriberReversals)
        .where(eq(subscriberReversals.id, cover.reversalId));
    if (!row) {
        throw new Error(`Reversal ${cover.reversalId} took credit ${creditId} and does not exist.`);
    }
    const covered = toSubscriberReversalRecord(row);
    const [paymentRow] = await db
        .select()
        .from(subscriberPayments)
        .where(eq(subscriberPayments.id, covered.paymentId));
    if (!paymentRow) {
        throw new Error(
            `Reversal ${covered.id} takes back payment ${covered.paymentId}, which does not exist.`,
        );
    }
    const payment = toSubscriberPaymentRecord(paymentRow);
    await db.insert(subscriberCreditEntries).values({
        id: randomUUID(),
        ...reversalEntryColumns(creditId, covered, 'REVERSAL_TAKEN_BACK', cover.amount, at),
    });
    const brought = await broughtBy(db, payment);
    const parts = withdrawalParts(cover.amount, brought.own, brought.invoices, brought.covering);
    await writeTaken(
        db,
        covered,
        { credits: [...parts.credits, ...parts.covering], invoices: parts.invoices },
        at,
    );
    if (parts.fromCredit > 0) {
        await db
            .update(subscriberReversals)
            .set({
                fromCredit: toDecimalString(
                    (toCents(covered.fromCredit) + toCents(parts.fromCredit)) / 100,
                ),
            })
            .where(eq(subscriberReversals.id, covered.id));
    }
    return {
        reversalId: covered.id,
        paymentId: covered.paymentId,
        amount: cover.amount,
        credits: parts.credits,
        covering: parts.covering,
        invoices: parts.invoices,
        unmatched: parts.unmatched,
        case: await caseOf(db, covered, payment, parts.unmatched, at),
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
    // Collected for an invoice of the same chain: a payment of the invoice a
    // replacement replaces settles the replacement as well (`SC-PRIC-091`).
    const chains = await db
        .select({ chainId: subscriptionInvoices.chainId })
        .from(subscriptionInvoices)
        .where(inArray(subscriptionInvoices.id, [...invoiceIds]));
    const chainInvoices = await db
        .select({ id: subscriptionInvoices.id })
        .from(subscriptionInvoices)
        .where(
            inArray(subscriptionInvoices.chainId, [...new Set(chains.map((row) => row.chainId))]),
        );
    if (chainInvoices.length === 0) return [];
    const rows = await db
        .select({ id: subscriberCredits.id })
        .from(subscriberCredits)
        .innerJoin(subscriberPayments, eq(subscriberPayments.id, subscriberCredits.originPaymentId))
        .where(
            and(
                inArray(
                    subscriberPayments.invoiceId,
                    chainInvoices.map((row) => row.id),
                ),
                ne(subscriberPayments.id, payment.id),
            ),
        )
        .orderBy(asc(subscriberCredits.createdAt), asc(subscriberCredits.id));
    const covering: CoveringCredit[] = [];
    for (const row of rows) covering.push({ creditId: row.id, open: await openOf(db, row.id) });
    return covering;
}

/**
 * The credits the payment left — what it brought beyond its invoice, and its
 * share of a cancelled invoice the replacement did not take —, each with what
 * of it no reversal of the payment took yet and what is still open of it.
 */
async function reversibleCredits(
    db: Db,
    payment: SubscriberPaymentRecord,
): Promise<ReversibleCredit[]> {
    const rows = await db
        .select()
        .from(subscriberCredits)
        .where(eq(subscriberCredits.originPaymentId, payment.id));
    const credits = [];
    for (const row of rows) {
        const credit = toSubscriberCreditRecord(row);
        credits.push({
            creditId: credit.id,
            amount: credit.amount,
            createdAt: credit.createdAt,
            open: await openOf(db, credit.id),
        });
    }
    const reversals = await db
        .select()
        .from(subscriberReversals)
        .where(eq(subscriberReversals.paymentId, payment.id));
    const taken = reversals
        .map(toSubscriberReversalRecord)
        .reduce((sum, each) => sum + toCents(each.fromCredit), 0);
    return reversibleCreditsOf(credits, taken / 100);
}

/**
 * Writes what `amount`, newly given back by the gateway, returns of what the
 * reversal took, and answers with the part of it that covered the reversal's
 * cases, which the reversal records.
 */
async function reinstate(
    db: Db,
    reversal: SubscriberReversalRecord,
    payment: SubscriberPaymentRecord,
    amount: number,
    at: Date,
): Promise<{ reinstatement: ReversalReinstatement; toCases: number }> {
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
    // What earlier give-backs covered of them, as the reversal recorded it: a
    // case opened after a give-back was not covered by it.
    const coveredBefore = toCents(reversal.reinstatedToCases);
    const entries = (
        await db
            .select()
            .from(subscriberCreditEntries)
            .where(eq(subscriberCreditEntries.reversalId, reversal.id))
            .orderBy(asc(subscriberCreditEntries.recordedAt), asc(subscriberCreditEntries.id))
    ).map(toSubscriberCreditEntryRecord);
    const took = paidOutByCredit(entries);
    const credits =
        took.length === 0
            ? []
            : (
                  await db
                      .select()
                      .from(subscriberCredits)
                      .where(
                          inArray(
                              subscriberCredits.id,
                              took.map((part) => part.creditId),
                          ),
                      )
              ).map(toSubscriberCreditRecord);
    const settlements = await db
        .select()
        .from(subscriptionInvoiceSettlements)
        .where(eq(subscriptionInvoiceSettlements.reversalId, reversal.id))
        .orderBy(
            asc(subscriptionInvoiceSettlements.recordedAt),
            asc(subscriptionInvoiceSettlements.id),
        );
    const nets = netByInvoice(
        settlements.map((row) => ({ invoiceId: row.invoiceId, amount: settledAmountOf(row) })),
    );
    const standing = new Map<string, string | null>();
    for (const net of nets)
        standing.set(net.invoiceId, await standingInvoiceIdOf(db, net.invoiceId));
    const invoices: { invoiceId: string; left: number; owed: number }[] = [];
    for (const reopened of reopenedByStanding(nets, standing)) {
        const owed = await owedIn(db, await lockInvoice(db, reopened.invoiceId));
        invoices.push({ ...reopened, owed });
    }
    const parts = reinstatementParts(amount, {
        unmatched: (unmatched - coveredBefore) / 100,
        credits: inWithdrawalOrder(took, credits, payment.id).map((part) => ({
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
    return {
        reinstatement: { closedCases, credits: parts.credits, invoices: parts.invoices, credit },
        toCases: parts.covered,
    };
}
