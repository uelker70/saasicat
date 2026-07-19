// DI-Tokens für die AdminStats-Adapter. Konsumenten implementieren die drei
// Ports und reichen sie via `AdminStatsModule.forRoot({...})` durch.

export const SUBSCRIPTION_STATS_PORT_TOKEN = Symbol.for('saas-platform/SubscriptionStatsPort');
export const PROMO_CODE_STATS_PORT_TOKEN = Symbol.for('saas-platform/PromoCodeStatsPort');
export const AUDIT_STATS_PORT_TOKEN = Symbol.for('saas-platform/AuditStatsPort');

/** Default-Audit-Window in Tagen für die Dashboard-KPI. Override per forRoot. */
export const ADMIN_STATS_AUDIT_WINDOW_DAYS_TOKEN = Symbol.for(
    'saas-platform/AdminStatsAuditWindowDays',
);
