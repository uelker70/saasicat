// Canonical row -> record mapping for subscriber charges. Pure, and shared by
// both adapters for the reason `subscription-contract-mapping.ts` gives.

import { oneOf } from './closed-value.js';
import type {
    NewSubscriberCharge,
    SubscriberChargeCorrection,
    SubscriberChargeOrigin,
    SubscriberChargeRecord,
    SubscriberChargeSource,
} from './subscriber-ledger.types.js';

// Keyed rather than listed, so that an origin or a source added to the schema
// fails to compile here until it is read as well.
const ORIGINS: Record<SubscriberChargeOrigin, true> = {
    activation: true,
    renewal: true,
    planChange: true,
    bundleBooking: true,
    bundleChange: true,
    credit: true,
    correction: true,
    reductionTakenBack: true,
};
const SOURCES: Record<SubscriberChargeSource, true> = {
    plan: true,
    bundle: true,
    discount: true,
};

/**
 * The origin of a counter-entry. Only the cancellation of the invoice its
 * charge stood on writes one, and only that cancellation's replacement
 * invoices it: the invoice run leaves it out.
 */
export const CORRECTION_ORIGIN = 'correction' satisfies SubscriberChargeOrigin;

/** Every origin a charge may name, as a record or a line that copies one is checked against. */
export const SUBSCRIBER_CHARGE_ORIGINS: readonly SubscriberChargeOrigin[] = keysOf(ORIGINS);
/** Every source a charge may name. */
export const SUBSCRIBER_CHARGE_SOURCES: readonly SubscriberChargeSource[] = keysOf(SOURCES);

const TABLE = 'subscriber_ledger_entries';

/** How far from a whole number of cents float arithmetic may leave a rounded amount. */
const CENT_TOLERANCE = 1e-6;

/**
 * A `subscriber_ledger_entries` row as either adapter reads it back. The amount
 * is `unknown` because a Prisma row carries a `Decimal` where a Drizzle row
 * carries a numeric string.
 */
export interface CanonicalSubscriberChargeRow {
    id: string;
    subscriberId: string;
    tenantId: string;
    subscriptionId: string;
    contractId: string;
    contractLineItemId: string;
    origin: string;
    source: string;
    sourceRef: string;
    periodStart: Date;
    periodEnd: Date;
    currency: string;
    amountNet: unknown;
    bookedAt: Date;
    /** The three parts of a correction, all set on a correction and none on any other charge. */
    correctsChargeId: string | null;
    correctedInvoiceId: string | null;
    correctionReason: string | null;
    createdAt: Date;
}

/**
 * Reads a row back as a record. The origin and the source are checked rather
 * than cast: a value written by hand or by a later release would otherwise
 * reach an invoice as a charge nobody knows how to read.
 */
export function toSubscriberChargeRecord(
    row: CanonicalSubscriberChargeRow,
): SubscriberChargeRecord {
    const where = (column: string) => ({ table: TABLE, column, id: row.id });
    return {
        id: row.id,
        subscriberId: row.subscriberId,
        tenantId: row.tenantId,
        subscriptionId: row.subscriptionId,
        contractId: row.contractId,
        contractLineItemId: row.contractLineItemId,
        origin: oneOf(SUBSCRIBER_CHARGE_ORIGINS, row.origin, where('origin')),
        source: oneOf(SUBSCRIBER_CHARGE_SOURCES, row.source, where('source')),
        sourceRef: row.sourceRef,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        currency: row.currency,
        amountNet: Number(row.amountNet),
        bookedAt: row.bookedAt,
        correction: correctionOfRow(row),
        createdAt: row.createdAt,
    };
}

/**
 * The correction a row records, checked against its origin: a correction
 * names all three parts and no other charge names any, so a counter-entry
 * cannot be read as an ordinary charge, nor an ordinary charge as one. And it
 * holds as one is written (`isAsWrittenCorrection`): a reason that says
 * something, an amount taken off.
 */
function correctionOfRow(row: CanonicalSubscriberChargeRow): SubscriberChargeCorrection | null {
    const {
        correctsChargeId: chargeId,
        correctedInvoiceId: invoiceId,
        correctionReason: reason,
    } = row;
    const named = [chargeId, invoiceId, reason].filter((part) => part !== null).length;
    if (row.origin !== CORRECTION_ORIGIN && named === 0) return null;
    if (
        row.origin === CORRECTION_ORIGIN &&
        chargeId !== null &&
        invoiceId !== null &&
        reason !== null
    ) {
        const amount = Number(row.amountNet);
        if (isAsWrittenCorrection(reason, amount)) return { chargeId, invoiceId, reason };
        throw new Error(
            `${TABLE} row '${row.id}' is a correction of ${amount} for the reason '${reason}'; ` +
                'a correction takes a positive amount off and says why.',
        );
    }
    throw new Error(
        `${TABLE} row '${row.id}' is a ${row.origin} charge naming ${named} of the three parts of a ` +
            'correction; a correction names the charge it corrects, the invoice it stood on and the ' +
            'reason, and no other charge names any.',
    );
}

/** The `sourceRef` of a correction: the invoice the corrected charge stood on, and that charge. */
export function correctionSourceRefOf(
    correction: Pick<SubscriberChargeCorrection, 'chargeId' | 'invoiceId'>,
): string {
    return `${correction.invoiceId}/${correction.chargeId}`;
}

/**
 * The counter-entry by which what `charge` asks falls by `by` (a positive
 * amount, to the cent): the corrected charge's subscription, contract line,
 * source and period, a negative amount, and the correction it records, due at
 * `bookedAt` (`SC-PRIC-020`). A correction is never corrected in turn.
 */
export function counterEntryOf(
    charge: SubscriberChargeRecord,
    correction: { invoiceId: string; by: number; reason: string; bookedAt: Date },
): NewSubscriberCharge {
    if (charge.origin === CORRECTION_ORIGIN) {
        throw new Error(
            `Charge ${charge.id} is a correction itself; the charge it corrects is corrected instead.`,
        );
    }
    if (!(correction.by > 0)) {
        throw new Error(
            `A correction of charge ${charge.id} takes a positive amount off, not ${correction.by}.`,
        );
    }
    const parts = {
        chargeId: charge.id,
        invoiceId: correction.invoiceId,
        reason: correction.reason,
    };
    return {
        subscriberId: charge.subscriberId,
        tenantId: charge.tenantId,
        subscriptionId: charge.subscriptionId,
        contractId: charge.contractId,
        contractLineItemId: charge.contractLineItemId,
        origin: CORRECTION_ORIGIN,
        source: charge.source,
        sourceRef: correctionSourceRefOf(parts),
        periodStart: charge.periodStart,
        periodEnd: charge.periodEnd,
        currency: charge.currency,
        amountNet: -correction.by,
        bookedAt: correction.bookedAt,
        correction: parts,
    };
}

/**
 * The columns a charge is written with. The amount goes as a decimal string of
 * two places, which both a Prisma `Decimal` and a PostgreSQL `numeric` take
 * exactly — a JavaScript number on its way to either is where a cent is lost.
 *
 * An amount that is not already a whole number of cents is refused rather than
 * rounded: a charge is rounded once, where it is derived, and a second rounding
 * here would make the written figure differ from the one that was computed.
 */
export function subscriberChargeColumns(
    charge: NewSubscriberCharge,
): Omit<CanonicalSubscriberChargeRow, 'id' | 'createdAt' | 'amountNet'> & { amountNet: string } {
    const cents = charge.amountNet * 100;
    if (!Number.isFinite(cents) || Math.abs(cents - Math.round(cents)) > CENT_TOLERANCE) {
        throw new Error(
            `A charge of ${charge.amountNet} is not a whole number of cents; ` +
                'round it once where it is derived, before it is written.',
        );
    }
    return {
        subscriberId: charge.subscriberId,
        tenantId: charge.tenantId,
        subscriptionId: charge.subscriptionId,
        contractId: charge.contractId,
        contractLineItemId: charge.contractLineItemId,
        origin: charge.origin,
        source: charge.source,
        sourceRef: charge.sourceRef,
        periodStart: charge.periodStart,
        periodEnd: charge.periodEnd,
        currency: charge.currency,
        amountNet: charge.amountNet.toFixed(2),
        bookedAt: charge.bookedAt,
        ...correctionColumnsOf(charge),
    };
}

/**
 * A correction's reason and amount as one is written: a reason that says
 * something, and an amount below zero — a correction takes off what was not
 * owed, it never adds (`SC-PRIC-020`). The database holds the same rule
 * (`subscriber_ledger_entries_correction_names_its_charge`).
 */
function isAsWrittenCorrection(reason: string, amountNet: number): boolean {
    return reason.trim() !== '' && amountNet < 0;
}

/**
 * The correction's columns, refused where they do not fit the charge: a
 * correction names all three parts, says why, takes an amount off and carries
 * the `sourceRef` its parts make, and no other charge names any — the same
 * rule `correctionOfRow` reads by.
 */
function correctionColumnsOf(
    charge: NewSubscriberCharge,
): Pick<
    CanonicalSubscriberChargeRow,
    'correctsChargeId' | 'correctedInvoiceId' | 'correctionReason'
> {
    const { correction } = charge;
    if (charge.origin !== CORRECTION_ORIGIN && correction === null) {
        return { correctsChargeId: null, correctedInvoiceId: null, correctionReason: null };
    }
    if (charge.origin === CORRECTION_ORIGIN && correction !== null) {
        if (!isAsWrittenCorrection(correction.reason, charge.amountNet)) {
            throw new Error(
                `A correction of charge ${correction.chargeId} of ${charge.amountNet} for the ` +
                    `reason '${correction.reason}' is not written: a correction takes a positive ` +
                    'amount off and says why.',
            );
        }
        if (charge.sourceRef !== correctionSourceRefOf(correction)) {
            throw new Error(
                `A correction of charge ${correction.chargeId} carries sourceRef '${charge.sourceRef}' ` +
                    `rather than '${correctionSourceRefOf(correction)}'.`,
            );
        }
        return {
            correctsChargeId: correction.chargeId,
            correctedInvoiceId: correction.invoiceId,
            correctionReason: correction.reason,
        };
    }
    throw new Error(
        `A ${charge.origin} charge is written ${correction === null ? 'without' : 'with'} a correction; ` +
            'a correction names what it corrects and why, and no other charge does.',
    );
}

function keysOf<T extends string>(record: Record<T, true>): T[] {
    return Object.keys(record) as T[];
}
