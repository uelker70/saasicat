// PlanResolverPort — App-Adapter, der zu einer `tenantId` den aktiven
// `planId` liefert. Wird vom `StaticEntitlementService` (Quickstart-Pfad)
// und vom `FeatureGuard`/`EnforceQuotaInterceptor` aufgerufen.
//
// Im Quickstart-Pfad (ohne SubscriptionContract) implementiert die App
// das einfach (z. B. Lookup in `Tenant.planKey`-Spalte). Im V3-Pfad
// (mit SubscriptionContract) übernimmt der volle `EntitlementService`
// die Auflösung — der `PlanResolverPort` ist dann obsolet.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P7+P9.

export const PLAN_RESOLVER_PORT_TOKEN = Symbol.for('saas-platform-nest/PlanResolverPort');

export interface PlanResolverPort {
    /**
     * Liefert den aktiven `planId` des Tenants. `null` = kein Plan
     * zugeordnet → der Guard / Interceptor wirft 403 oder lässt durch,
     * je nach Konfiguration.
     */
    getPlanIdForTenant(tenantId: string): Promise<string | null>;
}

/**
 * Static-Fallback: liefert immer denselben Plan für alle Tenants. Nützlich
 * für lokale Entwicklung und für Apps, die noch kein Vertrag-Konzept haben.
 *
 * Quickstart-Pfad nutzt das implizit, wenn `adapters.planResolver` nicht
 * gesetzt ist und `defaultPlanId` im SaasPlatformModule.forRoot()
 * angegeben wurde.
 */
export class StaticPlanResolver implements PlanResolverPort {
    constructor(private readonly planId: string) {}
    async getPlanIdForTenant(): Promise<string | null> {
        return this.planId;
    }
}
