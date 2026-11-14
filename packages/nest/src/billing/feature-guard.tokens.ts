// FeatureGuard configuration. Consumers register an object under
// FEATURE_GUARD_CONFIG_TOKEN when they:
//   - need a tenant context (RLS) inside the limits computation where no
//     `RlsBypassPort` is in scope (e.g. `runWithTenant`),
//   - use a user-role source other than `user.role`/`user.platformRole`,
//   - want to read the `tenantId` from a request field other than `request.tenantId` /
//     `request.user.tenantId`.
//
// Without a config entry the guard asks `EntitlementService` as it stands,
// which reads through the bypass where one is in scope.

export interface FeatureGuardConfig {
    /**
     * Wraps `EntitlementService.computeLimits` in a tenant context, such as
     * `runWithTenant(tenantId, fn)`. Where an `RlsBypassPort` is in scope —
     * `SaaSiCatModule` provides it — `computeLimits` reads the tenant's
     * subscription through it, by the tenant asked about, whatever frame it
     * runs in (`SC-SEC-020`), so the platform's reads need no runner. One
     * still serves where no bypass is in scope, or where the bound port only
     * calls through while a policy guards the tables. Without row-level
     * security: omit the field, the default is identity.
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

export const FEATURE_GUARD_CONFIG_TOKEN = Symbol.for('saasicat/nest/FeatureGuardConfig');
