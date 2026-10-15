// The cases to reconcile against `subscriber_reconciliation_cases`: opened in
// the turn of the refund or the reversal that matched nothing, closed by the
// operator with a note, or by SaaSiCat where the money came back.

import { randomUUID } from 'node:crypto';
import type {
    ClosedReconciliationCase,
    CloseReconciliationCase,
    NewReconciliationCase,
    ReconciliationCaseState,
    SubscriberReconciliationCaseRecord,
} from '@saasicat/core';
import { reconciliationCaseColumns, toSubscriberReconciliationCaseRecord } from '@saasicat/core';
import type { PaymentPrisma } from './prisma-subscriber-payment-rows.js';

/**
 * Opens a case. A refund's is opened once — the database holds one per
 * refund —, so its second report writes nothing and gets `null`.
 */
export async function openCase(
    db: PaymentPrisma,
    opened: NewReconciliationCase,
): Promise<SubscriberReconciliationCaseRecord | null> {
    const [row] = await db.subscriberReconciliationCase.createManyAndReturn({
        data: [{ id: randomUUID(), ...reconciliationCaseColumns(opened) }],
        skipDuplicates: true,
    });
    return row ? toSubscriberReconciliationCaseRecord(row) : null;
}

/**
 * Closes, as SaaSiCat and with `note`, the open cases `about` names — those of
 * them in `only`, where it is given — and returns them.
 */
export async function closeCasesOf(
    db: PaymentPrisma,
    about: { refundId: string } | { reversalId: string },
    note: string,
    at: Date,
    only?: readonly string[],
): Promise<SubscriberReconciliationCaseRecord[]> {
    const open = (
        await db.subscriberReconciliationCase.findMany({
            where: { ...about, closedAt: null },
            orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
        })
    ).map(toSubscriberReconciliationCaseRecord);
    const ids = open.map((each) => each.id).filter((id) => !only || only.includes(id));
    const closed: SubscriberReconciliationCaseRecord[] = [];
    for (const id of ids) {
        const { count } = await db.subscriberReconciliationCase.updateMany({
            where: { id, closedAt: null },
            data: { closedAt: at, closedBy: null, note },
        });
        const found = open.find((each) => each.id === id);
        if (count === 1 && found) closed.push({ ...found, closedAt: at, closedBy: null, note });
    }
    return closed;
}

/** The cases in `filter.state`, the oldest first, after the case `page.after` names. */
export async function listCasesIn(
    db: PaymentPrisma,
    filter: { state: ReconciliationCaseState; subscriberId?: string },
    page: { limit: number; after?: string },
): Promise<SubscriberReconciliationCaseRecord[]> {
    const after = page.after
        ? await db.subscriberReconciliationCase.findUnique({ where: { id: page.after } })
        : null;
    // Prisma leaves out a condition that is `undefined`.
    const rows = await db.subscriberReconciliationCase.findMany({
        where: {
            closedAt: filter.state === 'open' ? null : { not: null },
            subscriberId: filter.subscriberId,
            OR: after
                ? [
                      { recordedAt: { gt: after.recordedAt } },
                      { recordedAt: after.recordedAt, id: { gt: after.id } },
                  ]
                : undefined,
        },
        orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
        take: page.limit,
    });
    return rows.map(toSubscriberReconciliationCaseRecord);
}

/** Closes an open case with the operator's note, once. */
export async function closeCaseIn(
    db: PaymentPrisma,
    close: CloseReconciliationCase,
): Promise<ClosedReconciliationCase> {
    const { count } = await db.subscriberReconciliationCase.updateMany({
        where: { id: close.caseId, closedAt: null },
        data: { closedAt: close.at, closedBy: close.closedBy, note: close.note },
    });
    const row = await db.subscriberReconciliationCase.findUnique({ where: { id: close.caseId } });
    if (!row) return { outcome: 'unknown-case' };
    const found = toSubscriberReconciliationCaseRecord(row);
    return count === 1
        ? { outcome: 'closed', case: found }
        : { outcome: 'already-closed', case: found };
}
