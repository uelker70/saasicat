// An orderly retirement: the operator ends a plan version for the subscriptions
// already on it, naming the version they continue on.
//
// It is the one exception to a subscription keeping its version, and it reaches
// contracts customers have made, so it comes with notice. Every subscription
// it reaches keeps its version until an effective date at least three calendar
// months away, may leave without notice until then, and continues on the named
// replacement, at that version's price, from then on. A price increase is a
// retirement whose replacement costs more.

import type { RetirementSwitchTerms } from './retirement-switch.js';
import type { VersionChange } from './subscription.types.js';
import type { VersionOfferSide } from './version-offer.js';

/** A version, as an announcement names it. */
export interface RetiredVersionRef {
    readonly planVersionId: string;
    readonly planKey: string;
    readonly version: number;
}

/** An announcement as it is kept: one per retirement, whoever it reaches. */
export interface VersionRetirementRecord {
    readonly id: string;
    /** The version retired. */
    readonly retired: RetiredVersionRef;
    /** The version its subscriptions continue on, named by the operator. */
    readonly replacement: RetiredVersionRef;
    readonly announcedAt: Date;
    /** Who announced it — an actor tag, as the audit log writes it. */
    readonly announcedBy: string;
}

export type NewVersionRetirement = Omit<VersionRetirementRecord, 'id'>;

/**
 * The manifest capability that announces retiring a version. The platform sets
 * it where it serves the routes, and the admin UI offers the action only where
 * it is set. Whether the operator's terms allow it is a blocker the preview
 * reports, so an operator who has not confirmed them learns what is missing.
 */
export const VERSION_RETIREMENT_CAPABILITY = 'planVersions.retire';

/**
 * One of the two versions of a retirement, as the subscriber compares them:
 * price in each rhythm, quotas and features, with the plan it belongs to — the
 * replacement may be a version of another plan.
 */
export interface RetirementSide extends VersionOfferSide {
    readonly planKey: string;
}

/**
 * A plan version a subscription is on is being retired, and the subscription
 * continues on the named replacement from its effective date. Sent once per
 * subscription and retirement, when the retirement is announced, and kept as
 * it was sent: the record shows what the subscriber was told, prices included.
 */
export interface VersionRetiredNotice {
    readonly kind: 'version-retired';
    readonly tenantId: string;
    readonly subscriptionId: string;
    readonly retirementId: string;
    readonly retired: RetirementSide;
    readonly replacement: RetirementSide;
    /** Every difference, retired to replacement, as the catalogue's diff states it. */
    readonly changes: readonly VersionChange[];
    /**
     * The rhythm the subscription is billed in when the retirement takes
     * effect — a change of rhythm scheduled by then included — which says
     * which of the two prices applies.
     */
    readonly billingCycle: string;
    /** ISO 8601. */
    readonly effectiveAt: string;
    /** ISO date (`YYYY-MM-DD`), UTC. */
    readonly lastDayToCancel: string;
}

/**
 * The one reminder of a retirement, where staying put costs the subscription
 * something (`SC-SUB-034`): sent 14 days before the retirement takes effect,
 * once per subscription and retired version. It says again what the
 * retirement notice said, with the rhythm as it stands when the reminder is
 * sent, and what a switch taken now would cost.
 */
export interface VersionRetirementReminder extends Omit<VersionRetiredNotice, 'kind'> {
    readonly kind: 'version-retirement-reminder';
    /**
     * What switching to the replacement now costs in the subscription's rhythm
     * (`SC-SUB-032`), or null where it cannot switch now: in a trial, with a
     * change scheduled, or where either plan is held for a special contract.
     */
    readonly switchTerms: RetirementSwitchTerms | null;
}

/**
 * Why a retirement does not reach a subscription on the version:
 *
 * - `ended` — the subscription is over.
 * - `cancelled-before` — its cancellation lands by the effective date.
 * - `changes-before` — a scheduled change moves it to another plan, or to
 *   another version of this one, by then.
 * - `no-term` — it carries no date a term can be counted from.
 * - `already-told` — an earlier announcement of this version reached it, and
 *   stands.
 */
export type RetirementSkipReason =
    'ended' | 'cancelled-before' | 'changes-before' | 'no-term' | 'already-told';

/** A refusal as the preview reports it and the announcement throws it. */
export interface RetirementBlocker {
    readonly code: string;
    readonly message: string;
    readonly params: Record<string, string | number>;
}

/** A subscription a retirement reaches, with what it means there. */
export interface RetirementReachedRow {
    readonly tenantId: string;
    readonly subscriptionId: string;
    readonly status: string;
    /** The rhythm it is billed in when the retirement takes effect. */
    readonly billingCycle: string;
    /** ISO 8601. */
    readonly effectiveAt: string;
    /** ISO date, UTC. */
    readonly lastDayToCancel: string;
    /** Reached by another retirement within the last twelve months: the announcement waits. */
    readonly reachedRecently: boolean;
}

/** A subscription on the version a retirement does not reach, and why. */
export interface RetirementSkippedRow {
    readonly tenantId: string;
    readonly subscriptionId: string;
    readonly reason: RetirementSkipReason;
}

/** What announcing a retirement now would do. */
export interface RetirementPreview {
    readonly retired: RetirementSide;
    readonly replacement: RetirementSide;
    /** Every difference, retired to replacement, as the subscribers will be told it. */
    readonly changes: readonly VersionChange[];
    /** ISO 8601: the moment it is computed for. */
    readonly asOf: string;
    readonly reached: readonly RetirementReachedRow[];
    readonly skipped: readonly RetirementSkippedRow[];
    /** Empty where it may be announced as it stands. */
    readonly blockers: readonly RetirementBlocker[];
}

/** What an announcement did. */
export interface RetirementAnnounced {
    readonly retirement: VersionRetirementRecord;
    /** Notices sent now; the rest are sent by the next run. */
    readonly told: number;
    readonly failed: number;
}

/**
 * How far a retirement has come, counted over the subscriptions it reached
 * (`SC-SUB-033`).
 */
export interface RetirementProgress {
    /** Off the retired version: moved at their date, switched early, or changed on their own. */
    readonly moved: number;
    /** Still on the retired version, before their date. */
    readonly waiting: number;
    /** Still on the retired version after their date: the run has not moved them yet, or cannot. */
    readonly overdue: number;
    /** Still on the retired version, and ended by their date: there is nothing to move. */
    readonly ended: number;
    /**
     * Reminded 14 days before their date (`SC-SUB-034`) — counted beside the
     * four above, not instead of one: a subscription reminded moves later.
     */
    readonly reminded: number;
}

/** An announcement as the administration lists it, with how far it has come. */
export interface VersionRetirementView extends VersionRetirementRecord {
    readonly progress: RetirementProgress;
}

/** What one run of the moves at the date did. */
export interface RetirementMoveRun {
    /** Subscriptions moved onto their replacement, with the contract the move writes. */
    readonly moved: number;
    /** Moves that could not be made, and are tried again by the next run. */
    readonly failed: number;
}

/** What switching to the replacement before the date did (`SC-SUB-032`). */
export interface RetirementSwitchResult {
    readonly fromPlanVersionId: string;
    readonly planVersionId: string;
    /** ISO date of the last day the price is held, or null where none is. */
    readonly heldUntilDay: string | null;
}
