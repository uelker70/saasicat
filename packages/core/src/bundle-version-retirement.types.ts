// An orderly retirement of an add-on version: the operator ends a version of an
// add-on for the bookings already on it and names the version of the same
// add-on they continue on.
//
// It follows a plan version's retirement (`version-retirement.types.ts`) and
// shares what belongs to the subscription: the operator's terms, the lead of
// three calendar months, the notice that has to reach somebody, and one
// retirement per subscription in twelve months, plan and add-on together. What
// belongs to the booking is its own: the date is an end of the booking's
// period, the prices are the add-on's for the subscription's plan, and the
// replacement is a version of the same add-on, so the booking stays the same
// booking and keeps its term.

import type { RetirementBlocker, RetirementProgress } from './version-retirement.types.js';
import type { VersionChange } from './subscription.types.js';

/** An add-on version, as an announcement names it. */
export interface RetiredBundleVersionRef {
    readonly bundleVersionId: string;
    readonly bundleKey: string;
    readonly version: number;
}

/** An add-on retirement as it is kept: one per announcement, whichever bookings it reaches. */
export interface BundleVersionRetirementRecord {
    readonly id: string;
    /** The version retired. */
    readonly retired: RetiredBundleVersionRef;
    /** The version of the same add-on its bookings continue on, named by the operator. */
    readonly replacement: RetiredBundleVersionRef;
    readonly announcedAt: Date;
    /** Who announced it — an actor tag, as the audit log writes it. */
    readonly announcedBy: string;
}

export type NewBundleVersionRetirement = Omit<BundleVersionRetirementRecord, 'id'>;

/**
 * The manifest capability that announces retiring an add-on version. The
 * platform sets it where it serves the routes, and the admin UI offers the
 * action only where it is set.
 */
export const BUNDLE_VERSION_RETIREMENT_CAPABILITY = 'bundleVersions.retire';

/**
 * One of the two versions of an add-on retirement, as the subscriber compares
 * them: what it grants, and its price beside the subscription's plan in each
 * rhythm — `pricingOverrides` included — or null where it has none there.
 */
export interface BundleRetirementSide {
    readonly bundleVersionId: string;
    readonly bundleKey: string;
    readonly label: string;
    readonly version: number;
    readonly features: readonly string[];
    readonly quotas: Readonly<Record<string, number>>;
    readonly monthlyNet: number | null;
    readonly yearlyNet: number | null;
}

/**
 * An add-on version a booking is on is being retired, and the booking
 * continues on the named replacement from its effective date. Sent once per
 * booking and retirement, and kept as it was sent: the record shows what the
 * subscriber was told, prices included.
 */
export interface BundleVersionRetiredNotice {
    readonly kind: 'bundle-version-retired';
    readonly tenantId: string;
    readonly subscriptionId: string;
    readonly subscriptionBundleId: string;
    readonly retirementId: string;
    /** The plan the add-on runs beside at the date, which both sides are priced for. */
    readonly planKey: string;
    readonly retired: BundleRetirementSide;
    readonly replacement: BundleRetirementSide;
    /** Every difference, retired to replacement, at the prices for `planKey`. */
    readonly changes: readonly VersionChange[];
    /** The rhythm the booking is billed in, which says which of the two prices applies. */
    readonly billingCycle: string;
    /** ISO 8601. */
    readonly effectiveAt: string;
    /** ISO date (`YYYY-MM-DD`), UTC: the last day it may be cancelled without its minimum term. */
    readonly lastDayToCancel: string;
}

/**
 * Why an add-on retirement does not reach a booking of the version:
 *
 * - `ended` — the subscription is over.
 * - `cancelled-before` — the booking's cancellation lands by the effective date.
 * - `no-term` — it carries no period an end can be counted from.
 * - `already-told` — an earlier announcement of this version reached it, and
 *   stands.
 */
export type BundleRetirementSkipReason = 'ended' | 'cancelled-before' | 'no-term' | 'already-told';

/** A booking an add-on retirement reaches, with what it means there. */
export interface BundleRetirementReachedRow {
    readonly tenantId: string;
    readonly subscriptionId: string;
    readonly subscriptionBundleId: string;
    /** The plan the add-on runs beside when the retirement takes effect. */
    readonly planKey: string;
    /** The rhythm the plan is billed in then. */
    readonly planCycle: string;
    /** The rhythm the booking is billed in. */
    readonly billingCycle: string;
    /** ISO 8601. */
    readonly effectiveAt: string;
    /** ISO date, UTC. */
    readonly lastDayToCancel: string;
    /** Its subscription was reached by a retirement within the last twelve months: the announcement waits. */
    readonly reachedRecently: boolean;
}

/** A booking of the version an add-on retirement does not reach, and why. */
export interface BundleRetirementSkippedRow {
    readonly tenantId: string;
    readonly subscriptionId: string;
    readonly subscriptionBundleId: string;
    readonly reason: BundleRetirementSkipReason;
}

/** What announcing an add-on retirement now would do. */
export interface BundleRetirementPreview {
    /** The two versions at their own prices, before any plan's override. */
    readonly retired: BundleRetirementSide;
    readonly replacement: BundleRetirementSide;
    /** Every difference at those prices; each booking is told the one at its plan's. */
    readonly changes: readonly VersionChange[];
    /** ISO 8601: the moment it is computed for. */
    readonly asOf: string;
    readonly reached: readonly BundleRetirementReachedRow[];
    readonly skipped: readonly BundleRetirementSkippedRow[];
    /** Empty where it may be announced as it stands. */
    readonly blockers: readonly RetirementBlocker[];
}

/** What an add-on announcement did. */
export interface BundleRetirementAnnounced {
    readonly retirement: BundleVersionRetirementRecord;
    /** Notices sent now; the rest are sent by the next run. */
    readonly told: number;
    readonly failed: number;
}

/** An add-on announcement as the administration lists it, with how far it has come. */
export interface BundleVersionRetirementView extends BundleVersionRetirementRecord {
    readonly progress: RetirementProgress;
}
