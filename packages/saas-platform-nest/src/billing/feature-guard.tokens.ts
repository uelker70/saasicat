// FeatureGuard-Konfiguration. Konsumenten registrieren ein Objekt unter
// FEATURE_GUARD_CONFIG_TOKEN, wenn sie:
//   - innerhalb der Limits-Berechnung einen Tenant-Context (RLS) brauchen
//     (z. B. `runWithTenant`),
//   - eine andere User-Rollen-Quelle als `user.role`/`user.platformRole` nutzen,
//   - die `tenantId` aus einem anderen Request-Feld als `request.tenantId` /
//     `request.user.tenantId` lesen wollen.
//
// Ohne Config-Eintrag verhält sich der Guard wie die ursprüngliche app-lokale
// Implementierung — nur ohne RLS-Wrapping. Apps ohne Postgres-RLS brauchen das nicht.

export interface FeatureGuardConfig {
    /**
     * Wrappt `EntitlementService.computeLimits` in einen Tenant-Context.
     * Konsumenten mit RLS übergeben hier `runWithTenant(tenantId, fn)`
     * — damit die Repository-Queries den Tenant in den DB-Session-Variablen
     * sehen. Ohne RLS: Field weglassen, Default ist Identity.
     */
    tenantContextRunner?: <T>(tenantId: string, fn: () => Promise<T>) => Promise<T>;

    /**
     * Liest die Plattform-Rolle aus dem `request.user`-Objekt. Wird für den
     * SUPER_ADMIN-Bypass benutzt — Plattform-Support darf einem Mandanten auch
     * dann helfen, wenn das Feature nicht in dessen Plan ist.
     *
     * Default: `user.role ?? user.platformRole`.
     */
    userRoleResolver?: (user: unknown) => string | undefined;

    /**
     * Liest die `tenantId` aus dem Request. Default:
     * `request.tenantId ?? request.user?.tenantId`.
     */
    tenantIdResolver?: (request: unknown) => string | undefined;
}

export const FEATURE_GUARD_CONFIG_TOKEN = Symbol('FEATURE_GUARD_CONFIG');
