import type { INestApplicationContext } from '@nestjs/common';
import type { BillingCycle } from '@saasicat/core';
import {
    CONTRACT_FREEZE_PORT_TOKEN,
    type ContractFreezePort,
    SubscriberChargeService,
    SubscriptionBundlesService,
} from '@saasicat/nest/billing';
import { SubscriptionContractService } from '@saasicat/nest/subscription-contract';

/** What the seed asks of the platform to activate a subscription. */
export interface SeedActivationPlatform {
    contracts: Pick<SubscriptionContractService, 'list'>;
    addOns: Pick<SubscriptionBundlesService, 'addBundleToSubscription'>;
    freeze: Pick<ContractFreezePort, 'freezeOnPlanChange'>;
    charges: Pick<SubscriberChargeService, 'recordDueCharges'>;
}

/** A seeded subscription as its row stands, and the add-ons it is to be activated with. */
export interface SeededSubscription {
    id: string;
    tenantId: string;
    plan: string;
    billingCycle: BillingCycle;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    billingAnchorDay: number | null;
    canceledAt: Date | null;
    canceledEffectiveAt: Date | null;
    /** The add-on versions to book with it, each one it has no booking of yet. */
    addOns: readonly string[];
}

/** The platform's services a subscription is activated through, from a started platform. */
export function seedActivationPlatformOf(app: INestApplicationContext): SeedActivationPlatform {
    return {
        contracts: app.get(SubscriptionContractService, { strict: false }),
        addOns: app.get(SubscriptionBundlesService, { strict: false }),
        freeze: app.get<ContractFreezePort>(CONTRACT_FREEZE_PORT_TOKEN, { strict: false }),
        charges: app.get(SubscriberChargeService, { strict: false }),
    };
}

/**
 * Activates each subscription that has never had a contract — books its
 * add-ons, freezes its first contract and brings its account up to date — and
 * returns the tenants it activated.
 *
 * That is what an application does when it activates a subscription, and what
 * the platform does when a tenant takes one at onboarding
 * (`docs/guides/wire-the-backend.md`, the charge journal). The contract is
 * what a change is later priced against and what an invoice charges; a
 * subscription without one, or an add-on booked without the window the
 * platform gives it, is a state the platform never leaves behind, and a
 * preview then quotes a change against charges the account does not hold.
 *
 * Everything runs from the start of the window the subscription is in, so the
 * account's first charges are that window, under this contract. A tenant with
 * any contract — in force, ended or ahead — has been activated and is left
 * alone, so a second run activates nothing.
 */
export async function activateSeededSubscriptions(
    platform: SeedActivationPlatform,
    subscriptions: readonly SeededSubscription[],
): Promise<string[]> {
    const activated: string[] = [];
    for (const subscription of subscriptions) {
        const contracts = await platform.contracts.list({ tenantId: subscription.tenantId });
        if (contracts.length > 0) continue;
        const periodStart = subscription.currentPeriodStart;
        if (!periodStart) {
            throw new Error(
                `The seeded subscription of ${subscription.tenantId} has no billing period, so ` +
                    'nothing can say from when its contract runs.',
            );
        }
        const endsAt = subscription.canceledEffectiveAt ?? subscription.canceledAt;
        for (const bundleVersionId of subscription.addOns) {
            await platform.addOns.addBundleToSubscription({
                subscriptionId: subscription.id,
                bundleVersionId,
                currentPlanKey: subscription.plan,
                startedAt: periodStart,
                parentEndsAt: endsAt,
                planCycle: subscription.billingCycle,
                planPeriodEnd: subscription.currentPeriodEnd,
                planAnchorDay: subscription.billingAnchorDay,
                plansAhead: [],
            });
        }
        // After the add-ons: the contract names what is booked when it is written.
        await platform.freeze.freezeOnPlanChange(
            subscription.tenantId,
            subscription.plan,
            subscription.billingCycle,
            periodStart,
            endsAt,
        );
        await platform.charges.recordDueCharges(subscription.tenantId);
        activated.push(subscription.tenantId);
    }
    return activated;
}
