// DI tokens for the AdminStats adapters. Consumers implement the three
// ports and pass them through via `AdminStatsModule.forRoot({...})`.

export const SUBSCRIPTION_STATS_PORT_TOKEN = Symbol.for('saasicat/nest/SubscriptionStatsPort');
export const PROMO_CODE_STATS_PORT_TOKEN = Symbol.for('saasicat/nest/PromoCodeStatsPort');
export const AUDIT_STATS_PORT_TOKEN = Symbol.for('saasicat/nest/AuditStatsPort');

/** Default audit window in days for the dashboard KPI. Override via forRoot. */
export const ADMIN_STATS_AUDIT_WINDOW_DAYS_TOKEN = Symbol.for(
    'saasicat/nest/AdminStatsAuditWindowDays',
);
