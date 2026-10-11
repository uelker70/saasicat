// Which lines of one subscription a feature withdrawal reaches. Pure: the
// service reads the subscription, its contract in force, its bookings and the
// versions that grant the feature, and this says what the withdrawal means
// there.
//
// The reach is fixed when the withdrawal is announced, and it is what the
// subscription is told (`FeatureWithdrawnNotice`): the plan in the rhythm it is
// billed in, each booking running then, or the special terms its contract
// records where no line grants the feature — and the line a change already
// scheduled then brings it to, which was concluded without the withdrawal in
// sight. What the subscriber concludes afterwards is concluded with the
// withdrawal shown, at the price offered.

import type {
    BillingCycle,
    BundleVersionRow,
    ContractLineItemRecord,
    FeatureWithdrawalLine,
    FeatureWithdrawalReachedRow,
    FeatureWithdrawalTarget,
    PlanVersionRow,
    SubscriptionBundleRecord,
    SubscriptionContractRecord,
    SubscriptionUsageRecord,
} from '@saasicat/core';

import { cancellationLandsAt } from '../entitlement/landed-cancellation.js';
import { resolveBundlePriceNet } from './bundle-price.js';
import { bookingOverBy } from './bundle-retirement-reach.js';
import { rhythmTheChangeLandsIn } from './scheduled-change.js';

/** A subscription that may hold the feature, with what it is read with. */
export interface WithdrawalCandidate {
    readonly tenantId: string;
    readonly subscription: SubscriptionUsageRecord & { readonly id: string };
    /** The contract in force when the withdrawal is announced, or null. */
    readonly contract: SubscriptionContractRecord | null;
    /** Its bookings on an add-on version that grants the feature, or scheduled to move to one. */
    readonly bookings: readonly SubscriptionBundleRecord[];
}

/** What the reach of one subscription is judged against. */
export interface WithdrawalReachInputs {
    /** The date the withdrawal takes effect. */
    readonly effectiveFrom: Date;
    /** Whether a set of feature keys grants the feature, a `replaces` chain included. */
    readonly grants: (features: readonly string[]) => boolean;
    /** Every published plan version, by id. */
    readonly planVersions: ReadonlyMap<string, PlanVersionRow>;
    /** The plans' names, by key. */
    readonly planLabels: ReadonlyMap<string, string>;
    /** Every published add-on version, by id. */
    readonly bundleVersions: ReadonlyMap<string, BundleVersionRow>;
}

/** What a withdrawal means for one subscription that holds the feature. */
export type WithdrawalReach =
    { readonly reached: FeatureWithdrawalReachedRow } | { readonly endsBefore: true };

/**
 * What the withdrawal reaches of `candidate`, or null where nothing of it
 * grants the feature. A subscription cancelled to end by the date is not
 * reached: it no longer has the feature to miss.
 */
export function withdrawalReachOf(
    candidate: WithdrawalCandidate,
    inputs: WithdrawalReachInputs,
): WithdrawalReach | null {
    const { subscription, contract } = candidate;
    const plan = planLineOf(candidate, inputs);
    const scheduled = scheduledPlanLineOf(subscription, inputs);
    // One line where the change keeps plan and rhythm, at the lower of its two
    // prices: what a reduction may not exceed once the change has landed.
    const plans =
        plan && scheduled && sameLine(plan, scheduled)
            ? [{ ...plan, priceNet: lowerOf(plan.priceNet, scheduled.priceNet) }]
            : [...(plan ? [plan] : []), ...(scheduled ? [scheduled] : [])];
    const bookings = candidate.bookings.flatMap((booking) => {
        const line = bookingLineOf(booking, candidate, plan?.key ?? subscription.plan, inputs);
        return line ? [line] : [];
    });
    const specialTerms =
        plans.length === 0 &&
        bookings.length === 0 &&
        contract !== null &&
        inputs.grants(contract.entitlementSnapshot?.features ?? []);
    if (plans.length === 0 && bookings.length === 0 && !specialTerms) return null;
    const endsAt = cancellationLandsAt(subscription);
    if (endsAt !== null && endsAt <= inputs.effectiveFrom) return { endsBefore: true };
    return {
        reached: {
            tenantId: candidate.tenantId,
            subscriptionId: subscription.id,
            status: subscription.status,
            lines: [...plans, ...bookings],
            specialTerms,
        },
    };
}

/**
 * The plans and add-ons in a rhythm the reached lines name, with how many
 * lines each and the lowest price among them: what the operator names a
 * reduction for, and what a reduction may not exceed.
 */
export function withdrawalTargetsOf(
    reached: readonly FeatureWithdrawalReachedRow[],
): FeatureWithdrawalTarget[] {
    const targets = new Map<string, FeatureWithdrawalTarget>();
    for (const row of reached) {
        for (const line of row.lines) {
            const key = targetKeyOf(line.line, line.key, line.billingCycle);
            const known = targets.get(key);
            const lowest = lowerOf(known?.lowestPriceNet ?? null, line.priceNet);
            targets.set(key, {
                kind: line.line,
                key: line.key,
                label: known?.label ?? line.label,
                billingCycle: line.billingCycle,
                lines: (known?.lines ?? 0) + 1,
                lowestPriceNet: lowest,
            });
        }
    }
    return [...targets.values()].sort(
        (a, b) =>
            a.kind.localeCompare(b.kind) ||
            a.key.localeCompare(b.key) ||
            a.billingCycle.localeCompare(b.billingCycle),
    );
}

/** One key per plan or add-on and rhythm, for matching a reduction to its target. */
export function targetKeyOf(kind: string, key: string, billingCycle: string): string {
    return `${kind}:${key}:${billingCycle}`;
}

type PricedLine = FeatureWithdrawalLine & { readonly priceNet: number | null };

/**
 * The plan line, where it grants the feature: the one the contract in force
 * records, which is what the platform grants; without a contract, the version
 * the subscription is bound to, in the rhythm it is billed in.
 */
function planLineOf(
    { subscription, contract }: WithdrawalCandidate,
    inputs: WithdrawalReachInputs,
): PricedLine | null {
    if (contract) {
        const line = contract.lineItems.find((item) => item.kind === 'plan');
        if (!line || !inputs.grants(line.featuresSnapshot)) return null;
        return {
            line: 'plan',
            key: line.sourceKey,
            label: line.titleSnapshot,
            subscriptionBundleId: null,
            billingCycle: cycleOf(line),
            priceNet: line.priceNet,
        };
    }
    const version = inputs.planVersions.get(subscription.planVersion.id);
    if (!version || !inputs.grants(version.features)) return null;
    return versionLine(version, subscription.billingCycle as BillingCycle, inputs);
}

/**
 * The plan line a change scheduled when the withdrawal is announced brings the
 * subscription to, where its version grants the feature: in the rhythm the
 * change lands in, on the version it binds (`scheduledVersionOf`).
 */
function scheduledPlanLineOf(
    subscription: SubscriptionUsageRecord,
    inputs: WithdrawalReachInputs,
): PricedLine | null {
    const version = scheduledVersionOf(subscription, inputs.planVersions);
    if (!version || !inputs.grants(version.features)) return null;
    return versionLine(version, rhythmTheChangeLandsIn(subscription), inputs);
}

/**
 * The version a scheduled change binds when it lands: the one it names; naming
 * none, the version the subscription is bound to where the change keeps its
 * plan — it then moves the rhythm only — or the newest published version of
 * the plan it moves to. Null where no change is scheduled.
 */
export function scheduledVersionOf(
    subscription: Pick<
        SubscriptionUsageRecord,
        'plan' | 'planVersion' | 'pendingPlan' | 'pendingChangeVersionId'
    >,
    versions: ReadonlyMap<string, PlanVersionRow>,
): PlanVersionRow | null {
    const { pendingPlan, pendingChangeVersionId } = subscription;
    if (pendingPlan === null) return null;
    if (pendingChangeVersionId) return versions.get(pendingChangeVersionId) ?? null;
    if (pendingPlan === subscription.plan) return versions.get(subscription.planVersion.id) ?? null;
    let newest: PlanVersionRow | null = null;
    for (const version of versions.values()) {
        if (version.planId === pendingPlan && (!newest || version.version > newest.version)) {
            newest = version;
        }
    }
    return newest;
}

function versionLine(
    version: PlanVersionRow,
    billingCycle: BillingCycle,
    inputs: WithdrawalReachInputs,
): PricedLine {
    return {
        line: 'plan',
        key: version.planId,
        label: inputs.planLabels.get(version.planId) ?? version.planId,
        subscriptionBundleId: null,
        billingCycle,
        priceNet: priceOf(billingCycle === 'YEARLY' ? version.yearlyNet : version.monthlyNet),
    };
}

/** Whether two plan lines are one: the same plan in the same rhythm, whichever version. */
function sameLine(a: PricedLine, b: PricedLine): boolean {
    return a.key === b.key && a.billingCycle === b.billingCycle;
}

/**
 * A booking's line, where its version — or the version a move scheduled when
 * the withdrawal is announced brings it to — grants the feature and it still
 * runs on the date: priced as the contract in force records the version it is
 * on, or as the add-on is priced beside the plan otherwise.
 */
function bookingLineOf(
    booking: SubscriptionBundleRecord,
    { subscription, contract }: WithdrawalCandidate,
    planKey: string,
    inputs: WithdrawalReachInputs,
): PricedLine | null {
    const versions = bookingVersionsGranting(booking, inputs);
    const [version] = versions;
    if (!version) return null;
    if (bookingOverBy(booking, cancellationLandsAt(subscription), inputs.effectiveFrom)) {
        return null;
    }
    const billingCycle = (booking.billingCycle ?? subscription.billingCycle) as BillingCycle;
    const priceOf = (one: BundleVersionRow) =>
        contract?.lineItems.find(
            (item) => item.kind === 'bundle' && item.sourceVersionId === one.id,
        )?.priceNet ?? resolveBundlePriceNet(one, planKey, billingCycle);
    return {
        line: 'bundle',
        key: version.bundleKey,
        label: version.label,
        subscriptionBundleId: booking.id,
        billingCycle,
        // Where the version it moves to grants the feature too, the lower of
        // the two: what a reduction may not exceed once the move has landed.
        priceNet: versions.map(priceOf).reduce<number | null>(lowerOf, null),
    };
}

/**
 * The versions of a booking that grant the feature: the one it is on and the
 * one a scheduled move brings it to, in that order, each where it grants it.
 */
export function bookingVersionsGranting(
    booking: Pick<SubscriptionBundleRecord, 'bundleVersionId' | 'pendingBundleVersionId'>,
    inputs: Pick<WithdrawalReachInputs, 'bundleVersions' | 'grants'>,
): BundleVersionRow[] {
    return [booking.bundleVersionId, booking.pendingBundleVersionId].flatMap((id) => {
        const version = id ? inputs.bundleVersions.get(id) : undefined;
        return version && inputs.grants(version.features) ? [version] : [];
    });
}

function cycleOf(line: Pick<ContractLineItemRecord, 'billingCycle'>): BillingCycle {
    return line.billingCycle === 'yearly' ? 'YEARLY' : 'MONTHLY';
}

function priceOf(raw: string | null): number | null {
    if (raw === null) return null;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
}

function lowerOf(a: number | null, b: number | null): number | null {
    if (a === null) return b;
    if (b === null) return a;
    return Math.min(a, b);
}
