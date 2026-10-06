// The entries of a subscriber's account as the derivations read and write
// them: which charge is a whole period, which line a charge came from, and the
// one place a derived charge is put together and rounded. Shared by the
// derivation of what is due (`charge-derivation.ts`) and of what a feature
// withdrawal changes (`withdrawal-charges.ts`).

import type {
    ContractLineItemRecord,
    NewSubscriberCharge,
    SubscriberChargeOrigin,
    SubscriberChargeRecord,
    SubscriptionContractRecord,
} from '@saasicat/core';
import { toCents } from '@saasicat/core';

import type { ChargeDerivationInput, ChargePeriod } from './charge-derivation.js';

const CENTS = 100;

/** A charge as the account holds it, or as it is about to be written. */
export type AccountEntry = Omit<SubscriberChargeRecord, 'id' | 'createdAt'>;

/**
 * Charges written for a whole period rather than a part of one — including the
 * new period an upgrade into a longer rhythm opens, which is charged as a
 * `planChange`. The difference a same-rhythm upgrade adds is a `planChange`
 * too, but for the rest of a period another charge already covers; see
 * `isDifference`.
 */
export const PERIOD_ORIGINS: readonly SubscriberChargeOrigin[] = [
    'activation',
    'renewal',
    'bundleBooking',
    'planChange',
];

/**
 * Whether a written plan charge is a whole period rather than the difference
 * a same-rhythm upgrade added: a difference always lies inside a whole period
 * the journal holds, ending with it.
 */
export function isWholePlanPeriod(
    charge: AccountEntry,
    written: readonly AccountEntry[],
    subscriptionId: string,
): boolean {
    if (charge.source !== 'plan' || charge.sourceRef !== subscriptionId) return false;
    if (!PERIOD_ORIGINS.includes(charge.origin)) return false;
    return charge.origin !== 'planChange' || !isDifference(charge, written);
}

function isDifference(charge: AccountEntry, written: readonly AccountEntry[]): boolean {
    return written.some(
        (other) =>
            other.source === 'plan' &&
            other.sourceRef === charge.sourceRef &&
            other.periodStart < charge.periodStart &&
            sameInstant(other.periodEnd, charge.periodEnd),
    );
}

/** The add-on price a retirement's switch holds, per period of its line's rhythm. */
export interface AddOnHold {
    /** The booking that switched: the only one the price is held for. */
    readonly subscriptionBundleId: string;
    readonly bundleVersionId: string;
    readonly until: Date;
    readonly amountNet: number;
}

/**
 * The add-on price a retirement's switch holds on a generated discount line,
 * or null for any other line: the booking it is held for, the version it is
 * held on, until when, and how much per period (`SC-BUN-055`). A plan's held
 * price names a plan version instead, and is read by `priceHoldOf`.
 */
export function addOnHoldOf(line: ContractLineItemRecord): AddOnHold | null {
    const metadata = line.metadata;
    if (line.kind !== 'discount' || !isRecord(metadata) || metadata.generated !== true) return null;
    const hold = metadata.priceHold;
    if (
        !isRecord(hold) ||
        typeof hold.subscriptionBundleId !== 'string' ||
        typeof hold.bundleVersionId !== 'string'
    ) {
        return null;
    }
    if (typeof hold.until !== 'string') return null;
    const until = new Date(hold.until);
    if (Number.isNaN(until.getTime())) return null;
    return {
        subscriptionBundleId: hold.subscriptionBundleId,
        bundleVersionId: hold.bundleVersionId,
        until,
        amountNet: numberOr0(hold.resolvedAmountNet),
    };
}

export function chargeOf(
    input: ChargeDerivationInput,
    contract: SubscriptionContractRecord,
    line: ContractLineItemRecord,
    charge: {
        origin: SubscriberChargeOrigin;
        source: NewSubscriberCharge['source'];
        sourceRef: string;
        period: ChargePeriod;
        amountNet: number;
        bookedAt: Date;
    },
): NewSubscriberCharge {
    return {
        subscriberId: input.subscriberId,
        tenantId: input.subscription.tenantId,
        subscriptionId: input.subscription.id,
        contractId: contract.id,
        contractLineItemId: line.id,
        origin: charge.origin,
        source: charge.source,
        sourceRef: charge.sourceRef,
        periodStart: charge.period.start,
        periodEnd: charge.period.end,
        currency: line.currency,
        // Rounded once, here, where it is derived (`SC-PRIC-018`).
        amountNet: toCents(charge.amountNet) / CENTS,
        bookedAt: charge.bookedAt,
    };
}

export function sameInstant(a: Date, b: Date | null): boolean {
    return b !== null && a.getTime() === b.getTime();
}

export function lineById(
    contracts: readonly SubscriptionContractRecord[],
    id: string,
): ContractLineItemRecord | null {
    for (const contract of contracts) {
        const line = contract.lineItems.find((item) => item.id === id);
        if (line) return line;
    }
    return null;
}

export function numberOr0(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
