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
 * Plattform-Stats für die SuperAdmin-Dashboard-Page.
 *
 * Enthält Subscription-/Promo-/Audit-Aggregate, die in beiden Apps (AutohausPro
 * + vereinsfux) identisch sinnvoll sind. App-spezifische KPIs (AutohausPro-DATEV,
 * vereinsfux-Bundles/Members) bleiben Extra-Endpoints in der jeweiligen App.
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
