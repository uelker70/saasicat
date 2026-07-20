// DI-Tokens für die Admin-Ports.
//
// Konsumenten registrieren Implementierungen über `AdminModule.forRoot` oder
// als Custom-Provider. Die Tokens sind Symbol-basiert und kollisionsfrei.

export const MFA_PORT_TOKEN = Symbol.for('saas-platform/MfaPort');
export const AUDIT_PORT_TOKEN = Symbol.for('saas-platform/AuditPort');
export const RLS_BYPASS_PORT_TOKEN = Symbol.for('saas-platform/RlsBypassPort');
