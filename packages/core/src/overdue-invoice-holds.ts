// When an unpaid invoice holds its tenant back, and when it stops holding it
// (`SC-PRIC-098`, `SC-ADM-024`).
//
// An invoice still open on its due date (`SC-PRIC-046`) makes the tenant its
// subscriber is live for read-only on that day: a subscription is paid on its
// date, and there is no grace period. The one thing that keeps it from doing
// so is a collection sent by its due date and still waiting for an answer,
// with nothing failed before it — a direct debit sent on the due date and
// waiting for the bank. Once a collection failed or was taken back, the tenant
// stays read-only until the invoice is paid; so it does for a payment started
// after the due date, which lets the tenant go once it is there and not while
// it waits; and a collection planned for a later day, and none at all, hold it
// back too. What counts is the invoice's own attempts and those of every
// invoice it replaced, so a refusal is not forgotten by cancelling the invoice
// it refused: a refusal of an invoice that had come due and still owed when it
// was replaced holds the tenant back until the replacement is paid, whatever
// day the replacement states, since a correction is not a payment. A refusal a
// later payment made good before the correction counts no more: the invoice it
// concerned was paid. Each such invoice is a reason of its own, referenced by the
// invoice, so settling one of two leaves the tenant held by the other.
//
// What should hold is compared with what does, rather than every event that
// could change it following a path of its own: a payment, a cancellation, a
// reversal given back, or a subscriber whose tenant changed each leave an
// invoice that should no longer hold, and a reversal that opens an invoice
// again leaves one that should hold again.

import { UNSETTLED_COLLECTION_STATUSES } from './invoice-collection-mapping.js';
import type {
    InvoiceCollectionRecord,
    InvoiceCollectionStatus,
} from './invoice-collection.types.js';
import type { InvoiceSettlementRecord } from './invoice-export.types.js';
import { toCents } from './money.js';
import { REOPENING_SETTLEMENT_KINDS } from './subscriber-payment-mapping.js';
import { owedOn } from './subscriber-payment-rules.js';
import type { TenantAccessHold } from './tenant-access.types.js';
import { dayInZone, type CalendarDay } from './zoned-day.js';

/** An open invoice that holds its tenant back, with that tenant. */
export interface OverdueInvoice {
    invoiceId: string;
    tenantId: string;
}

/** A collection attempt as the rule reads it: where it stands, and the day it was sent. */
export interface CollectionAttemptStanding {
    status: InvoiceCollectionStatus;
    /** The installation's day the attempt was sent on; `null` while it was not. */
    sentOn: CalendarDay | null;
    /**
     * The due date of the invoice the attempt collected, where that invoice
     * had come due before anything replaced it; `null` for an invoice replaced
     * before its due date.
     */
    dueOn: CalendarDay | null;
}

/** An attempt whose payment did not arrive: refused, or taken back after it did. */
const NOT_PAID: readonly InvoiceCollectionStatus[] = ['FAILED', 'REVERSED'];

/**
 * Whether an invoice due on `dueDate`, still open on `today`, holds its tenant
 * back, given its collection attempts and those of every invoice it replaced:
 * from its due date on, unless a collection sent by then is still waiting for
 * an answer and none failed or was taken back — and before it already, where
 * an invoice it replaced had come due and was refused.
 */
export function unpaidInvoiceHoldsBack(
    dueDate: CalendarDay,
    attempts: readonly CollectionAttemptStanding[],
    today: CalendarDay,
): boolean {
    const refused = attempts.filter(({ status }) => NOT_PAID.includes(status));
    if (refused.some(({ dueOn }) => dueOn !== null && dueOn <= today)) return true;
    if (dueDate > today) return false;
    if (refused.length > 0) return true;
    return !attempts.some(
        ({ status, sentOn }) =>
            UNSETTLED_COLLECTION_STATUSES.includes(status) && sentOn !== null && sentOn <= dueDate,
    );
}

/**
 * What an invoice of `gross` still owed when the cancellation `replacedBy`
 * replaced it: its settlements recorded by then, the shares that cancellation
 * moved left out.
 */
export function owedWhenReplaced(
    gross: number,
    settlements: readonly Pick<
        InvoiceSettlementRecord,
        'kind' | 'amount' | 'recordedAt' | 'cancellationId'
    >[],
    replacedBy: { cancellationId: string; cancelledAt: Date },
): number {
    return owedOn(
        gross,
        settlements
            .filter(
                (settlement) =>
                    settlement.cancellationId !== replacedBy.cancellationId &&
                    settlement.recordedAt.getTime() <= replacedBy.cancelledAt.getTime(),
            )
            .map((settlement) =>
                REOPENING_SETTLEMENT_KINDS.includes(settlement.kind)
                    ? -settlement.amount
                    : settlement.amount,
            ),
    );
}

/**
 * The reversals among `settlements` that still take a payment back: recorded
 * beyond what was reinstated of them. A chargeback the gateway gave back once
 * the dispute was won is money that came back. Read across every invoice of a
 * chain at once, since a give-back lands on the invoice that stands by then
 * while the reversal stays where it was recorded.
 */
export function reversalsStillTakenBack(
    settlements: readonly Pick<InvoiceSettlementRecord, 'kind' | 'amount' | 'reversal'>[],
): string[] {
    const standing = new Map<string, number>();
    for (const { kind, amount, reversal } of settlements) {
        if (!reversal || (kind !== 'REVERSAL' && kind !== 'REINSTATEMENT')) continue;
        const cents = kind === 'REVERSAL' ? toCents(amount) : -toCents(amount);
        standing.set(reversal.id, (standing.get(reversal.id) ?? 0) + cents);
    }
    return [...standing].filter(([, cents]) => cents > 0).map(([reversalId]) => reversalId);
}

/** An invoice of a chain: the open invoice first, then each it replaced in turn. */
export interface ChainedInvoice {
    id: string;
    dueDate: CalendarDay;
    totalGross: number;
    /** The cancellation that replaced it; `null` for the open invoice, which stands. */
    replacedBy: { cancellationId: string; cancelledAt: Date } | null;
}

/**
 * Whether the open invoice heading `chain` holds its tenant back on
 * `clock.today`. The rule walks back from it through the invoices it
 * replaced, as far as the first that was paid when it was replaced — a refusal
 * before that was made good —, each counting with what it held when it was
 * replaced and with the due date it had come to by then. A payment taken back
 * is a refusal of the invoice it was recorded on, as long as nothing in the
 * chain gave it back: a give-back lands on the invoice that stands by then.
 */
export function invoiceChainHoldsBack(
    chain: readonly ChainedInvoice[],
    settlements: readonly Pick<
        InvoiceSettlementRecord,
        'invoiceId' | 'kind' | 'amount' | 'recordedAt' | 'cancellationId' | 'reversal'
    >[],
    attempts: readonly Pick<InvoiceCollectionRecord, 'invoiceId' | 'status' | 'submittedAt'>[],
    clock: { today: CalendarDay; timeZone: string },
): boolean {
    const [open, ...earlier] = chain;
    if (!open) return false;
    const settlementsOf = (invoiceId: string) =>
        settlements.filter((settlement) => settlement.invoiceId === invoiceId);
    const walked: { invoiceId: string; dueOn: CalendarDay | null; upTo: Date | null }[] = [
        { invoiceId: open.id, dueOn: open.dueDate, upTo: null },
    ];
    for (const invoice of earlier) {
        const replaced = invoice.replacedBy;
        if (!replaced) break;
        if (owedWhenReplaced(invoice.totalGross, settlementsOf(invoice.id), replaced) <= 0) break;
        const cameDue = invoice.dueDate <= dayInZone(replaced.cancelledAt, clock.timeZone);
        walked.push({
            invoiceId: invoice.id,
            dueOn: cameDue ? invoice.dueDate : null,
            upTo: replaced.cancelledAt,
        });
    }
    const heldBy = (link: (typeof walked)[number]) =>
        settlementsOf(link.invoiceId).filter(
            (settlement) =>
                link.upTo === null || settlement.recordedAt.getTime() <= link.upTo.getTime(),
        );
    const takenBack = new Set(reversalsStillTakenBack(walked.flatMap(heldBy)));
    const standings = walked.flatMap((link): CollectionAttemptStanding[] => {
        const own = attempts
            .filter((attempt) => attempt.invoiceId === link.invoiceId)
            .map((attempt) => ({
                status: attempt.status,
                sentOn: attempt.submittedAt ? dayInZone(attempt.submittedAt, clock.timeZone) : null,
                dueOn: link.dueOn,
            }));
        const reversed = heldBy(link).some(
            (settlement) =>
                settlement.kind === 'REVERSAL' &&
                settlement.reversal !== null &&
                takenBack.has(settlement.reversal.id),
        );
        return reversed ? [...own, { status: 'REVERSED', sentOn: null, dueOn: link.dueOn }] : own;
    });
    return unpaidInvoiceHoldsBack(open.dueDate, standings, clock.today);
}

/** The reasons to record and to lift so that the open ones are `overdue`, and only those. */
export interface OverdueHoldChanges {
    /** The invoices that hold their tenant back and have no open reason for it yet. */
    record: OverdueInvoice[];
    /** The open reasons whose invoice holds that tenant back no longer. */
    lift: TenantAccessHold[];
}

/**
 * What to record and to lift so that the open `overdue` reasons among `open`
 * are one per invoice in `overdue`, on the tenant it names. A reason of
 * another kind is left alone: it is not this rule's to lift.
 */
export function overdueHoldChanges(
    overdue: readonly OverdueInvoice[],
    open: readonly TenantAccessHold[],
): OverdueHoldChanges {
    const held = open.filter((hold) => hold.kind === 'overdue' && hold.liftedAt === null);
    const owed = new Set(overdue.map((invoice) => keyOf(invoice.tenantId, invoice.invoiceId)));
    // An invoice listed twice is still one reason.
    const covered = new Set(held.map((hold) => keyOf(hold.tenantId, hold.reference)));
    const record: OverdueInvoice[] = [];
    for (const invoice of overdue) {
        const key = keyOf(invoice.tenantId, invoice.invoiceId);
        if (covered.has(key)) continue;
        covered.add(key);
        record.push(invoice);
    }
    return {
        record,
        lift: held.filter((hold) => !owed.has(keyOf(hold.tenantId, hold.reference))),
    };
}

function keyOf(tenantId: string, invoiceId: string | null): string {
    return JSON.stringify([tenantId, invoiceId]);
}
