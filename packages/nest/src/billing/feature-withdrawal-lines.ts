// The discount lines a feature withdrawal adds to a subscription's contract.
// Pure: the caller hands over the lines the contract is written with, what the
// subscription was told at the announcement, and which lines any contract of
// the tenant records already.
//
// A reduction is part of the agreement, so it is a line of the contract, as a
// promotional code or a held price is: generated, keyed by the withdrawal and
// what it reduces, and recorded once — the journal reads each from the earliest
// contract that records it. It reduces the line the subscription was told of:
// the plan in its rhythm, or one booking. Where that line is no longer in the
// contract — the subscriber changed plan or rhythm, or the booking ended — the
// reduction is not carried onto anything else.

import type {
    FeatureWithdrawalNoticeLine,
    FeatureWithdrawnNotice,
    NewContractLineItemData,
} from '@saasicat/core';

import type { PricedContractLineItem } from '../subscription-contract/contract-line-item-money.js';

/** What `metadata.source` says of a line a withdrawal generated. */
export const FEATURE_WITHDRAWAL_LINE_SOURCE = 'feature-withdrawal';

/** What a reduction line records of the reduction it carries. */
export interface WithdrawalReductionMark {
    readonly withdrawalId: string;
    readonly line: 'plan' | 'bundle';
    /** The plan key, or the add-on's key. */
    readonly key: string;
    /** The booking it reduces; null for the plan. */
    readonly subscriptionBundleId: string | null;
    /** Per whole period of the line's rhythm, as the operator named it. */
    readonly amountNet: number;
}

/** A line of a contract as this reads it. */
type ContractLine = Pick<
    NewContractLineItemData,
    'kind' | 'sourceKey' | 'sourceVersionId' | 'billingCycle' | 'priceNet'
>;

/** What one subscription was told of one withdrawal, and whether it took anything away. */
export interface WithdrawalTold {
    readonly notice: FeatureWithdrawnNotice;
    /** False where it was lifted before its date, and so never reduced anything. */
    readonly everInEffect: boolean;
}

/**
 * The key a reduction line is recorded under: one per withdrawal and line
 * reduced — the plan in its rhythm, since a change scheduled before the
 * announcement can bring a second, or the booking.
 */
export function reductionSourceKeyOf(
    withdrawalId: string,
    reached: Pick<FeatureWithdrawalNoticeLine, 'subscriptionBundleId' | 'key' | 'billingCycle'>,
): string {
    return reached.subscriptionBundleId === null
        ? `${FEATURE_WITHDRAWAL_LINE_SOURCE}:${withdrawalId}:plan:${reached.key}:${reached.billingCycle}`
        : `${FEATURE_WITHDRAWAL_LINE_SOURCE}:${withdrawalId}:${reached.subscriptionBundleId}`;
}

/**
 * The reduction lines a contract written with `lines` adds: one for each line
 * the subscription was told of with a reduction, that the contract still
 * carries, and that no contract of the tenant records yet (`recorded`).
 *
 * `bookingVersions` names the version each booking is on, which is how a
 * booking's line is found among the contract's: a contract names add-on
 * versions, not bookings.
 */
export function withdrawalReductionLines(
    lines: readonly ContractLine[],
    told: readonly WithdrawalTold[],
    recorded: ReadonlySet<string>,
    bookingVersions: ReadonlyMap<string, string>,
): PricedContractLineItem[] {
    const added: PricedContractLineItem[] = [];
    for (const { notice, everInEffect } of told) {
        if (!everInEffect) continue;
        for (const reached of notice.lines) {
            if (reached.reductionNet === null) continue;
            const sourceKey = reductionSourceKeyOf(notice.withdrawalId, reached);
            if (recorded.has(sourceKey)) continue;
            const reduced = lineReduced(lines, reached, bookingVersions);
            if (!reduced) continue;
            added.push(reductionLine(notice, reached, reduced, sourceKey));
        }
    }
    return added;
}

/** The mark a reduction line carries, or null for any other line. */
export function withdrawalReductionOf(line: {
    kind: string;
    metadata?: unknown;
}): WithdrawalReductionMark | null {
    if (line.kind !== 'discount' || !isRecord(line.metadata)) return null;
    if (
        line.metadata.generated !== true ||
        line.metadata.source !== FEATURE_WITHDRAWAL_LINE_SOURCE
    ) {
        return null;
    }
    const mark = line.metadata.reduction;
    if (
        !isRecord(mark) ||
        typeof mark.withdrawalId !== 'string' ||
        (mark.line !== 'plan' && mark.line !== 'bundle') ||
        typeof mark.key !== 'string' ||
        typeof mark.amountNet !== 'number' ||
        !Number.isFinite(mark.amountNet) ||
        (mark.subscriptionBundleId !== null && typeof mark.subscriptionBundleId !== 'string')
    ) {
        return null;
    }
    return {
        withdrawalId: mark.withdrawalId,
        line: mark.line,
        key: mark.key,
        subscriptionBundleId: mark.subscriptionBundleId as string | null,
        amountNet: mark.amountNet,
    };
}

/** The contract line a reached line is still, where the contract carries it as it was reached. */
function lineReduced(
    lines: readonly ContractLine[],
    reached: FeatureWithdrawalNoticeLine,
    bookingVersions: ReadonlyMap<string, string>,
): ContractLine | null {
    const rhythm = reached.billingCycle === 'YEARLY' ? 'yearly' : 'monthly';
    if (reached.subscriptionBundleId === null) {
        return (
            lines.find(
                (line) =>
                    line.kind === 'plan' &&
                    line.sourceKey === reached.key &&
                    line.billingCycle === rhythm,
            ) ?? null
        );
    }
    const version = bookingVersions.get(reached.subscriptionBundleId);
    if (!version) return null;
    return (
        lines.find(
            (line) =>
                line.kind === 'bundle' &&
                line.sourceVersionId === version &&
                line.billingCycle === rhythm,
        ) ?? null
    );
}

/**
 * The discount line for one reduced line, in that line's rhythm. It takes off
 * at most the line's own price: a price is reduced to nothing at most, and a
 * version published since the announcement may cost less than the one the
 * operator measured the reduction against.
 */
function reductionLine(
    notice: FeatureWithdrawnNotice,
    reached: FeatureWithdrawalNoticeLine,
    reduced: ContractLine,
    sourceKey: string,
): PricedContractLineItem {
    const amountNet = Math.min(reached.reductionNet ?? 0, Math.max(0, reduced.priceNet));
    const mark: WithdrawalReductionMark = {
        withdrawalId: notice.withdrawalId,
        line: reached.line,
        key: reached.key,
        subscriptionBundleId: reached.subscriptionBundleId,
        amountNet,
    };
    return {
        kind: 'discount',
        sourceKey,
        sourceVersionId: null,
        titleSnapshot: `${reached.label}: reduced while ${notice.featureLabel} is withdrawn`,
        descriptionSnapshot: null,
        quantity: 1,
        unit: null,
        priceNet: -amountNet,
        billingCycle: reduced.billingCycle,
        minimumTermUntil: null,
        featuresSnapshot: [],
        quotaEffectsSnapshot: {},
        metadata: { generated: true, source: FEATURE_WITHDRAWAL_LINE_SOURCE, reduction: mark },
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
