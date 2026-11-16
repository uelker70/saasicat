// Whether a contract runs from a moment on: in force at that moment, or
// beginning after it. A first contract from that moment would run beside it
// (`SC-MKT-028`), and a tenant whose subscription ended at that moment is not
// deleted while it runs (`SC-PRIV-026`).

import {
    ACTIVE_SUBSCRIPTION_CONTRACT_STATUSES,
    type SubscriptionContractRecord,
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
