// @saasicat/nest/admin — SuperAdmin building blocks.
//
// Contents:
//   - tokens:               MFA_PORT_TOKEN, AUDIT_PORT_TOKEN, RLS_BYPASS_PORT_TOKEN
//   - super-admin.guard:    SuperAdminGuard (role === 'SUPER_ADMIN')
//   - mfa.guard:            MfaGuard + RequireMfa() decorator + REQUIRE_MFA_KEY
//   - mfa:                  MfaService (TOTP setup/verify via MfaPort)
//   - admin-audit.service:  AdminAuditService (via AuditPort)
//   - admin-bypass-rls.interceptor: AdminBypassRlsInterceptor (via RlsBypassPort)
//   - module:               AdminModule.forRoot({ mfaPort, auditPort, rlsBypassPort })
//
// `AdminManifestController` is NOT exported — the controller is generated
// dynamically at boot time in `AdminManifestModule.forRoot({ guards, reloadGuards })`.
// This prevents consumers from accidentally registering an auth-free variant
// in their own modules.

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
