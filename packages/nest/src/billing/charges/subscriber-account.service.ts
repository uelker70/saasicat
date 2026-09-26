import { Inject, Injectable } from '@nestjs/common';
import type {
    AdminSubscriberAccount,
    SubscriberLedgerRepository,
    SubscriberRepository,
    SubscriptionContractRepository,
    SubscriptionUsagePort,
} from '@saasicat/core';

import { SUBSCRIBER_REPOSITORY_TOKEN } from '../../subscriber/subscriber.tokens.js';
import { SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN } from '../../subscription-contract/subscription-contract.tokens.js';
import { SUBSCRIPTION_USAGE_PORT_TOKEN } from '../tenant-billing.tokens.js';
import { accountViewOf } from './subscriber-account.js';
import { SUBSCRIBER_LEDGER_REPOSITORY_TOKEN } from './subscriber-charge.tokens.js';

/**
 * Reads a subscriber's account for the operator: the charges its journal
 * holds, each with the title of the contract line it came from.
 *
 * It reads only. Nothing here derives or writes a charge — that is
 * `SubscriberChargeService`'s — so looking at an account never changes it.
 */
@Injectable()
export class SubscriberAccountService {
    constructor(
        @Inject(SUBSCRIBER_LEDGER_REPOSITORY_TOKEN)
        private readonly ledger: SubscriberLedgerRepository,
        @Inject(SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN)
        private readonly contracts: SubscriptionContractRepository,
        @Inject(SUBSCRIBER_REPOSITORY_TOKEN)
        private readonly subscribers: SubscriberRepository,
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
    ) {}

    /** The account of the tenant's subscriber; empty while it has no subscription. */
    async accountOf(tenantId: string): Promise<AdminSubscriberAccount> {
        const [subscription, subscriber, contracts] = await Promise.all([
            this.subscriptions.findForTenant(tenantId),
            this.subscribers.findByTenantId(tenantId),
            this.contracts.list({ tenantId }),
        ]);
        const charges = subscription?.id
            ? await this.ledger.listBySubscription(subscription.id)
            : [];
        return accountViewOf({ subscriber, charges, contracts });
    }
}
