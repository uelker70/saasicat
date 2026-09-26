import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type {
    BillingCycle,
    SubscriberChargeRecord,
    SubscriberLedgerRepository,
    SubscriberRepository,
    SubscriptionBundleRecord,
    SubscriptionBundleRepository,
    SubscriptionContractRecord,
    SubscriptionContractRepository,
    SubscriptionUsagePort,
    SubscriptionUsageRecord,
} from '@saasicat/core';

import { SUBSCRIBER_REPOSITORY_TOKEN } from '../../subscriber/subscriber.tokens.js';
import { SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN } from '../../subscription-contract/subscription-contract.tokens.js';
import { cancellationHasLanded } from '../../entitlement/landed-cancellation.js';
import { resolvePlanAnchorDay } from '../bundle-period.js';
import { CONTRACT_FREEZE_PORT_TOKEN, type ContractFreezePort } from '../contract-freeze.tokens.js';
import { SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN } from '../subscription-bundles.tokens.js';
import { SUBSCRIPTION_USAGE_PORT_TOKEN } from '../tenant-billing.tokens.js';
import { bookingsTheContractMisses, deriveDueCharges } from './charge-derivation.js';
import { SUBSCRIBER_LEDGER_REPOSITORY_TOKEN } from './subscriber-charge.tokens.js';

/**
 * The usage port types it as a string, but the column behind it is the
 * `BillingCycle` enum in the canonical schema, so the database holds it to the
 * two values.
 */
function planCycleOf(subscription: SubscriptionUsageRecord): BillingCycle {
    return subscription.billingCycle as BillingCycle;
}

/** When the subscription ends, or null while it runs on. */
function endOf(subscription: SubscriptionUsageRecord): Date | null {
    return subscription.canceledEffectiveAt ?? subscription.canceledAt ?? null;
}

/**
 * Keeps a subscriber's account up to date: the charges its contracts give rise
 * to, one per contract line and period.
 *
 * The platform calls it where it writes a change itself — onboarding, an
 * immediate plan change and an add-on booking. An application calls it where
 * it writes one: when it activates a subscription, and from the job that renews
 * periods. However often it runs, each charge is written once.
 */
@Injectable()
export class SubscriberChargeService {
    private readonly logger = new Logger(SubscriberChargeService.name);

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
        // Always there where the module wires the journal, which requires
        // `contractFreeze`; optional so that the service can be built without.
        @Optional()
        @Inject(CONTRACT_FREEZE_PORT_TOKEN)
        private readonly freeze: ContractFreezePort | null = null,
    ) {}

    /**
     * Writes every charge the tenant's records give rise to by `now` that is
     * not written yet, and returns those.
     *
     * Nothing is charged without a contract (a charge points at a contract
     * line), in a trial, before the plan's current window when the account is
     * still empty, for a period that starts after `now`, or for one that
     * starts on or after the date a cancellation takes effect.
     *
     * A window that moved on before anything charged it is not charged
     * afterwards, so a job that renews periods calls this before it moves a
     * window, and moves it only when the call succeeded.
     */
    async recordDueCharges(tenantId: string, now = new Date()): Promise<SubscriberChargeRecord[]> {
        const subscription = await this.subscriptions.findForTenant(tenantId);
        if (!subscription?.id) return [];
        const subscriber = await this.subscribers.findByTenantId(tenantId);
        if (!subscriber) return [];
        const [bookings, written] = await Promise.all([
            this.bookings?.listBySubscription(subscription.id) ?? [],
            this.ledger.listBySubscription(subscription.id),
        ]);
        const contracts = await this.contractsNamingEveryBooking(
            tenantId,
            subscription,
            bookings,
            now,
        );
        const due = deriveDueCharges({
            now,
            subscriberId: subscriber.id,
            subscription: {
                id: subscription.id,
                tenantId,
                status: subscription.status,
                billingCycle: planCycleOf(subscription),
                currentPeriodStart: subscription.currentPeriodStart,
                currentPeriodEnd: subscription.currentPeriodEnd,
                anchorDay: resolvePlanAnchorDay(subscription),
                startedAt: subscription.startedAt,
                endsAt: endOf(subscription),
            },
            contracts,
            bookings,
            written,
        });
        return this.ledger.recordCharges(due);
    }

    /**
     * The tenant's contracts, written once more where the one in force misses
     * a running booking.
     *
     * A booking writes its contract after it is saved, and a failure there does
     * not undo the booking. The booking would then stay uncharged for good,
     * since a charge points at a contract line — so the journal writes the
     * contract the way the booking would have. A failure here is logged and the
     * rest is charged: the next call tries again.
     */
    private async contractsNamingEveryBooking(
        tenantId: string,
        subscription: SubscriptionUsageRecord,
        bookings: readonly SubscriptionBundleRecord[],
        now: Date,
    ): Promise<SubscriptionContractRecord[]> {
        const contracts = await this.contracts.list({ tenantId });
        const missed = bookingsTheContractMisses(contracts, bookings, now);
        if (
            missed.length === 0 ||
            !this.freeze ||
            subscription.status === 'TRIAL' ||
            cancellationHasLanded(subscription, now)
        ) {
            return contracts;
        }
        try {
            await this.freeze.freezeOnPlanChange(
                tenantId,
                subscription.planVersion.planId,
                planCycleOf(subscription),
                now,
                endOf(subscription),
            );
        } catch (err) {
            this.logger.error(
                `Writing the contract for ${missed.length} booking(s) it misses failed ` +
                    `(tenant ${tenantId}): ${String(err)}`,
            );
            return contracts;
        }
        return this.contracts.list({ tenantId });
    }
}
