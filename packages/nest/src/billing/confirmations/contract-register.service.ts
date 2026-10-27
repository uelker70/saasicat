// The contract register of the installation as the operator reads it
// (`SC-ADM-045`): every contract, a former subscriber's and a deleted tenant's
// included, the latest start first, narrowed to where the contracts stand on a
// day — today unless another is asked for —, each with its subscriber as the
// record names it now and its tenant as the application still knows it or not.
// Where each contract stands is the rule in `@saasicat/core`; the store reads
// the moments that rule gives it. The read is platform-wide, so inside
// `RlsBypassPort`.

import { Inject, Injectable, Optional } from '@nestjs/common';
import {
    CONTRACT_REGISTER_PAGE_SIZE,
    adminRegisterContractOf,
    contractRegisterWindowOf,
    dayInZone,
    type AdminContractRegisterPage,
    type AdminTenantSummary,
    type CalendarDay,
    type ContractRegisterState,
    type PlanCatalogSettings,
    type RlsBypassPort,
    type SubscriberRepository,
    type SubscriptionContractRepository,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { readAcrossTenants } from '../../admin/read-across-tenants.js';
import { SUBSCRIBER_REPOSITORY_TOKEN } from '../../subscriber/subscriber.tokens.js';
import { SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN } from '../../subscription-contract/subscription-contract.tokens.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from '../plan-catalog.module.js';

/** The tenants of `tenantIds` the application still has, as the administration reads them. */
export type ContractRegisterTenantLookup = (
    tenantIds: readonly string[],
) => Promise<AdminTenantSummary[]>;

/** What one page of the register is asked for. */
export interface ContractRegisterQuery {
    /** The contracts of one standing, or all; those in force where none is named. */
    state?: ContractRegisterState;
    /** The day every standing is read on; today where none is named. */
    day?: CalendarDay;
    /** The contract the page before ended with. */
    after?: string;
}

@Injectable()
export class ContractRegisterService {
    constructor(
        @Inject(SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN)
        private readonly contracts: SubscriptionContractRepository,
        @Inject(SUBSCRIBER_REPOSITORY_TOKEN)
        private readonly subscribers: SubscriberRepository,
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: PlanCatalogSettings,
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
    ) {}

    /**
     * One page of the register: the contracts of `query.state` on
     * `query.day`, the latest start first, the page after `query.after` where
     * it is given. `tenantsOf` names the tenants the application still has.
     */
    async page(
        query: ContractRegisterQuery,
        tenantsOf: ContractRegisterTenantLookup,
        now: Date = new Date(),
    ): Promise<AdminContractRegisterPage> {
        const timeZone = this.zone();
        const today = dayInZone(now, timeZone);
        const state = query.state ?? 'in-force';
        const day = query.day ?? today;
        return readAcrossTenants(this.rlsBypass, async () => {
            const window = contractRegisterWindowOf(state, day, timeZone);
            const limit = CONTRACT_REGISTER_PAGE_SIZE;
            const page = await this.contracts.listRegister(
                query.after === undefined
                    ? { window, limit }
                    : { window, limit, after: query.after },
            );
            const unique = (ids: string[]) => [...new Set(ids)];
            const subscribers = new Map(
                (
                    await this.subscribers.findByIds(
                        unique(page.contracts.map(({ subscriberId }) => subscriberId)),
                    )
                ).map((subscriber) => [subscriber.id, subscriber]),
            );
            const tenants = new Map(
                (await tenantsOf(unique(page.contracts.map(({ tenantId }) => tenantId)))).map(
                    (tenant) => [tenant.id, tenant],
                ),
            );
            const contracts = page.contracts.map((contract) => {
                const subscriber = subscribers.get(contract.subscriberId);
                // No port deletes a subscriber, and a contract holds on to its
                // own; a contract is not left off the register unnoticed.
                if (!subscriber) {
                    throw new Error(
                        `The register lists contract ${contract.id}, whose subscriber ${contract.subscriberId} the store cannot read.`,
                    );
                }
                return adminRegisterContractOf(
                    contract,
                    subscriber,
                    tenants.get(contract.tenantId),
                    day,
                    timeZone,
                );
            });
            const last = page.contracts[page.contracts.length - 1];
            return {
                today,
                state,
                day,
                contracts,
                next: page.hasMore && last ? last.id : null,
            };
        });
    }

    /** The installation's time zone, which invoicing — and with it the register — requires. */
    private zone(): string {
        const zone = this.settings.timeZone;
        if (!zone) {
            throw new Error(
                "The contract register reads its days in config/saas.yaml's timeZone, which " +
                    'invoicing requires and this installation does not name.',
            );
        }
        return zone;
    }
}
