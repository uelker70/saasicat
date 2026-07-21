// PlanResolverPort — app adapter that resolves the active `planId` for a
// given `tenantId`. Called by the `StaticEntitlementService` (quickstart
// path) and by the `FeatureGuard`/`EnforceQuotaInterceptor`.
//
// In the quickstart path (without SubscriptionContract) the app implements
// this simply (e.g. a lookup in the `Tenant.planKey` column). In the V3 path
// (with SubscriptionContract) the full `EntitlementService` takes over the
// resolution — the `PlanResolverPort` is then obsolete.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P7+P9.

export const PLAN_RESOLVER_PORT_TOKEN = Symbol.for('saas-platform-nest/PlanResolverPort');

export interface PlanResolverPort {
    /**
     * Returns the tenant's active `planId`. `null` = no plan assigned →
     * the guard / interceptor throws 403 or lets it through, depending on
     * the configuration.
     */
    getPlanIdForTenant(tenantId: string): Promise<string | null>;
}

/**
 * Static fallback: always returns the same plan for all tenants. Useful
 * for local development and for apps that do not yet have a contract concept.
 *
 * The quickstart path uses this implicitly when `adapters.planResolver` is
 * not set and `defaultPlanId` was provided in SaasPlatformModule.forRoot().
 */
export class StaticPlanResolver implements PlanResolverPort {
    constructor(private readonly planId: string) {}
    async getPlanIdForTenant(): Promise<string | null> {
        return this.planId;
    }
}
