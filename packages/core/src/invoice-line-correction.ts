// What a cancellation corrects of the invoice it cancels, line by line
// (`SC-PRIC-020`): a charge the operator names as not owed, or owed at a lower
// amount, moves towards nothing by a counter-entry, and so does each discount
// that reduced it, in the share it fell — so no discount stays standing on
// what is no longer asked. A line moves from what it stands at, its charge and
// every correction of it written along the chain, so the corrections of one
// charge never take it below nothing.
//
// Pure, in whole cents. The caller settles what the operator gave and holds
// the chain's turn while it reads the journal and writes what this answers.

import { counterEntryOf } from './subscriber-ledger-mapping.js';
import type { NewSubscriberCharge, SubscriberChargeRecord } from './subscriber-ledger.types.js';
import type {
    NewCorrectionInvoiceLine,
    SubscriptionInvoiceLineRecord,
    SubscriptionInvoiceRecord,
} from './subscription-invoice.types.js';

/** What the operator says a line of the cancelled invoice is still owed, net, in its currency. */
export interface InvoiceLineOwed {
    /** The line's position on the cancelled invoice. */
    position: number;
    /** At least nothing, below what the line stands at; nothing where none of it is owed. */
    owed: number;
}

/**
 * Which charges a discount reduces, as the charge derivation reads it: a held
 * add-on price, and a feature withdrawal's reduction of a booking, those of
 * its booking; every other discount the plan's.
 */
export type DiscountReduces =
    { source: 'plan' } | { source: 'bundle'; subscriptionBundleId: string };

/** A line of the cancelled invoice: what it stands at, and what it becomes on the replacement. */
export interface CorrectedInvoiceLine {
    position: number;
    /** Its charge's amount and every correction of it written so far, in whole cents. */
    standsAt: number;
    /** What it stands at once corrected, in whole cents; `standsAt` where nothing moves it. */
    becomes: number;
}

/** What a cancellation corrects: the lines, and the counter-entries it writes for them. */
export interface InvoiceLineCorrections {
    /** Each charge line of the cancelled invoice, a correction's line aside, by its position. */
    lines: CorrectedInvoiceLine[];
    /** One per line that moves, in the order of the lines: what the journal is given. */
    counterEntries: NewSubscriberCharge[];
}

/** What `lineCorrectionsOf` reads besides the cancelled invoice and what the operator gave. */
export interface InvoiceLineCorrectionInput {
    /** The journal of the invoice's subscription, the corrections written so far among it. */
    journal: readonly SubscriberChargeRecord[];
    /** What each discount on the invoice reduces. */
    reduces: (discount: SubscriberChargeRecord) => DiscountReduces;
    /** The cancellation's reason, which each counter-entry records. */
    reason: string;
    bookedAt: Date;
}

const CORRECTION = 'correction';

/** `amount` in cents, as a two-place figure becomes one. */
const cents = (amount: number): number => Math.round(amount * 100);

/**
 * What `charge` stands at: its amount and every correction of it the journal
 * holds, in whole cents.
 */
export function standingCentsOf(
    charge: SubscriberChargeRecord,
    journal: readonly SubscriberChargeRecord[],
): number {
    return journal
        .filter((entry) => entry.correction?.chargeId === charge.id)
        .reduce((sum, entry) => sum + cents(entry.amountNet), cents(charge.amountNet));
}

/**
 * Whether a line of an invoice is one the operator may say is not owed, or
 * owed in part: one whose charge asks for something, not a discount, a credit
 * or a correction.
 */
export function isCorrectableLine(
    line: Pick<SubscriptionInvoiceLineRecord, 'origin' | 'source'>,
    standsAt: number,
): boolean {
    return line.origin !== CORRECTION && line.source !== 'discount' && standsAt > 0;
}

/**
 * What cancelling `cancelled` with `owed` corrects. A line named becomes what
 * is owed of it; a discount whose charges moved becomes its share of what they
 * became, rounded to the cent, the remainder its own; every other line stays
 * what it stands at. `owed` is the operator's, settled: positions of
 * correctable lines, each named once, at least nothing and below what the line
 * stands at.
 */
export function lineCorrectionsOf(
    cancelled: SubscriptionInvoiceRecord,
    owed: readonly InvoiceLineOwed[],
    input: InvoiceLineCorrectionInput,
): InvoiceLineCorrections {
    const chargeOf = (line: SubscriptionInvoiceLineRecord): SubscriberChargeRecord => {
        const charge = input.journal.find((entry) => entry.id === line.chargeId);
        if (!charge) {
            throw new Error(
                `Line ${line.position} of ${cancelled.number} names a charge not in the journal.`,
            );
        }
        return charge;
    };
    const named = new Map(owed.map((line) => [line.position, cents(line.owed)]));
    const charged = cancelled.lines
        .filter((line) => line.origin !== CORRECTION)
        .map((line) => {
            const charge = chargeOf(line);
            const standsAt = standingCentsOf(charge, input.journal);
            return { line, charge, standsAt, becomes: named.get(line.position) ?? standsAt };
        });
    for (const entry of charged) {
        if (entry.charge.source !== 'discount' || entry.standsAt === 0) continue;
        const reduced = charged.filter((other) =>
            reducesCharge(input.reduces(entry.charge), entry.charge, other.charge, other.standsAt),
        );
        const before = reduced.reduce((sum, other) => sum + other.standsAt, 0);
        const after = reduced.reduce((sum, other) => sum + other.becomes, 0);
        if (before === after || before === 0) continue;
        // Rounded on its size, half a cent away from nothing; nothing is nothing.
        const size = Math.round((Math.abs(entry.standsAt) * after) / before);
        entry.becomes = size === 0 ? 0 : Math.sign(entry.standsAt) * size;
    }
    return {
        lines: charged.map(({ line, standsAt, becomes }) => ({
            position: line.position,
            standsAt,
            becomes,
        })),
        counterEntries: charged
            .filter(({ standsAt, becomes }) => becomes !== standsAt)
            .map(({ charge, standsAt, becomes }) =>
                counterEntryOf(charge, {
                    invoiceId: cancelled.id,
                    by: Math.abs(standsAt - becomes) / 100,
                    reason: input.reason,
                    bookedAt: input.bookedAt,
                }),
            ),
    };
}

/**
 * Whether `discount`, reducing `reduces`, reduces `charge`: a charge that
 * asks for something, of the plan or of the booking it names, for the period
 * that ends when the discount's does — the period's own charge and what a
 * change inside it added up to its end.
 */
function reducesCharge(
    reduces: DiscountReduces,
    discount: SubscriberChargeRecord,
    charge: SubscriberChargeRecord,
    standsAt: number,
): boolean {
    if (standsAt <= 0 || charge.source === 'discount') return false;
    if (charge.periodEnd.getTime() !== discount.periodEnd.getTime()) return false;
    return reduces.source === 'plan'
        ? charge.source === 'plan'
        : charge.source === 'bundle' && charge.sourceRef === reduces.subscriptionBundleId;
}

/**
 * A line of the replacement a cancellation plans. A line of a counter-entry
 * the cancellation writes names it by its place among the counter-entries
 * until it is written, when `writtenReplacementLinesOf` gives it its charge.
 */
export type PlannedReplacementLine = Omit<NewCorrectionInvoiceLine, 'chargeId'> &
    ({ chargeId: string; counterEntry: null } | { chargeId: null; counterEntry: number });

/**
 * The replacement's lines for `cancelled` once `corrections` are applied, in
 * the order of the cancelled invoice: each charge line that is still owed in
 * any part, with the correction lines it carries and the counter-entry that
 * moves it now after it, and nothing of a line owed no more. Each line names
 * the line it replaces (`correctedPosition`), and each correction's line the
 * line on the replacement whose charge it corrects (`correctsPosition`). A line
 * of nothing that was nothing already stays. Empty where nothing is owed any
 * more.
 */
export function replacementLinesOf(
    cancelled: SubscriptionInvoiceRecord,
    corrections: InvoiceLineCorrections,
    taxRate: number,
): PlannedReplacementLine[] {
    const moved = new Map(corrections.lines.map((line) => [line.position, line]));
    // A line the corrections take to nothing is owed no more; one that was
    // nothing to begin with stands as it stood.
    const stillOwed = (position: number | null): boolean => {
        const line = position === null ? undefined : moved.get(position);
        return line !== undefined && !(line.becomes === 0 && line.standsAt !== 0);
    };
    // Each line with the position it replaces on the cancelled invoice, and,
    // for a correction's line, the position there of the line it corrects.
    const placed: Array<{
        line: PlannedReplacementLine;
        replaces: number | null;
        correctsThere: number | null;
    }> = cancelled.lines
        .filter((line) =>
            stillOwed(line.origin === CORRECTION ? line.correctsPosition : line.position),
        )
        .map((line) => ({
            line: { ...copiedLine(line, taxRate), chargeId: line.chargeId, counterEntry: null },
            replaces: line.position,
            correctsThere: line.correctsPosition,
        }));
    corrections.counterEntries.forEach((counterEntry, index) => {
        const corrected = cancelled.lines.find(
            (line) => line.chargeId === counterEntry.correction?.chargeId,
        );
        if (!corrected || !stillOwed(corrected.position)) return;
        // After its charge's line and the correction lines it already carries.
        let after = -1;
        placed.forEach((entry, at) => {
            if (
                entry.replaces === corrected.position ||
                entry.correctsThere === corrected.position
            ) {
                after = at;
            }
        });
        placed.splice(after + 1, 0, {
            line: {
                position: 0,
                contractLineItemId: counterEntry.contractLineItemId,
                title: corrected.title,
                origin: CORRECTION,
                source: counterEntry.source,
                periodFrom: corrected.periodFrom,
                periodUntil: corrected.periodUntil,
                amountNet: counterEntry.amountNet,
                taxRate,
                correctedPosition: null,
                correctsPosition: null,
                chargeId: null,
                counterEntry: index,
            },
            replaces: null,
            correctsThere: corrected.position,
        });
    });
    // Lines of nothing alone ask for nothing: there is no replacement then.
    if (placed.every((entry) => entry.line.amountNet === 0)) return [];
    const positionHere = new Map<number, number>();
    placed.forEach((entry, at) => {
        if (entry.replaces !== null) positionHere.set(entry.replaces, at + 1);
    });
    return placed.map((entry, at) => {
        if (entry.correctsThere === null) return { ...entry.line, position: at + 1 };
        const corrects = positionHere.get(entry.correctsThere);
        if (corrects === undefined) {
            throw new Error(
                `Line ${entry.correctsThere} of ${cancelled.number}, which a correction corrects, ` +
                    'is not on its replacement.',
            );
        }
        return { ...entry.line, position: at + 1, correctsPosition: corrects };
    });
}

/** A line of `cancelled` as its replacement carries it: the same charge, at the replacement's rate. */
function copiedLine(
    line: SubscriptionInvoiceLineRecord,
    taxRate: number,
): Omit<NewCorrectionInvoiceLine, 'chargeId'> {
    return {
        position: line.position,
        contractLineItemId: line.contractLineItemId,
        title: line.title,
        origin: line.origin,
        source: line.source,
        periodFrom: line.periodFrom,
        periodUntil: line.periodUntil,
        amountNet: line.amountNet,
        taxRate,
        correctedPosition: line.position,
        correctsPosition: line.correctsPosition,
    };
}

/** The lines of a planned replacement with the charges of the counter-entries written for it. */
export function writtenReplacementLinesOf(
    lines: readonly PlannedReplacementLine[],
    counterEntryIds: readonly string[],
): NewCorrectionInvoiceLine[] {
    return lines.map(({ counterEntry, chargeId, ...line }) => {
        if (chargeId !== null) return { ...line, chargeId };
        const written = counterEntryIds[counterEntry];
        if (written === undefined) {
            throw new Error(`Counter-entry ${counterEntry} of the replacement was not written.`);
        }
        return { ...line, chargeId: written };
    });
}
