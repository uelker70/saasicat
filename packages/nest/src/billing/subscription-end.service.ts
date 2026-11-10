// A subscription that ended is recorded once, with the day its tenant's data
// is deleted on, and its tenant is held to reading until then (`SC-CANC-027`,
// `SC-ADM-052`).
//
// Nothing marks the moment a cancellation lands: the subscription keeps its
// row, and "ended" is read off its dates wherever it is asked. So a run looks
// for it. Every quarter hour it reads the subscriptions a cancellation was
// declared for, in every tenant, and records an end for each one that has
// landed and has none yet — whichever path declared it: the tenant's own
// cancellation, one the application declared for a trial that ran out, or the
// operator's own path in the application.
//
// The deletion day is fixed when the end is recorded and never moves. It is
// counted from the day the subscription ended, or from the day the end is
// recorded where the run learns of it later, so nobody is given less than the
// read-only period's notice.
//
// Platform-wide: the subscriptions are read across tenants, through
// `RlsBypassPort`.

import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import {
    deletionDayOf,
    installationZoneOf,
    type CancelledSubscription,
    type EndOfSubscriptionSettings,
    type PlanCatalogSettings,
    type RlsBypassPort,
    type SubscriptionEndPort,
    type SubscriptionUsagePort,
    type TenantAccessHoldPort,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { platformJobActor } from '../admin/admin-audit.service.js';
import { readAcrossTenants } from '../admin/read-across-tenants.js';
import { actorTagOf } from '../core/web-audit.js';
import { cancellationLandsAt } from '../entitlement/landed-cancellation.js';
import { TENANT_ACCESS_HOLDS_TOKEN } from '../tenant-access/tenant-access.tokens.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from './plan-catalog.module.js';
import {
    END_OF_SUBSCRIPTION_TOKEN,
    SUBSCRIPTION_END_PORT_TOKEN,
    SUBSCRIPTION_USAGE_PORT_TOKEN,
} from './tenant-billing.tokens.js';

/** Who records the ends, as the audit log tags a run. */
const SUBSCRIPTION_END_RUN = actorTagOf(platformJobActor('subscription-ends'));

/** What one run recorded. */
export interface SubscriptionEndRun {
    /** Subscriptions recorded as ended, each with its deletion day. */
    ended: number;
}

@Injectable()
export class SubscriptionEndService implements OnModuleInit {
    private listCancelled: (() => Promise<CancelledSubscription[]>) | null = null;

    constructor(
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
        @Inject(SUBSCRIPTION_END_PORT_TOKEN) private readonly ends: SubscriptionEndPort,
        @Inject(END_OF_SUBSCRIPTION_TOKEN) private readonly period: EndOfSubscriptionSettings,
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: Pick<PlanCatalogSettings, 'timeZone'>,
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
        // Absent only where tenant billing is wired by hand without
        // `SaaSiCatModule`: nothing keeps the reasons then, and nothing
        // enforces them, so the end is recorded without one.
        @Optional()
        @Inject(TENANT_ACCESS_HOLDS_TOKEN)
        private readonly holds: TenantAccessHoldPort | null = null,
    ) {}

    /**
     * Refuses a port that cannot list the cancelled subscriptions: an end
     * nobody can find is never recorded, and its tenant is never told when its
     * data goes.
     */
    onModuleInit(): void {
        const listCancelled = this.subscriptions.listCancelled?.bind(this.subscriptions);
        if (!listCancelled) {
            throw new Error(
                'The SubscriptionUsagePort has no `listCancelled`: the platform cannot find the ' +
                    'subscriptions that ended, so it can record no deletion day. Both shipped ' +
                    'adapters have it; a port of your own adds it (SC-CANC-027).',
            );
        }
        this.listCancelled = listCancelled;
    }

    /**
     * Records an end, with its deletion day, for every subscription whose
     * cancellation has landed by `now` and that has none yet, and holds its
     * tenant to reading from the moment it ended.
     */
    async recordEnded(now: Date): Promise<SubscriptionEndRun> {
        const listCancelled = this.listCancelled;
        if (!listCancelled) return { ended: 0 };
        return readAcrossTenants(this.rlsBypass, async () => {
            const landed = (await listCancelled()).flatMap((subscription) => {
                const endsAt = cancellationLandsAt(subscription);
                return endsAt !== null && endsAt <= now ? [{ ...subscription, endsAt }] : [];
            });
            if (landed.length === 0) return { ended: 0 };
            const recorded = new Set(
                (await this.ends.listFor(landed.map((sub) => sub.subscriptionId))).map(
                    (end) => end.subscriptionId,
                ),
            );
            const timeZone = installationZoneOf(this.settings);
            let ended = 0;
            for (const subscription of landed) {
                if (recorded.has(subscription.subscriptionId)) continue;
                // The reason first: a run that stops between the two finds no
                // end next time and records both again, where the store answers
                // the reason already open with null. In the other order a run
                // that stopped would leave an end whose tenant nothing holds.
                await this.holds?.record({
                    tenantId: subscription.tenantId,
                    kind: 'ended',
                    reference: subscription.subscriptionId,
                    note: null,
                    since: subscription.endsAt,
                    recordedBy: SUBSCRIPTION_END_RUN,
                });
                // Another instance running at the same moment may record the
                // end first; the store answers null then, and it is not counted.
                const end = await this.ends.record({
                    tenantId: subscription.tenantId,
                    subscriptionId: subscription.subscriptionId,
                    endsAt: subscription.endsAt,
                    deletesOn: deletionDayOf(
                        subscription.endsAt,
                        now,
                        this.period.readOnlyDays,
                        timeZone,
                    ),
                    recordedAt: now,
                    recordedBy: SUBSCRIPTION_END_RUN,
                });
                if (end) ended += 1;
            }
            return { ended };
        });
    }
}
