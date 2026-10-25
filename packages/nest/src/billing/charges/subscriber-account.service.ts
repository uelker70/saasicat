import { Inject, Injectable } from '@nestjs/common';
import type {
    AdminSubscriberAccount,
    SubscriberLedgerRepository,
    SubscriberRepository,
    SubscriptionContractRepository,
} from '@saasicat/core';

import { subscriberNotFound } from '../../subscriber/subscriber.service.js';
import { SUBSCRIBER_REPOSITORY_TOKEN } from '../../subscriber/subscriber.tokens.js';
import { SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN } from '../../subscription-contract/subscription-contract.tokens.js';
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
    ) {}

    /**
     * The subscriber's account: every charge its journal holds, whichever
     * subscription and tenant it arose under. Refused where there is no such
     * subscriber.
     */
    async accountOf(subscriberId: string): Promise<AdminSubscriberAccount> {
        const subscriber = await this.subscribers.findById(subscriberId);
        if (!subscriber) throw subscriberNotFound(subscriberId);
        const [charges, contracts] = await Promise.all([
            this.ledger.listBySubscriber(subscriberId),
            this.contracts.list({ subscriberId }),
        ]);
        return accountViewOf({ subscriber, charges, contracts });
    }
}
