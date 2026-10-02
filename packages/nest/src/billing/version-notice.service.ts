// Telling a subscriber, once, that a newer version of their plan is offered to
// them (`SC-SUB-022`).
//
// The notice goes out when the offer appears beside the plan, not when the
// version is published: a version whose window opens later is not offered yet,
// and a subscription with a change still to land is offered nothing. Both hear
// of it on the first run after the offer is theirs, so the notice and the offer
// always say the same thing. Each notice is recorded before it is sent and
// confirmed after (`SC-SUB-023`), which is what makes it once rather than once a
// run.

import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';
import type {
    PlanRepository,
    RlsBypassPort,
    SubscriptionNoticePort,
    SubscriptionNoticeRepository,
    SubscriptionUsagePort,
    TenantSubscriptionUsage,
    VersionOfferedNotice,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { readAcrossTenants } from '../admin/read-across-tenants.js';
import { PLAN_REPOSITORY_TOKEN } from '../catalog/catalog.tokens.js';
import { NOTICE_DELIVERY_TIMEOUT_MS, NoticeSender } from './notice-sender.js';
import {
    SUBSCRIPTION_NOTICE_PORT_TOKEN,
    SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN,
    SUBSCRIPTION_USAGE_PORT_TOKEN,
} from './tenant-billing.tokens.js';
import { VersionOfferService } from './version-offer.service.js';
import { versionOnSale } from './version-on-sale.js';

/** What one run did: notices sent, and notices whose sending failed and waits for the next run. */
export interface VersionNoticeRun {
    readonly told: number;
    readonly failed: number;
}

@Injectable()
export class VersionNoticeService implements OnModuleInit {
    private readonly deliveryTimeoutMs = NOTICE_DELIVERY_TIMEOUT_MS;
    private readonly sender: NoticeSender;

    constructor(
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
        @Inject(PLAN_REPOSITORY_TOKEN)
        private readonly plans: PlanRepository,
        @Inject(SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN)
        private readonly notices: SubscriptionNoticeRepository,
        @Inject(SUBSCRIPTION_NOTICE_PORT_TOKEN)
        port: SubscriptionNoticePort,
        private readonly offers: VersionOfferService,
        // The run is the installation's, not a tenant's: under a row policy it
        // would otherwise find no subscription and report that it told nobody.
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
    ) {
        this.sender = new NoticeSender(notices, port);
    }

    /**
     * Refuses a wiring that could never send a notice. Starting anyway would
     * leave every run finding nobody to tell, which reads exactly like nobody
     * being due.
     */
    onModuleInit(): void {
        if (!this.subscriptions.listBoundToEarlierVersions) {
            throw new Error(
                'Version notices are turned on, but the SubscriptionUsagePort has no ' +
                    '`listBoundToEarlierVersions`: the platform cannot find the subscriptions a ' +
                    'newer version is offered to. Both shipped adapters have it; a port of your ' +
                    'own adds it, or leave `tenantBilling.versionNotices` out.',
            );
        }
        if (!this.plans.findVersionById) {
            throw new Error(
                'Version notices are turned on, but the PlanRepository has no `findVersionById`: ' +
                    'without the version a subscription is bound to there is no offer, and so ' +
                    'nothing to tell. Both shipped adapters have it.',
            );
        }
    }

    /**
     * Tells every subscription of the version now offered to it, where it has
     * not been told of that version yet.
     */
    async sendDue(now: Date): Promise<VersionNoticeRun> {
        return readAcrossTenants(this.rlsBypass, async () => {
            let told = 0;
            let failed = 0;
            for (const plan of await this.plans.list({ onlyPublished: true })) {
                for (const notice of await this.dueFor(plan.planKey, now)) {
                    const outcome = await this.sender.tell(
                        notice,
                        notice.offer.offered.planVersionId,
                        this.deliveryTimeoutMs,
                    );
                    if (outcome === 'told') told += 1;
                    if (outcome === 'failed') failed += 1;
                }
            }
            return { told, failed };
        });
    }

    /** The notices due for one plan: an offer of the version on sale, not yet told. */
    private async dueFor(planKey: string, now: Date): Promise<VersionOfferedNotice[]> {
        const onSale = await versionOnSale(this.plans, planKey, now);
        if (!onSale) return [];
        const candidates = await this.listBoundToEarlierVersions(planKey, onSale.version);
        if (candidates.length === 0) return [];
        const told = new Set(
            await this.notices.listDeliveredSubscriptionIds('version-offered', onSale.id),
        );
        const due: VersionOfferedNotice[] = [];
        for (const { tenantId, subscription } of candidates) {
            if (told.has(subscription.id)) continue;
            // The offer decides, not this loop: a subscription that could not
            // take the version now is told when it can.
            const offer = await this.offers.offerForSubscription(subscription, now);
            if (!offer || offer.offered.planVersionId !== onSale.id) continue;
            due.push({ kind: 'version-offered', tenantId, subscriptionId: subscription.id, offer });
        }
        return due;
    }

    private listBoundToEarlierVersions(
        planKey: string,
        version: number,
    ): Promise<TenantSubscriptionUsage[]> {
        // `onModuleInit` refused a port without it.
        return this.subscriptions.listBoundToEarlierVersions!(planKey, version);
    }
}
