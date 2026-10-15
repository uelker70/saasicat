// Canonical row -> record mapping for the cases to reconcile, shared by both
// adapters for the reason `subscription-contract-mapping.ts` gives.

import { oneOf } from './closed-value.js';
import { columnAmountOf } from './column-amount.js';
import { toDecimalString } from './decimal-string.js';
import type {
    ReconciliationCaseKind,
    SubscriberReconciliationCaseRecord,
} from './subscriber-reconciliation.types.js';

const CASES = 'subscriber_reconciliation_cases';

export const RECONCILIATION_CASE_KINDS: readonly ReconciliationCaseKind[] = [
    'REFUND_UNMATCHED',
    'REVERSAL_UNMATCHED',
];

/** A `subscriber_reconciliation_cases` row as either adapter reads it back. */
export interface CanonicalReconciliationCaseRow {
    id: string;
    subscriberId: string;
    tenantId: string;
    kind: string;
    amount: unknown;
    currency: string;
    paymentId: string;
    refundId: string | null;
    reversalId: string | null;
    gatewayAccount: string;
    gatewayRef: string;
    recordedAt: Date;
    closedAt: Date | null;
    closedBy: string | null;
    note: string | null;
}

/**
 * Reads a case back. It is about exactly what its kind says — a refund or a
 * reversal —, and a closed case carries why it was closed; a row that says
 * otherwise stops the read rather than reaching the operator's list as
 * something it is not.
 */
export function toSubscriberReconciliationCaseRecord(
    row: CanonicalReconciliationCaseRow,
): SubscriberReconciliationCaseRecord {
    const where = (column: string) => ({ table: CASES, column, id: row.id });
    const kind = oneOf(RECONCILIATION_CASE_KINDS, row.kind, where('kind'));
    const aboutRefund = kind === 'REFUND_UNMATCHED';
    if (aboutRefund !== (row.refundId !== null) || aboutRefund === (row.reversalId !== null)) {
        throw new Error(
            `${CASES} row '${row.id}' is a ${kind} naming ` +
                `${row.refundId === null ? 'no' : 'a'} refund and ` +
                `${row.reversalId === null ? 'no' : 'a'} reversal; a case names what it is about, ` +
                'and nothing else.',
        );
    }
    if ((row.closedAt === null) !== (row.note === null)) {
        throw new Error(
            `${CASES} row '${row.id}' is ${row.closedAt === null ? 'open with' : 'closed without'} ` +
                'a note; a case is closed with one, and an open case carries none.',
        );
    }
    if (row.closedAt === null && row.closedBy !== null) {
        throw new Error(`${CASES} row '${row.id}' is open and names who closed it.`);
    }
    return {
        id: row.id,
        subscriberId: row.subscriberId,
        tenantId: row.tenantId,
        kind,
        amount: columnAmountOf(row.amount, where('amount')),
        currency: row.currency,
        paymentId: row.paymentId,
        refundId: row.refundId,
        reversalId: row.reversalId,
        gatewayAccount: row.gatewayAccount,
        gatewayRef: row.gatewayRef,
        recordedAt: row.recordedAt,
        closedAt: row.closedAt,
        closedBy: row.closedBy,
        note: row.note,
    };
}

/** What a case is opened about: a refund or a reversal, with the payment and its subscriber. */
export interface NewReconciliationCase {
    kind: ReconciliationCaseKind;
    amount: number;
    currency: string;
    payment: { id: string; subscriberId: string; tenantId: string };
    /** The refund's id, for a `REFUND_UNMATCHED`, or the reversal's. */
    about: { id: string; gatewayAccount: string; gatewayRef: string };
    at: Date;
}

/** The columns a case is opened with. */
export function reconciliationCaseColumns(
    opened: NewReconciliationCase,
): Omit<CanonicalReconciliationCaseRow, 'id' | 'amount'> & { amount: string } {
    const aboutRefund = opened.kind === 'REFUND_UNMATCHED';
    return {
        subscriberId: opened.payment.subscriberId,
        tenantId: opened.payment.tenantId,
        kind: opened.kind,
        amount: toDecimalString(opened.amount),
        currency: opened.currency,
        paymentId: opened.payment.id,
        refundId: aboutRefund ? opened.about.id : null,
        reversalId: aboutRefund ? null : opened.about.id,
        gatewayAccount: opened.about.gatewayAccount,
        gatewayRef: opened.about.gatewayRef,
        recordedAt: opened.at,
        closedAt: null,
        closedBy: null,
        note: null,
    };
}

/** Why SaaSiCat closes a case of a refund that failed or was canceled. */
export const CASE_CLOSED_REFUND_ENDED =
    'The refund failed or was canceled, and its money came back.';

/** Why SaaSiCat closes a case of a reversal the gateway gave back. */
export const CASE_CLOSED_REVERSAL_GIVEN_BACK =
    'The gateway gave the reversal back, and with it what matched nothing.';
