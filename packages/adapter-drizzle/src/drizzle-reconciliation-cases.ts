// The cases to reconcile against `subscriber_reconciliation_cases`: opened in
// the turn of the refund or the reversal that matched nothing, closed by the
// operator with a note, or by SaaSiCat where the money came back.

import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, isNotNull, isNull, or } from 'drizzle-orm';
import type {
    ClosedReconciliationCase,
    CloseReconciliationCase,
    NewReconciliationCase,
    ReconciliationCaseState,
    SubscriberReconciliationCaseRecord,
} from '@saasicat/core';
import { reconciliationCaseColumns, toSubscriberReconciliationCaseRecord } from '@saasicat/core';
import type { Db } from './drizzle-subscriber-payment-rows.js';
import { subscriberReconciliationCases as cases } from './schema.js';

/**
 * Opens a case. A refund's is opened once — the database holds one per
 * refund —, so its second report writes nothing and gets `null`.
 */
export async function openCase(
    db: Db,
    opened: NewReconciliationCase,
): Promise<SubscriberReconciliationCaseRecord | null> {
    const [row] = await db
        .insert(cases)
        .values({ id: randomUUID(), ...reconciliationCaseColumns(opened) })
        .onConflictDoNothing()
        .returning();
    return row ? toSubscriberReconciliationCaseRecord(row) : null;
}

/**
 * Closes, as SaaSiCat and with `note`, the open cases `about` names — those of
 * them in `only`, where it is given — and returns them.
 */
export async function closeCasesOf(
    db: Db,
    about: { refundId: string } | { reversalId: string },
    note: string,
    at: Date,
    only?: readonly string[],
): Promise<SubscriberReconciliationCaseRecord[]> {
    const named =
        'refundId' in about
            ? eq(cases.refundId, about.refundId)
            : eq(cases.reversalId, about.reversalId);
    const open = (
        await db
            .select()
            .from(cases)
            .where(and(named, isNull(cases.closedAt)))
            .orderBy(asc(cases.recordedAt), asc(cases.id))
    ).map(toSubscriberReconciliationCaseRecord);
    const closed: SubscriberReconciliationCaseRecord[] = [];
    const ids = open.map((each) => each.id).filter((id) => !only || only.includes(id));
    for (const id of ids) {
        const [row] = await db
            .update(cases)
            .set({ closedAt: at, closedBy: null, note })
            .where(and(eq(cases.id, id), isNull(cases.closedAt)))
            .returning();
        if (row) closed.push(toSubscriberReconciliationCaseRecord(row));
    }
    return closed;
}

/** The cases in `filter.state`, the oldest first, after the case `page.after` names. */
export async function listCasesIn(
    db: Db,
    filter: { state: ReconciliationCaseState; subscriberId?: string },
    page: { limit: number; after?: string },
): Promise<SubscriberReconciliationCaseRecord[]> {
    const [after] = page.after ? await db.select().from(cases).where(eq(cases.id, page.after)) : [];
    const rows = await db
        .select()
        .from(cases)
        .where(
            and(
                filter.state === 'open' ? isNull(cases.closedAt) : isNotNull(cases.closedAt),
                filter.subscriberId === undefined
                    ? undefined
                    : eq(cases.subscriberId, filter.subscriberId),
                after
                    ? or(
                          gt(cases.recordedAt, after.recordedAt),
                          and(eq(cases.recordedAt, after.recordedAt), gt(cases.id, after.id)),
                      )
                    : undefined,
            ),
        )
        .orderBy(asc(cases.recordedAt), asc(cases.id))
        .limit(page.limit);
    return rows.map(toSubscriberReconciliationCaseRecord);
}

/** Closes an open case with the operator's note, once. */
export async function closeCaseIn(
    db: Db,
    close: CloseReconciliationCase,
): Promise<ClosedReconciliationCase> {
    const [closed] = await db
        .update(cases)
        .set({ closedAt: close.at, closedBy: close.closedBy, note: close.note })
        .where(and(eq(cases.id, close.caseId), isNull(cases.closedAt)))
        .returning();
    if (closed) return { outcome: 'closed', case: toSubscriberReconciliationCaseRecord(closed) };
    const [row] = await db.select().from(cases).where(eq(cases.id, close.caseId));
    if (!row) return { outcome: 'unknown-case' };
    return { outcome: 'already-closed', case: toSubscriberReconciliationCaseRecord(row) };
}
