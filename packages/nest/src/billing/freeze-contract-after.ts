import type { Logger } from '@nestjs/common';
import type { BillingCycle, ContractAgreement, SubscriptionUsageRecord } from '@saasicat/core';

import { cancellationLandsAt } from '../entitlement/landed-cancellation.js';
import type { IntendedContract } from '../subscription-contract/subscription-contract.service.js';
import type { ContractFreezePort } from './contract-freeze.tokens.js';

/** The contract a change freezes: the plan and rhythm it leaves, from when, and until when. */
export interface FrozenTerms extends IntendedContract {
    plan: string;
    /**
     * What the subscriber agreed to when they scheduled the change, for one
     * written when it takes effect (`AgreedChangeContractTerms`).
     */
    agreed?: ContractAgreement;
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
 * The contract a change made to `sub` now freezes, or `null` in a trial: a
 * trial commits to no period, a change made in it freezes nothing, and its
 * contract is frozen when it converts.
 */
export function contractUnlessTrialOf(
    sub: SubscriptionUsageRecord,
    effectiveFrom: Date,
    cycle?: BillingCycle,
): IntendedContract | null {
    return sub.status === 'TRIAL' ? null : intendedContractOf(sub, effectiveFrom, cycle);
}

/**
 * Freezes the successor contract after a change the platform wrote, where the
 * charge journal charges right without it.
 *
 * Non-fatal: the change is already written and stands, and a contract the
 * freeze could not write is logged. Only for a change the journal answers for
 * on its own — it writes the contract itself where the one in force misses a
 * running booking or names a plan version other than the one bound
 * (`SC-PRIC-105`), and it stops charging a booking when the booking ends,
 * whatever the contract says. A change that moves the plan is one with its
 * contract or none (`freezeOrTakeBack`), and calls of the freeze that only log
 * go through here, so that is checked from the source. Without a freeze port
 * nothing is frozen and entitlements stay resolved from the version bound.
 */
export async function freezeHealedByTheJournal(
    contractFreeze: ContractFreezePort | null,
    tenantId: string,
    terms: FrozenTerms,
    change: string,
    logger: Pick<Logger, 'error'>,
): Promise<void> {
    if (!contractFreeze) return;
    try {
        await contractFreeze.freezeOnPlanChange(
            tenantId,
            terms.plan,
            terms.cycle,
            terms.effectiveFrom,
            terms.endsAt,
            ...(terms.agreed ? [{ agreed: terms.agreed }] : []),
        );
    } catch (err) {
        logger.error(`Contract freeze after ${change} failed (tenant ${tenantId}): ${String(err)}`);
    }
}

/**
 * Ends the frozen contract at `endsAt`, the moment the subscription's
 * cancellation lands.
 *
 * Non-fatal, as freezing is: the cancellation is already written, and a
 * contract the port could not end is logged. Ending one already ended there is
 * a no-op, so a repeat repairs rather than doubles. Without a freeze port there
 * is no contract to end.
 */
export async function endContractAfter(
    contractFreeze: ContractFreezePort | null,
    tenantId: string,
    endsAt: Date,
    cancellation: string,
    logger: Logger,
): Promise<void> {
    if (!contractFreeze) return;
    try {
        await contractFreeze.endOnCancellation(tenantId, endsAt);
    } catch (err) {
        logger.error(
            `Ending the contract for ${cancellation} failed (tenant ${tenantId}): ${String(err)}`,
        );
    }
}
