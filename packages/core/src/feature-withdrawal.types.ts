// A feature withdrawn for a reason outside the platform: an external service it
// depends on stopped, or a law took it away or changed it.
//
// It is the one exception to a subscription keeping what it was sold beside the
// orderly retirement, and it differs from that in every way the cause makes it
// differ. There is no lead time: the feature is granted to nobody from the date
// the operator names, whichever version, booking or contract grants it. The
// subscriptions holding it when it is announced are told at once and choose
// between a reduction for the time without it, which applies by itself, and
// ending at once. Whoever concludes while it is withdrawn is shown it first and
// concludes at the price offered.

import type { FeatureWithdrawalMark } from './feature-ui-registry.types.js';
import type { BillingCycle } from './promo-code.types.js';

/** What a reduction is named for: a plan, or an add-on, by its key. */
export type FeatureWithdrawalLineKind = 'plan' | 'bundle';

/**
 * The net amount the price of a plan, or of an add-on, is reduced by for one
 * whole period of `billingCycle` without the feature. A plan or an add-on that
 * grants the feature and is not named is not reduced.
 */
export interface FeatureWithdrawalReduction {
    readonly kind: FeatureWithdrawalLineKind;
    /** The plan key, or the add-on's (bundle's) key. */
    readonly key: string;
    readonly billingCycle: BillingCycle;
    readonly amountNet: number;
}

/** The longest reason a withdrawal carries: the operator's words to the subscribers, not a document. */
export const FEATURE_WITHDRAWAL_REASON_MAX_LENGTH = 1000;

/** A withdrawal as it is kept: one per announcement. */
export interface FeatureWithdrawalRecord {
    readonly id: string;
    readonly featureKey: string;
    /** Why, in the operator's words, as the subscribers are shown it. */
    readonly reason: string;
    /** From when the feature is granted to nobody. */
    readonly effectiveFrom: Date;
    /** From when it is granted again, once the operator has lifted the withdrawal. */
    readonly liftedFrom: Date | null;
    readonly reductions: readonly FeatureWithdrawalReduction[];
    readonly announcedAt: Date;
    /** Who announced it — an actor tag, as the audit log writes it. */
    readonly announcedBy: string;
    readonly liftedAt: Date | null;
    readonly liftedBy: string | null;
}

export type NewFeatureWithdrawal = Pick<
    FeatureWithdrawalRecord,
    'featureKey' | 'reason' | 'effectiveFrom' | 'reductions' | 'announcedAt' | 'announcedBy'
>;

/** What lifting a withdrawal records. */
export interface FeatureWithdrawalLift {
    readonly liftedFrom: Date;
    readonly liftedAt: Date;
    readonly liftedBy: string;
}

/**
 * Whether `withdrawal` takes its feature away at `at`. A withdrawal lifted
 * before its date never does.
 */
export function isFeatureWithdrawnAt(
    withdrawal: Pick<FeatureWithdrawalRecord, 'effectiveFrom' | 'liftedFrom'>,
    at: Date,
): boolean {
    return (
        withdrawal.effectiveFrom <= at &&
        (withdrawal.liftedFrom === null || at < withdrawal.liftedFrom)
    );
}

/** The features `withdrawals` take away at `at`. */
export function featuresWithdrawnAt(
    withdrawals: readonly Pick<
        FeatureWithdrawalRecord,
        'featureKey' | 'effectiveFrom' | 'liftedFrom'
    >[],
    at: Date,
): Set<string> {
    return new Set(
        withdrawals
            .filter((withdrawal) => isFeatureWithdrawnAt(withdrawal, at))
            .map((withdrawal) => withdrawal.featureKey),
    );
}

/**
 * The first moment after `at` at which what `withdrawals` take away changes —
 * one takes effect, or is lifted — or null where none is still to come.
 */
export function nextWithdrawalChange(
    withdrawals: readonly Pick<FeatureWithdrawalRecord, 'effectiveFrom' | 'liftedFrom'>[],
    at: Date,
): Date | null {
    let next: Date | null = null;
    for (const { effectiveFrom, liftedFrom } of withdrawals) {
        for (const moment of [effectiveFrom, liftedFrom]) {
            if (moment === null || moment <= at) continue;
            if (next === null || moment < next) next = moment;
        }
    }
    return next;
}

/**
 * The manifest capability that announces withdrawing a feature. The platform
 * sets it where it serves the routes, and the admin UI offers the action only
 * where it is set.
 */
export const FEATURE_WITHDRAWAL_CAPABILITY = 'features.withdraw';

/**
 * A line of a subscription a withdrawal reaches: the plan in the rhythm it is
 * billed in, or one booking of an add-on.
 */
export interface FeatureWithdrawalLine {
    readonly line: FeatureWithdrawalLineKind;
    /** The plan key, or the add-on's key. */
    readonly key: string;
    /** The plan's or the add-on's name, as the subscriber reads it. */
    readonly label: string;
    /** The booking, where the line is an add-on's; null for the plan. */
    readonly subscriptionBundleId: string | null;
    readonly billingCycle: BillingCycle;
}

/** A line as the subscriber was told of it: with the reduction it carries, or null for none. */
export interface FeatureWithdrawalNoticeLine extends FeatureWithdrawalLine {
    readonly reductionNet: number | null;
}

/**
 * A feature the subscription holds is withdrawn. Sent once per subscription and
 * withdrawal, at the announcement, and kept as it was sent: it is the record of
 * which lines the withdrawal reached and what each is reduced by.
 */
export interface FeatureWithdrawnNotice {
    readonly kind: 'feature-withdrawn';
    readonly tenantId: string;
    readonly subscriptionId: string;
    readonly withdrawalId: string;
    readonly featureKey: string;
    readonly featureLabel: string;
    readonly reason: string;
    /** ISO 8601. */
    readonly effectiveFrom: string;
    readonly lines: readonly FeatureWithdrawalNoticeLine[];
    /**
     * Whether the subscription holds the feature through special terms its
     * contract records and through no line: then it may end at once, and no
     * reduction applies by itself.
     */
    readonly specialTerms: boolean;
}

/** A withdrawn feature is granted again. Sent once to every subscription told of the withdrawal. */
export interface FeatureWithdrawalLiftedNotice {
    readonly kind: 'feature-withdrawal-lifted';
    readonly tenantId: string;
    readonly subscriptionId: string;
    readonly withdrawalId: string;
    readonly featureKey: string;
    readonly featureLabel: string;
    /** ISO 8601. */
    readonly liftedFrom: string;
}

/**
 * The subscription, or one booking of it, ended at once while a feature it
 * holds was withdrawn: what the account credits the unused rest of the period
 * already charged from. Recorded by each attempt before it ends anything, so
 * the credit never lacks its record; an attempt whose end did not happen leaves
 * one behind, and only the one whose `endedAt` the subscription or the booking
 * records is sent, counted or credited (`endedAtOnceSubjectOf`).
 */
export interface EndedAtOnceNotice {
    readonly kind: 'ended-at-once';
    readonly tenantId: string;
    readonly subscriptionId: string;
    /** The booking that ended; null where the subscription did, and every booking with it. */
    readonly subscriptionBundleId: string | null;
    readonly withdrawalId: string;
    readonly featureKey: string;
    readonly featureLabel: string;
    /** ISO 8601. */
    readonly endedAt: string;
}

/** A blocker or a refusal a person reads: a stable code and the values its sentence names. */
export interface FeatureWithdrawalBlocker {
    readonly code: string;
    readonly message: string;
    readonly params: Record<string, string | number>;
}

/** A subscription a withdrawal reaches, as the operator previews it. */
export interface FeatureWithdrawalReachedRow {
    readonly tenantId: string;
    readonly subscriptionId: string;
    readonly status: string;
    /** Each line with its price per period in its rhythm, net, or null where none is known. */
    readonly lines: readonly (FeatureWithdrawalLine & { readonly priceNet: number | null })[];
    /** Whether it holds the feature through special terms its contract records, and through no line. */
    readonly specialTerms: boolean;
}

/** A subscription holding the feature that the withdrawal does not reach: it ends by the date. */
export interface FeatureWithdrawalSkippedRow {
    readonly tenantId: string;
    readonly subscriptionId: string;
    readonly reason: 'ends-before';
}

/**
 * A plan or an add-on in a rhythm the withdrawal reaches, which the operator
 * may name a reduction for: how many lines it reaches and the lowest price
 * among them, which a reduction may not exceed.
 */
export interface FeatureWithdrawalTarget {
    readonly kind: FeatureWithdrawalLineKind;
    readonly key: string;
    readonly label: string;
    readonly billingCycle: BillingCycle;
    readonly lines: number;
    readonly lowestPriceNet: number | null;
}

/** What announcing a withdrawal now would do. */
export interface FeatureWithdrawalPreview {
    readonly feature: { readonly key: string; readonly label: string };
    /** ISO 8601: the date it would take effect. */
    readonly effectiveFrom: string;
    /** ISO 8601: the moment it is computed for. */
    readonly asOf: string;
    readonly reached: readonly FeatureWithdrawalReachedRow[];
    readonly skipped: readonly FeatureWithdrawalSkippedRow[];
    readonly targets: readonly FeatureWithdrawalTarget[];
    /** Empty where it may be announced as it stands. */
    readonly blockers: readonly FeatureWithdrawalBlocker[];
}

/** A withdrawal as the administration reads it: the record, its dates as ISO 8601. */
export interface FeatureWithdrawalRow {
    readonly id: string;
    readonly featureKey: string;
    readonly reason: string;
    readonly effectiveFrom: string;
    readonly liftedFrom: string | null;
    readonly reductions: readonly FeatureWithdrawalReduction[];
    readonly announcedAt: string;
    readonly announcedBy: string;
    readonly liftedAt: string | null;
    readonly liftedBy: string | null;
}

/** The row the administration reads for `record`. */
export function featureWithdrawalRowOf(record: FeatureWithdrawalRecord): FeatureWithdrawalRow {
    return {
        id: record.id,
        featureKey: record.featureKey,
        reason: record.reason,
        effectiveFrom: record.effectiveFrom.toISOString(),
        liftedFrom: record.liftedFrom?.toISOString() ?? null,
        reductions: record.reductions,
        announcedAt: record.announcedAt.toISOString(),
        announcedBy: record.announcedBy,
        liftedAt: record.liftedAt?.toISOString() ?? null,
        liftedBy: record.liftedBy,
    };
}

/** What an announcement did. */
export interface FeatureWithdrawalAnnounced {
    readonly withdrawal: FeatureWithdrawalRow;
    /** Notices sent now; the rest are sent by the next run. */
    readonly told: number;
    readonly failed: number;
}

/** What lifting a withdrawal did. */
export interface FeatureWithdrawalLifted {
    readonly withdrawal: FeatureWithdrawalRow;
    readonly told: number;
    readonly failed: number;
}

/** A withdrawal as the administration lists it, with how far it has come. */
export interface FeatureWithdrawalView extends FeatureWithdrawalRow {
    readonly featureLabel: string;
    readonly progress: {
        /** The subscriptions it reached. */
        readonly reached: number;
        /** Of those, the ones whose notice reached somebody. */
        readonly told: number;
        /** The subscriptions and bookings that ended at once under it. */
        readonly endedAtOnce: number;
    };
}

/** A line of the tenant's subscription a withdrawal reached, as the tenant sees it now. */
export interface TenantFeatureWithdrawalLine extends FeatureWithdrawalNoticeLine {
    /**
     * Whether the reduction still applies: the line runs as it was reached.
     * A change of plan or rhythm the subscriber made ends it.
     */
    readonly reduced: boolean;
}

/** A withdrawal reaching the tenant's subscription, beside its plan and its add-ons. */
export interface TenantFeatureWithdrawal {
    readonly withdrawalId: string;
    readonly featureKey: string;
    readonly featureLabel: string;
    readonly reason: string;
    /** ISO 8601. */
    readonly effectiveFrom: string;
    /** ISO 8601, once the operator has lifted it. */
    readonly liftedFrom: string | null;
    /** Whether it takes the feature away now. */
    readonly inEffect: boolean;
    readonly lines: readonly TenantFeatureWithdrawalLine[];
    readonly specialTerms: boolean;
    /** What may be ended at once now: the subscription, and which bookings. */
    readonly endable: {
        readonly subscription: boolean;
        readonly subscriptionBundleIds: readonly string[];
    };
}

/**
 * The features `withdrawals` take away at `now` or from a date ahead, and not
 * lifted by then, the earliest first: what a catalogue marks beside every plan
 * and add-on that grants them. A withdrawal lifted before its own date takes
 * nothing away. One feature can appear twice — withdrawn until a date, and
 * again from it.
 */
export function withdrawnFeaturesOf(
    withdrawals: readonly FeatureWithdrawalRecord[],
    now: Date,
): WithdrawnFeature[] {
    return withdrawals
        .filter(
            ({ effectiveFrom, liftedFrom }) =>
                liftedFrom === null || (liftedFrom > now && effectiveFrom < liftedFrom),
        )
        .sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime())
        .map((withdrawal) => ({
            featureKey: withdrawal.featureKey,
            reason: withdrawal.reason,
            effectiveFrom: withdrawal.effectiveFrom.toISOString(),
            liftedFrom: withdrawal.liftedFrom?.toISOString() ?? null,
        }));
}

/**
 * A feature withdrawn now or from a date ahead, as a catalogue marks it beside
 * every plan and add-on that grants it, so whoever concludes is shown it first.
 */
export interface WithdrawnFeature extends FeatureWithdrawalMark {
    readonly featureKey: string;
}

/** What ending at once now would credit, before the subscriber confirms it. */
export interface EndAtOncePreview {
    /** ISO 8601: the moment it ends. */
    readonly endsAt: string;
    /** The unused rest of what was charged, net, as a positive amount; 0 where nothing was charged. */
    readonly creditNet: number;
    /** ISO 4217, where anything is credited. */
    readonly currency: string | null;
}

/** What ending at once did. */
export interface EndedAtOnce extends EndAtOncePreview {
    readonly withdrawalId: string;
    /** The booking that ended; null where the subscription did. */
    readonly subscriptionBundleId: string | null;
}

/**
 * The subject an end at once is recorded under: the subscription or the
 * booking, and the moment the attempt names, so a later attempt records its
 * own moment rather than inheriting one whose end never happened.
 */
export function endedAtOnceSubjectOf(subscriptionOrBookingId: string, at: Date): string {
    return `${subscriptionOrBookingId}@${at.toISOString()}`;
}
