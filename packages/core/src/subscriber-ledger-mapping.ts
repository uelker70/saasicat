// Canonical row -> record mapping for subscriber charges. Pure, and shared by
// both adapters for the reason `subscription-contract-mapping.ts` gives.

import { oneOf } from './closed-value.js';
import type {
    NewSubscriberCharge,
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
    credit: true,
    correction: true,
};
const SOURCES: Record<SubscriberChargeSource, true> = {
    plan: true,
    bundle: true,
    discount: true,
};

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
        origin: oneOf(keysOf(ORIGINS), row.origin, where('origin')),
        source: oneOf(keysOf(SOURCES), row.source, where('source')),
        sourceRef: row.sourceRef,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        currency: row.currency,
        amountNet: Number(row.amountNet),
        bookedAt: row.bookedAt,
        createdAt: row.createdAt,
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
    };
}

function keysOf<T extends string>(record: Record<T, true>): T[] {
    return Object.keys(record) as T[];
}
