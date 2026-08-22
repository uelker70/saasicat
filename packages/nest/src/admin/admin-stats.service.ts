import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
    AuditStatsPort,
    AuditStatsSnapshot,
    PromoCodeStatsPort,
    PromoCodeStatsSnapshot,
    SubscriptionStatsPort,
    SubscriptionStatsSnapshot,
} from '@saasicat/types';
import {
    ADMIN_STATS_AUDIT_WINDOW_DAYS_TOKEN,
    AUDIT_STATS_PORT_TOKEN,
    PROMO_CODE_STATS_PORT_TOKEN,
    SUBSCRIPTION_STATS_PORT_TOKEN,
} from './admin-stats.tokens.js';

const DAY_MS = 86_400_000;
const DEFAULT_AUDIT_WINDOW_DAYS = 7;

/**
 * Platform stats for the SuperAdmin dashboard page.
 *
 * Contains subscription/promo/audit aggregates that are equally meaningful
 * across all consuming apps. App-specific KPIs (e.g. DATEV or Bundles/Members)
 * remain extra endpoints in the respective app.
 */
export interface AdminStatsSnapshot {
    subscriptions: SubscriptionStatsSnapshot;
    promos: PromoCodeStatsSnapshot;
    audit: AuditStatsSnapshot;
}

@Injectable()
export class AdminStatsService {
    constructor(
        @Inject(SUBSCRIPTION_STATS_PORT_TOKEN)
        private readonly subscriptions: SubscriptionStatsPort,
        @Inject(PROMO_CODE_STATS_PORT_TOKEN)
        private readonly promos: PromoCodeStatsPort,
        @Inject(AUDIT_STATS_PORT_TOKEN)
        private readonly audit: AuditStatsPort,
        @Optional()
        @Inject(ADMIN_STATS_AUDIT_WINDOW_DAYS_TOKEN)
        private readonly auditWindowDays: number = DEFAULT_AUDIT_WINDOW_DAYS,
    ) {}

    async getSnapshot(): Promise<AdminStatsSnapshot> {
        const since = new Date(Date.now() - this.auditWindowDays * DAY_MS);
        const [subscriptions, promos, auditCount] = await Promise.all([
            this.subscriptions.getStats(),
            this.promos.getStats(),
            this.audit.countSince(since),
        ]);
        return {
            subscriptions,
            promos,
            audit: {
                countLastNDays: auditCount,
                nDays: this.auditWindowDays,
            },
        };
    }
}
