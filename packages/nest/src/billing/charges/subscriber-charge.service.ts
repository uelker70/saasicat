import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
    BillingCycle,
    SubscriberChargeRecord,
    SubscriberLedgerRepository,
    SubscriberRepository,
    SubscriptionBundleRepository,
    SubscriptionContractRepository,
    SubscriptionUsagePort,
} from '@saasicat/core';

import { SUBSCRIBER_REPOSITORY_TOKEN } from '../../subscriber/subscriber.tokens.js';
import { SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN } from '../../subscription-contract/subscription-contract.tokens.js';
import { resolvePlanAnchorDay } from '../bundle-period.js';
import { SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN } from '../subscription-bundles.tokens.js';
import { SUBSCRIPTION_USAGE_PORT_TOKEN } from '../tenant-billing.tokens.js';
import { deriveDueCharges } from './charge-derivation.js';
import { SUBSCRIBER_LEDGER_REPOSITORY_TOKEN } from './subscriber-charge.tokens.js';

/**
 * Keeps a subscriber's account up to date: the charges its contracts give rise
 * to, one per contract line and period.
 *
 * The platform calls it where it writes a change itself — onboarding and an
 * add-on booking. An application calls it where it writes one: when it
 * activates a subscription, and from the job that renews periods. However often
 * it runs, each charge is written once.
 */
@Injectable()
export class SubscriberChargeService {
    constructor(
        @Inject(SUBSCRIBER_LEDGER_REPOSITORY_TOKEN)
        private readonly ledger: SubscriberLedgerRepository,
        @Inject(SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN)
        private readonly contracts: SubscriptionContractRepository,
        @Inject(SUBSCRIBER_REPOSITORY_TOKEN)
        private readonly subscribers: SubscriberRepository,
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
        // Optional — an installation without add-ons has no bookings to charge.
        @Optional()
        @Inject(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN)
        private readonly bookings: SubscriptionBundleRepository | null = null,
    ) {}

    /**
     * Writes every charge the tenant's records give rise to by `now` that is
     * not written yet, and returns those.
     *
     * Nothing is charged without a contract (a charge points at a contract
     * line), in a trial, for a period that starts after `now`, or for one that
     * starts on or after the date a cancellation takes effect.
     */
    async recordDueCharges(tenantId: string, now = new Date()): Promise<SubscriberChargeRecord[]> {
        const subscription = await this.subscriptions.findForTenant(tenantId);
        if (!subscription?.id) return [];
        const subscriber = await this.subscribers.findByTenantId(tenantId);
        if (!subscriber) return [];
        const [contracts, bookings, written] = await Promise.all([
            this.contracts.list({ tenantId }),
            this.bookings?.listBySubscription(subscription.id) ?? [],
            this.ledger.listBySubscription(subscription.id),
        ]);
        const due = deriveDueCharges({
            now,
            subscriberId: subscriber.id,
            subscription: {
                id: subscription.id,
                tenantId,
                status: subscription.status,
                // The column behind it is the `BillingCycle` enum in the
                // canonical schema, so the database holds it to the two values.
                billingCycle: subscription.billingCycle as BillingCycle,
                currentPeriodStart: subscription.currentPeriodStart,
                currentPeriodEnd: subscription.currentPeriodEnd,
                anchorDay: resolvePlanAnchorDay(subscription),
                endsAt: subscription.canceledEffectiveAt ?? subscription.canceledAt ?? null,
            },
            contracts,
            bookings,
            written,
        });
        return this.ledger.recordCharges(due);
    }
}
