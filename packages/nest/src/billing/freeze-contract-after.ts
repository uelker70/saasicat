import type { Logger } from '@nestjs/common';
import type { BillingCycle, SubscriptionUsageRecord } from '@saasicat/core';

import { cancellationLandsAt } from '../entitlement/landed-cancellation.js';
import type { IntendedContract } from '../subscription-contract/subscription-contract.service.js';
import type { ContractFreezePort, RetirementContractTerms } from './contract-freeze.tokens.js';

/** The contract a change freezes: the plan and rhythm it leaves, from when, and until when. */
export interface FrozenTerms extends IntendedContract {
    plan: string;
    /** Where a retirement writes it: its move, or the switch it offers. */
    retirement?: RetirementContractTerms;
}

/**
 * The contract a change to `sub` freezes from `effectiveFrom`: in `cycle`, the
 * subscription's own rhythm unless the change names another, and ending when
 * the subscription does.
 */
export function intendedContractOf(
    sub: SubscriptionUsageRecord,
    effectiveFrom: Date,
    cycle: BillingCycle = sub.billingCycle as BillingCycle,
): IntendedContract {
    return { effectiveFrom, cycle, endsAt: cancellationLandsAt(sub) };
}

/**
 * Freezes the successor contract after a change the platform wrote.
 *
 * Non-fatal: the change is already written, and a contract the freeze could
 * not write is logged rather than taking the change back with it. Without a
 * freeze port nothing is frozen and entitlements stay resolved from the
 * version bound.
 */
export async function freezeContractAfter(
    contractFreeze: ContractFreezePort | null,
    tenantId: string,
    terms: FrozenTerms,
    change: string,
    logger: Logger,
): Promise<void> {
    if (!contractFreeze) return;
    try {
        await contractFreeze.freezeOnPlanChange(
            tenantId,
            terms.plan,
            terms.cycle,
            terms.effectiveFrom,
            terms.endsAt,
            ...(terms.retirement ? [terms.retirement] : []),
        );
    } catch (err) {
        logger.error(`Contract freeze after ${change} failed (tenant ${tenantId}): ${String(err)}`);
    }
}
