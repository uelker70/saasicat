export const SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN = Symbol.for(
    'saasicat/nest/SubscriptionContractRepository',
);

/**
 * The transaction a successor is written on together with the end of the
 * contract it replaces. Optional, with two costs where it is absent: the two
 * are written one after the other, so a failure between them leaves the tenant
 * with no contract in force until the next freeze; and a writer that finds no
 * contract in force at its moment cannot see a successor another writer is
 * halfway through, so the two can end up in force side by side.
 * `SaaSiCatModule.forRoot` always binds one.
 */
export const CONTRACT_TRANSACTION_RUNNER_TOKEN = Symbol.for(
    'saasicat/nest/ContractTransactionRunner',
);
