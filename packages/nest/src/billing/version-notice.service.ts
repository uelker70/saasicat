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

import { Inject, Injectable, Logger, type OnModuleInit, Optional } from '@nestjs/common';
import type {
    PlanRepository,
    RlsBypassPort,
    SubscriptionNoticeDelivery,
    SubscriptionNoticePort,
    SubscriptionNoticeRepository,
    SubscriptionUsagePort,
    TenantSubscriptionUsage,
    VersionOfferedNotice,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { readAcrossTenants } from '../admin/read-across-tenants.js';
import { PLAN_REPOSITORY_TOKEN } from '../catalog/catalog.tokens.js';
import { TimeoutError, withTimeout } from '../core/with-timeout.js';
import {
    SUBSCRIPTION_NOTICE_PORT_TOKEN,
    SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN,
    SUBSCRIPTION_USAGE_PORT_TOKEN,
} from './tenant-billing.tokens.js';
import { VersionOfferService } from './version-offer.service.js';
import { versionOnSale } from './version-on-sale.js';

/**
 * How long a run's claim on a notice holds. Longer than an attempt may take,
 * so a second instance does not take a notice on while the first still waits
 * for the application to answer.
 */
const CLAIM_LEASE_MS = 15 * 60_000;

/** How long the application may take to send one notice before the attempt counts as failed. */
const DELIVERY_TIMEOUT_MS = 60_000;

/** What one run did: notices sent, and notices whose sending failed and waits for the next run. */
export interface VersionNoticeRun {
    readonly told: number;
    readonly failed: number;
}

@Injectable()
export class VersionNoticeService implements OnModuleInit {
    private readonly logger = new Logger(VersionNoticeService.name);
    private readonly deliveryTimeoutMs = DELIVERY_TIMEOUT_MS;

    constructor(
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
        @Inject(PLAN_REPOSITORY_TOKEN)
        private readonly plans: PlanRepository,
        @Inject(SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN)
        private readonly notices: SubscriptionNoticeRepository,
        @Inject(SUBSCRIPTION_NOTICE_PORT_TOKEN)
        private readonly port: SubscriptionNoticePort,
        private readonly offers: VersionOfferService,
        // The run is the installation's, not a tenant's: under a row policy it
        // would otherwise find no subscription and report that it told nobody.
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
    ) {}

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
                    const outcome = await this.tell(notice);
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

    /**
     * Claims the notice, has the application send it, and records to whom.
     * Null where another run holds it or it went out meanwhile.
     */
    private async tell(notice: VersionOfferedNotice): Promise<'told' | 'failed' | null> {
        // Stamped with the moment it is taken, not with the start of the run: a
        // run that takes longer than the lease would otherwise take claims that
        // every other instance already reads as abandoned.
        const takenAt = new Date();
        const claimed = await this.notices.claim(
            {
                tenantId: notice.tenantId,
                subscriptionId: notice.subscriptionId,
                kind: notice.kind,
                subject: notice.offer.offered.planVersionId,
            },
            notice,
            takenAt,
            new Date(takenAt.getTime() - CLAIM_LEASE_MS),
        );
        if (!claimed) return null;
        const claimedAt = claimed.claimedAt ?? takenAt;

        const sending = this.port.deliver(notice);
        let delivery: SubscriptionNoticeDelivery;
        try {
            delivery = await withTimeout(sending, this.deliveryTimeoutMs);
        } catch (error) {
            if (error instanceof TimeoutError) {
                this.settleLate(sending, claimed.id, claimedAt);
            } else {
                this.logger.error(
                    `The notice of version ${notice.offer.offered.planVersionId} to subscription ` +
                        `${notice.subscriptionId} was not sent; the next run tries again.`,
                    error instanceof Error ? error.stack : String(error),
                );
                await this.notices.release(claimed.id, claimedAt);
            }
            return 'failed';
        }
        if (delivery.recipients.length === 0) {
            this.logger.warn(
                `Subscription ${notice.subscriptionId} was offered version ` +
                    `${notice.offer.offered.planVersionId}, and the application told nobody; ` +
                    'the notice is recorded as sent to no one and is not tried again.',
            );
        }
        await this.recordSent(claimed.id, claimedAt, delivery);
        return 'told';
    }

    /**
     * An application that has not answered in time may still send the notice,
     * so its claim is not let go: no other run takes it on while the answer is
     * awaited. A late success is recorded as sent, and a late failure lets the
     * claim go for the next run. An answer that takes longer than the lease
     * comes after another run may have sent the notice again.
     */
    private settleLate(
        sending: Promise<SubscriptionNoticeDelivery>,
        id: string,
        claimedAt: Date,
    ): void {
        this.logger.warn(
            `The application did not answer within ${this.deliveryTimeoutMs} ms for the notice ` +
                `${id}; it stays held while the answer is awaited.`,
        );
        void sending.then(
            (delivery) => this.recordSent(id, claimedAt, delivery),
            async (error: unknown) => {
                this.logger.error(
                    `The notice ${id} was not sent; the next run tries again.`,
                    error instanceof Error ? error.stack : String(error),
                );
                try {
                    await this.notices.release(id, claimedAt);
                } catch (released) {
                    this.logger.error(
                        `The notice ${id} could not be let go; it is tried again once its claim ` +
                            'goes stale.',
                        released instanceof Error ? released.stack : String(released),
                    );
                }
            },
        );
    }

    /**
     * Records a notice the application has sent. It went out whatever happens
     * here, so a failure to record it is not released for another attempt: it
     * is logged, and the run goes on to the next subscriber rather than
     * stopping theirs over one row.
     */
    private async recordSent(
        id: string,
        claimedAt: Date,
        delivery: SubscriptionNoticeDelivery,
    ): Promise<void> {
        try {
            if (!(await this.notices.confirm(id, claimedAt, delivery, new Date()))) {
                this.logger.warn(
                    `The notice ${id} was sent, but its claim had gone stale and another run ` +
                        'took it on; the subscriber may hear of the version twice.',
                );
            }
        } catch (error) {
            this.logger.error(
                `The notice ${id} was sent, but recording it failed; once its claim goes stale ` +
                    'the subscriber may hear of the version again.',
                error instanceof Error ? error.stack : String(error),
            );
        }
    }
}
