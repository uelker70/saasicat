// @saasicat/persistence-testing — executable persistence contract for
// SaaSiCat adapters. See README for the harness an adapter must provide.

export { persistenceAdapterContract } from './contract.js';
export type {
    ContractAdapterInstances,
    ContractGap,
    ContractSeed,
    PersistenceAdapterContractOptions,
    PersistenceContractHarness,
} from './harness.types.js';
