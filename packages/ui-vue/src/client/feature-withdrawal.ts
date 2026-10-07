// What the operator's page reads off a feature withdrawal: where it stands,
// what its preview reaches, and the reductions typed into it, checked before
// they are sent. Framework-free, so it is tested without a browser.
//
// The server checks every reduction again and is the authority; what is
// checked here is what lets the dialog say which field is wrong before the
// second factor is asked for.

import {
    isFeatureWithdrawnAt,
    type FeatureWithdrawalPreview,
    type FeatureWithdrawalReduction,
    type FeatureWithdrawalRow,
    type FeatureWithdrawalTarget,
} from '@saasicat/core';

/** Where a withdrawal stands: announced for a date ahead, taking the feature away, or lifted. */
export type FeatureWithdrawalStatus = 'announced' | 'inEffect' | 'lifted';

/**
 * Where `row` stands at `now`. A withdrawal lifted before its own date never
 * takes the feature away, so it reads as lifted from the moment it is.
 */
export function featureWithdrawalStatusOf(
    row: Pick<FeatureWithdrawalRow, 'effectiveFrom' | 'liftedFrom'>,
    now: Date,
): FeatureWithdrawalStatus {
    const effectiveFrom = new Date(row.effectiveFrom);
    const liftedFrom = row.liftedFrom === null ? null : new Date(row.liftedFrom);
    if (isFeatureWithdrawnAt({ effectiveFrom, liftedFrom }, now)) return 'inEffect';
    if (liftedFrom !== null && (liftedFrom <= now || liftedFrom <= effectiveFrom)) return 'lifted';
    return 'announced';
}

/** Whether `row` can still be lifted: nobody has named a date for it yet. */
export function canLiftFeatureWithdrawal(row: Pick<FeatureWithdrawalRow, 'liftedFrom'>): boolean {
    return row.liftedFrom === null;
}

/** One field of the dialog per plan or add-on in a rhythm: the key its amount is typed under. */
export function featureWithdrawalTargetKeyOf(
    target: Pick<FeatureWithdrawalTarget, 'kind' | 'key' | 'billingCycle'>,
): string {
    return `${target.kind}:${target.key}:${target.billingCycle}`;
}

/** What is wrong with an amount typed for a target. */
export type ReductionAmountProblem = 'notAnAmount' | 'notPositive' | 'tooPrecise' | 'exceedsPrice';

/** An amount as a number input holds it: a number, or nothing where the field is empty. */
export type ReductionAmountInput = number | string | null | undefined;

export interface ReductionsRead {
    /** The reductions to send, one per target with an amount. */
    readonly reductions: FeatureWithdrawalReduction[];
    /** What is wrong, by target key; empty where every amount can be sent. */
    readonly problems: Readonly<Record<string, ReductionAmountProblem>>;
}

const CENTS_PER_UNIT = 100;

/**
 * The reductions the amounts typed for `targets` name. An empty field names
 * none — the plan or add-on is then not reduced. An amount is net, per whole
 * period of its rhythm, to the cent, and no more than the lowest price it
 * reduces.
 */
export function reductionsOf(
    targets: readonly FeatureWithdrawalTarget[],
    amounts: Readonly<Record<string, ReductionAmountInput>>,
): ReductionsRead {
    const reductions: FeatureWithdrawalReduction[] = [];
    const problems: Record<string, ReductionAmountProblem> = {};
    for (const target of targets) {
        const key = featureWithdrawalTargetKeyOf(target);
        const typed = amounts[key];
        if (typed === null || typed === undefined || typed === '') continue;
        const amountNet = typeof typed === 'number' ? typed : Number(typed);
        const problem = problemOf(amountNet, target.lowestPriceNet);
        if (problem) {
            problems[key] = problem;
            continue;
        }
        reductions.push({
            kind: target.kind,
            key: target.key,
            billingCycle: target.billingCycle,
            amountNet,
        });
    }
    return { reductions, problems };
}

function problemOf(amount: number, lowestPriceNet: number | null): ReductionAmountProblem | null {
    if (!Number.isFinite(amount)) return 'notAnAmount';
    if (amount <= 0) return 'notPositive';
    const cents = amount * CENTS_PER_UNIT;
    if (Math.abs(cents - Math.round(cents)) > 1e-9) return 'tooPrecise';
    if (lowestPriceNet !== null && amount > lowestPriceNet) return 'exceedsPrice';
    return null;
}

/** What a preview reaches, counted the way the dialog says it. */
export interface FeatureWithdrawalReach {
    /** Subscriptions told at the announcement. */
    readonly subscriptions: number;
    /** Of those, the ones holding the feature through special terms only: told, no reduction. */
    readonly specialTermsOnly: number;
    /** Subscriptions holding the feature that end before the date, and are not told. */
    readonly endingBefore: number;
}

export function featureWithdrawalReachOf(
    preview: FeatureWithdrawalPreview,
): FeatureWithdrawalReach {
    return {
        subscriptions: preview.reached.length,
        specialTermsOnly: preview.reached.filter((row) => row.specialTerms).length,
        endingBefore: preview.skipped.length,
    };
}
