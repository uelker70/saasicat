// DI tokens for the admin ports.
//
// Consumers register implementations via `AdminModule.forRoot` or as custom
// providers. The tokens are Symbol-based and collision-free.

export const MFA_PORT_TOKEN = Symbol.for('saas-platform/MfaPort');
export const AUDIT_PORT_TOKEN = Symbol.for('saas-platform/AuditPort');
export const RLS_BYPASS_PORT_TOKEN = Symbol.for('saas-platform/RlsBypassPort');
