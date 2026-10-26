// Where a contract line's plan or add-on stands in today's catalogue, for the
// contract's dossier (`SC-ADM-041`). The contract is read from what it froze;
// the catalogue answers only whether its source is still there.
//
// The catalogue is the installation's, not a tenant's, so nothing here reads
// inside a tenant's row-level scope.

import { Inject, Injectable, Optional } from '@nestjs/common';
import {
    contractSourceStateOf,
    type AdminContractSourceState,
    type BundleRepository,
    type ContractLineItemRecord,
    type PlanRepository,
} from '@saasicat/core';

import { BUNDLE_REPOSITORY_TOKEN, PLAN_REPOSITORY_TOKEN } from '../../catalog/catalog.tokens.js';

/** Answers where the source of a plan or add-on line stands in today's catalogue. */
export interface ContractSourceLookup {
    /** `null` where the installation keeps no catalogue of the line's kind, and for a discount. */
    stateOf(line: ContractLineItemRecord): Promise<AdminContractSourceState | null>;
}

/**
 * The lookup against the installation's plan and bundle repositories, by the
 * key the line froze. Both repositories answer a soft-deleted row for its key
 * (`findByKey`, held by the persistence contract), which is what tells a plan
 * removed from the catalogue from one deleted for good.
 */
@Injectable()
export class CatalogContractSourceLookup implements ContractSourceLookup {
    constructor(
        @Optional()
        @Inject(PLAN_REPOSITORY_TOKEN)
        private readonly plans: PlanRepository | null = null,
        @Optional()
        @Inject(BUNDLE_REPOSITORY_TOKEN)
        private readonly bundles: BundleRepository | null = null,
    ) {}

    async stateOf(line: ContractLineItemRecord): Promise<AdminContractSourceState | null> {
        if (line.kind === 'plan' && this.plans) {
            return contractSourceStateOf(await this.plans.findByKey(line.sourceKey));
        }
        if (line.kind === 'bundle' && this.bundles) {
            return contractSourceStateOf(await this.bundles.findByKey(line.sourceKey));
        }
        return null;
    }
}
