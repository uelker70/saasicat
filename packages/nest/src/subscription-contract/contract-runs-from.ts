// Whether a contract runs from a moment on: in force at that moment, or
// beginning after it. A first contract from that moment would run beside it
// (`SC-MKT-028`), and a tenant whose subscription ended at that moment is not
// deleted while it runs, nor reminded of a deletion it is not due for
// (`SC-PRIV-026`).

import {
    ACTIVE_SUBSCRIPTION_CONTRACT_STATUSES,
    type SubscriptionContractRecord,
    type SubscriptionContractRepository,
    type SubscriptionEnd,
} from '@saasicat/core';

/** Whether `contract` is in force at `at` or begins after it. */
export function contractRunsFrom(
    contract: Pick<SubscriptionContractRecord, 'status' | 'effectiveUntil'>,
    at: Date,
): boolean {
    return (
        ACTIVE_SUBSCRIPTION_CONTRACT_STATUSES.includes(contract.status) &&
        (contract.effectiveUntil === null || contract.effectiveUntil > at)
    );
}

/**
 * A contract of `end`'s tenant in force at the end or beginning after it, or
 * null where none is, or the installation keeps no contracts: the contract the
 * end closed stops at it. One read of the tenant's contracts.
 */
export async function contractRunningPast(
    contracts: Pick<SubscriptionContractRepository, 'list'> | null,
    end: Pick<SubscriptionEnd, 'tenantId' | 'endsAt'>,
): Promise<SubscriptionContractRecord | null> {
    if (!contracts) return null;
    const ofTheTenant = await contracts.list({ tenantId: end.tenantId });
    return ofTheTenant.find((contract) => contractRunsFrom(contract, end.endsAt)) ?? null;
}
