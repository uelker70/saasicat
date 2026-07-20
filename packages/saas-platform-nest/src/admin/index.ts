// @saasicat/nest/admin — SuperAdmin-Bausteine.
//
// Inhalte:
//   - tokens:               MFA_PORT_TOKEN, AUDIT_PORT_TOKEN, RLS_BYPASS_PORT_TOKEN
//   - super-admin.guard:    SuperAdminGuard (role === 'SUPER_ADMIN')
//   - mfa.guard:            MfaGuard + RequireMfa() Decorator + REQUIRE_MFA_KEY
//   - mfa:                  MfaService (TOTP-Setup/Verify via MfaPort)
//   - admin-audit.service:  AdminAuditService (via AuditPort)
//   - admin-bypass-rls.interceptor: AdminBypassRlsInterceptor (via RlsBypassPort)
//   - module:               AdminModule.forRoot({ mfaPort, auditPort, rlsBypassPort })
//
// `AdminManifestController` ist NICHT exportiert — der Controller wird zur
// Boot-Zeit im `AdminManifestModule.forRoot({ guards, reloadGuards })`
// dynamisch generiert. Das verhindert, dass Konsumenten versehentlich eine
// auth-freie Variante in eigenen Modulen registrieren.

export * from './tokens.js';
export * from './super-admin.guard.js';
export * from './mfa.guard.js';
export * from './mfa.js';
export * from './admin-audit.service.js';
export * from './admin-bypass-rls.interceptor.js';
export * from './module.js';
export * from './admin-manifest.config.js';
export * from './admin-manifest.service.js';
export * from './admin-public-boot.controller.js';
export * from './admin-manifest.module.js';
export * from './manifest-core.js';
export * from './admin-stats.tokens.js';
export * from './admin-stats.service.js';
export * from './admin-stats.controller.js';
export * from './admin-stats.module.js';
