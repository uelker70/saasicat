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
import type {
    CoveringCredit,
    LiftedCover,
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
    coversLifted,
    coversOf,
    inWithdrawalOrder,
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
import { closeCasesOf, openCase } from './prisma-reconciliation-cases.js';
import {
    createCredit,
    holdCredits,
    lockInvoice,
    openOf,
    owedOf,
    type PaymentPrisma,
} from './prisma-subscriber-payment-rows.js';

/** Records a reversal as the gateway reports it; see `SubscriberPaymentRepository.recordReversal`. */
export async function recordReversalIn(
    db: PaymentPrisma,
    reported: ReportedSubscriberReversal,
): Promise<RecordedSubscriberReversal> {
    const paymentRow = await db.subscriberPayment.findUnique({
        where: {
            gatewayAccount_gatewayRef: {
                gatewayAccount: reported.gatewayAccount,
                gatewayRef: reported.paymentRef,
            },
        },
    });
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
        await db.subscriberReversal.update({
            where: { id: reversal.id },
            data: {
                amount: toDecimalString(reversal.amount),
                fromCredit: toDecimalString(reversal.fromCredit),
            },
        });
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
        await db.subscriberReversal.update({
            where: { id: reversal.id },
            data: {
                reinstated: toDecimalString(reversal.reinstated),
                reinstatedAt: reported.at,
            },
        });
    }
    if (!withdrawal && !reinstatement) return { outcome: 'unchanged', reversal };
    return { outcome: 'recorded', reversal, withdrawal, reinstatement };
}

/**
 * Takes the turn of every invoice the payment settles, in one order, then
 * holds the subscriber's credits — the order a payment and a refund take them
 * in, so none of them waits on another in a circle.
 */
async function takeTurns(db: PaymentPrisma, payment: SubscriberPaymentRecord): Promise<void> {
    const settled = await db.subscriptionInvoiceSettlement.findMany({
        where: { paymentId: payment.id },
        select: { invoiceId: true },
    });
    const invoiceIds = [
        ...new Set([payment.invoiceId, ...settled.map((row) => row.invoiceId)]),
    ].sort((a, b) => a.localeCompare(b, 'en'));
    for (const invoiceId of invoiceIds) await lockInvoice(db, invoiceId);
    await holdCredits(db, payment.subscriberId);
}

/** The reversal under its gateway account and reference, written where it is new, and held. */
async function heldReversal(
    db: PaymentPrisma,
    reported: ReportedSubscriberReversal,
    payment: SubscriberPaymentRecord,
): Promise<SubscriberReversalRecord> {
    await db.subscriberReversal.createMany({
        data: [{ id: randomUUID(), ...subscriberReversalColumns(reported, payment) }],
        skipDuplicates: true,
    });
    await db.$queryRaw`
        SELECT "id" FROM "subscriber_reversals"
         WHERE "gatewayAccount" = ${reported.gatewayAccount} AND "gatewayRef" = ${reported.gatewayRef}
           FOR UPDATE`;
    const row = await db.subscriberReversal.findUnique({
        where: {
            gatewayAccount_gatewayRef: {
                gatewayAccount: reported.gatewayAccount,
                gatewayRef: reported.gatewayRef,
            },
        },
    });
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
    db: PaymentPrisma,
    reversal: SubscriberReversalRecord,
    payment: SubscriberPaymentRecord,
    amount: number,
    at: Date,
): Promise<{ fromCredit: number; withdrawal: ReversalWithdrawal }> {
    const settlements = await db.subscriptionInvoiceSettlement.findMany({
        where: { paymentId: payment.id },
        orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
    });
    const invoices = netByInvoice(
        settlements.map((row) => ({ invoiceId: row.invoiceId, amount: settledAmountOf(row) })),
    ).map((net) => ({ invoiceId: net.invoiceId, left: net.amount }));
    const own = await reversibleCredit(db, payment);
    const parts = withdrawalParts(
        amount,
        own,
        invoices,
        await coveringCredits(
            db,
            payment,
            invoices.map((each) => each.invoiceId),
        ),
    );
    const { lifted, unmatched } = coversLifted(
        parts,
        own ? await coversGivenBy(db, own.creditId, payment) : [],
    );
    const uncovered: LiftedCover[] = [];
    if (own) {
        for (const cover of lifted) {
            uncovered.push(await liftCover(db, own.creditId, cover, payment, at));
        }
    }
    const takenOfOwn =
        toCents(parts.credit?.amount ?? 0) +
        lifted.reduce((sum, each) => sum + toCents(each.amount), 0);
    const credit =
        own && takenOfOwn > 0 ? { creditId: own.creditId, amount: takenOfOwn / 100 } : null;
    for (const part of credit ? [credit, ...parts.covering] : parts.covering) {
        await db.subscriberCreditEntry.create({
            data: {
                id: randomUUID(),
                ...reversalEntryColumns(part.creditId, reversal, 'REVERSAL', part.amount, at),
            },
        });
    }
    for (const part of parts.invoices) {
        await db.subscriptionInvoiceSettlement.create({
            data: {
                id: randomUUID(),
                invoiceId: part.invoiceId,
                paymentId: payment.id,
                kind: 'REVERSAL',
                amount: toDecimalString(part.amount),
                reversalId: reversal.id,
                recordedAt: at,
            },
        });
    }
    const opened =
        unmatched > 0
            ? await openCase(db, {
                  kind: 'REVERSAL_UNMATCHED',
                  amount: unmatched,
                  currency: payment.currency,
                  payment,
                  about: reversal,
                  at,
              })
            : null;
    return {
        fromCredit: parts.fromCredit,
        withdrawal: {
            credit,
            covering: parts.covering,
            invoices: parts.invoices,
            uncovered,
            unmatched,
            case: opened,
        },
    };
}

/**
 * The covers the credit `creditId`, which `payment` left, gave other reversals
 * of its invoice and still holds, in the order they were given.
 */
async function coversGivenBy(
    db: PaymentPrisma,
    creditId: string,
    payment: SubscriberPaymentRecord,
): Promise<{ reversalId: string; amount: number }[]> {
    const own = await db.subscriberReversal.findMany({ where: { paymentId: payment.id } });
    const entries = (
        await db.subscriberCreditEntry.findMany({
            where: { creditId },
            orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
        })
    ).map(toSubscriberCreditEntryRecord);
    return coversOf(entries, new Set(own.map((each) => each.id)));
}

/**
 * Lifts what the reversal `cover` names took of the credit `creditId`: it is
 * given back to the credit, and that reversal opens the payment's invoice by
 * it, as it would have without the credit (`SC-PRIC-088`).
 */
async function liftCover(
    db: PaymentPrisma,
    creditId: string,
    cover: { reversalId: string; amount: number },
    payment: SubscriberPaymentRecord,
    at: Date,
): Promise<LiftedCover> {
    const row = await db.subscriberReversal.findUnique({ where: { id: cover.reversalId } });
    if (!row) {
        throw new Error(`Reversal ${cover.reversalId} took credit ${creditId} and does not exist.`);
    }
    const covered = toSubscriberReversalRecord(row);
    await db.subscriberCreditEntry.create({
        data: {
            id: randomUUID(),
            ...reversalEntryColumns(creditId, covered, 'REVERSAL_TAKEN_BACK', cover.amount, at),
        },
    });
    await db.subscriptionInvoiceSettlement.create({
        data: {
            id: randomUUID(),
            invoiceId: payment.invoiceId,
            paymentId: covered.paymentId,
            kind: 'REVERSAL',
            amount: toDecimalString(cover.amount),
            reversalId: covered.id,
            recordedAt: at,
        },
    });
    return {
        reversalId: covered.id,
        paymentId: covered.paymentId,
        invoiceId: payment.invoiceId,
        amount: cover.amount,
    };
}

/**
 * The credit the payment left, with what of it no reversal of the payment
 * took yet and what is still open of it; `null` where it left none.
 */
async function reversibleCredit(
    db: PaymentPrisma,
    payment: SubscriberPaymentRecord,
): Promise<ReversibleCredit | null> {
    const row = await db.subscriberCredit.findUnique({ where: { originPaymentId: payment.id } });
    if (!row) return null;
    const credit = toSubscriberCreditRecord(row);
    const reversals = await db.subscriberReversal.findMany({ where: { paymentId: payment.id } });
    const taken = reversals
        .map(toSubscriberReversalRecord)
        .reduce((sum, each) => sum + toCents(each.fromCredit), 0);
    return {
        creditId: credit.id,
        left: (toCents(credit.amount) - taken) / 100,
        open: await openOf(db, credit.id),
    };
}

/**
 * The open credits that other payments collected for `invoiceIds` left, the
 * oldest first: what covers what the reversal would open again of them.
 */
async function coveringCredits(
    db: PaymentPrisma,
    payment: SubscriberPaymentRecord,
    invoiceIds: readonly string[],
): Promise<CoveringCredit[]> {
    if (invoiceIds.length === 0) return [];
    const others = await db.subscriberPayment.findMany({
        where: { invoiceId: { in: [...invoiceIds] }, id: { not: payment.id } },
    });
    if (others.length === 0) return [];
    const rows = await db.subscriberCredit.findMany({
        where: { originPaymentId: { in: others.map((each) => each.id) } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const covering: CoveringCredit[] = [];
    for (const row of rows) covering.push({ creditId: row.id, open: await openOf(db, row.id) });
    return covering;
}

/** Writes what `amount`, newly given back by the gateway, returns of what the reversal took. */
async function reinstate(
    db: PaymentPrisma,
    reversal: SubscriberReversalRecord,
    payment: SubscriberPaymentRecord,
    amount: number,
    at: Date,
): Promise<ReversalReinstatement> {
    const cases = (
        await db.subscriberReconciliationCase.findMany({
            where: { reversalId: reversal.id },
            orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
        })
    ).map(toSubscriberReconciliationCaseRecord);
    const unmatched = cases.reduce((sum, each) => sum + toCents(each.amount), 0);
    // What the gateway gave back before covered the unmatched part first.
    const coveredBefore = Math.min(toCents(reversal.reinstated), unmatched);
    const entries = (
        await db.subscriberCreditEntry.findMany({
            where: { reversalId: reversal.id },
            orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
        })
    ).map(toSubscriberCreditEntryRecord);
    const took = paidOutByCredit(entries);
    const credits = (
        await db.subscriberCredit.findMany({
            where: { id: { in: took.map((part) => part.creditId) } },
        })
    ).map(toSubscriberCreditRecord);
    const settlements = await db.subscriptionInvoiceSettlement.findMany({
        where: { reversalId: reversal.id },
        orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
    });
    const invoices: { invoiceId: string; left: number; owed: number }[] = [];
    for (const net of netByInvoice(
        settlements.map((row) => ({ invoiceId: row.invoiceId, amount: settledAmountOf(row) })),
    )) {
        const owed = await owedOf(db, await lockInvoice(db, net.invoiceId));
        invoices.push({ invoiceId: net.invoiceId, left: -net.amount, owed });
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
        await db.subscriberCreditEntry.create({
            data: {
                id: randomUUID(),
                ...reversalEntryColumns(
                    part.creditId,
                    reversal,
                    'REVERSAL_TAKEN_BACK',
                    part.amount,
                    at,
                ),
            },
        });
    }
    for (const part of parts.invoices) {
        await db.subscriptionInvoiceSettlement.create({
            data: {
                id: randomUUID(),
                invoiceId: part.invoiceId,
                paymentId: payment.id,
                kind: 'REINSTATEMENT',
                amount: toDecimalString(part.amount),
                reversalId: reversal.id,
                recordedAt: at,
            },
        });
    }
    const credit =
        parts.credited > 0
            ? await createCredit(db, payment, parts.credited, { originReversalId: reversal.id }, at)
            : null;
    return { closedCases, credits: parts.credits, invoices: parts.invoices, credit };
}
