// Canonical row -> record mapping for bundle bookings. Pure, and shared by both
// adapters for the reason `subscription-contract-mapping.ts` gives.

import { oneOf } from './closed-value.js';
import { toContractAgreement } from './contract-agreement-mapping.js';
import type { BillingCycle } from './promo-code.types.js';
import type { SubscriptionBundleRecord } from './subscription.types.js';

const BILLING_CYCLES: readonly BillingCycle[] = ['MONTHLY', 'YEARLY'];

/**
 * A `subscription_bundles` row as either adapter reads it back.
 *
 * The three billing columns, those of a scheduled switch and those of the
 * booking's agreement are optional because a Prisma client generated from a
 * schema that predates them returns a row without them; an absent column reads
 * as null, the same as a booking made before they existed.
 */
export interface CanonicalSubscriptionBundleRow {
    id: string;
    subscriptionId: string;
    bundleVersionId: string;
    startedAt: Date;
    minimumTermEndsAt: Date | null;
    billingCycle?: string | null;
    currentPeriodStart?: Date | null;
    currentPeriodEnd?: Date | null;
    pendingBundleVersionId?: string | null;
    pendingVersionEffectiveAt?: Date | null;
    pendingTermsVersion?: string | null;
    pendingCancellationNoticeDays?: number | null;
    pendingAgreedAt?: Date | null;
    agreedTermsVersion?: string | null;
    agreedCancellationNoticeDays?: number | null;
    agreedAt?: Date | null;
    canceledAt: Date | null;
    canceledEffectiveAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Reads a row back as a record.
 *
 * `billingCycle` is a text column the platform only ever writes as `MONTHLY` or
 * `YEARLY`, and a price is chosen by asking whether it is `YEARLY` — so any
 * other value would be billed monthly without a word. It is checked rather than
 * cast, and a value outside the two stops the read.
 */
export function toSubscriptionBundleRecord(
    row: CanonicalSubscriptionBundleRow,
): SubscriptionBundleRecord {
    const billingCycle = row.billingCycle ?? null;
    return {
        id: row.id,
        subscriptionId: row.subscriptionId,
        bundleVersionId: row.bundleVersionId,
        startedAt: row.startedAt,
        minimumTermEndsAt: row.minimumTermEndsAt,
        billingCycle:
            billingCycle === null
                ? null
                : oneOf(BILLING_CYCLES, billingCycle, {
                      table: 'subscription_bundles',
                      column: 'billingCycle',
                      id: row.id,
                  }),
        currentPeriodStart: row.currentPeriodStart ?? null,
        currentPeriodEnd: row.currentPeriodEnd ?? null,
        pendingBundleVersionId: row.pendingBundleVersionId ?? null,
        pendingVersionEffectiveAt: row.pendingVersionEffectiveAt ?? null,
        pendingAgreement: toContractAgreement(
            {
                termsVersion: row.pendingTermsVersion,
                cancellationNoticeDays: row.pendingCancellationNoticeDays,
                agreedAt: row.pendingAgreedAt,
            },
            `Booking ${row.id}'s scheduled switch`,
        ),
        agreement: toContractAgreement(
            {
                termsVersion: row.agreedTermsVersion,
                cancellationNoticeDays: row.agreedCancellationNoticeDays,
                agreedAt: row.agreedAt,
            },
            `Booking ${row.id}`,
        ),
        canceledAt: row.canceledAt,
        canceledEffectiveAt: row.canceledEffectiveAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}
