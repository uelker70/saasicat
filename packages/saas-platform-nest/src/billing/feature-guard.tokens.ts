// FeatureGuard configuration. Consumers register an object under
// FEATURE_GUARD_CONFIG_TOKEN when they:
//   - need a tenant context (RLS) inside the limits computation
//     (e.g. `runWithTenant`),
//   - use a user-role source other than `user.role`/`user.platformRole`,
//   - want to read the `tenantId` from a request field other than `request.tenantId` /
//     `request.user.tenantId`.
//
// Without a config entry the guard behaves like the original app-local
// implementation — just without RLS wrapping. Apps without Postgres RLS do not need this.

export interface FeatureGuardConfig {
    /**
     * Wraps `EntitlementService.computeLimits` in a tenant context.
     * Consumers with RLS pass `runWithTenant(tenantId, fn)` here
     * — so that the repository queries see the tenant in the DB session
     * variables. Without RLS: omit the field, the default is identity.
     */
    tenantContextRunner?: <T>(tenantId: string, fn: () => Promise<T>) => Promise<T>;

    /**
     * Reads the platform role from the `request.user` object. Used for the
     * SUPER_ADMIN bypass — platform support may help a tenant even
     * when the feature is not in that tenant's plan.
     *
     * Default: `user.role ?? user.platformRole`.
     */
    userRoleResolver?: (user: unknown) => string | undefined;

    /**
     * Reads the `tenantId` from the request. Default:
     * `request.tenantId ?? request.user?.tenantId`.
     */
    tenantIdResolver?: (request: unknown) => string | undefined;
}

export const FEATURE_GUARD_CONFIG_TOKEN = Symbol('FEATURE_GUARD_CONFIG');
