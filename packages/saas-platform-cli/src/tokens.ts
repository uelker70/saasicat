// DI-Tokens für den CliContextService.
//
// Konsumenten registrieren ihre `UserPort`-Implementation + ihre
// `CliContextConfig` (Env-Var-Namen, Production-Detection) über
// `CliContextModule.forRoot({...})`.

export const CLI_CONTEXT_CONFIG_TOKEN = Symbol.for('saas-platform-cli/Config');
export const USER_PORT_TOKEN = Symbol.for('saas-platform-cli/UserPort');
/** Schreib-/Listen-Operationen für das geteilte `<app> user`-Command. */
export const USER_MANAGEMENT_PORT_TOKEN = Symbol.for('saas-platform-cli/UserManagementPort');
export const AUDIT_QUERY_PORT_TOKEN = Symbol.for('saas-platform-cli/AuditQueryPort');
/** Liste von DoctorCheck-Implementierungen — Konsumenten dürfen erweitern. */
export const DOCTOR_CHECKS_TOKEN = Symbol.for('saas-platform-cli/DoctorChecks');
export const MANIFEST_ACCESS_PORT_TOKEN = Symbol.for('saas-platform-cli/ManifestAccessPort');
/** Liste von ManifestCheck-Implementierungen — Konsumenten dürfen erweitern. */
export const MANIFEST_CHECKS_TOKEN = Symbol.for('saas-platform-cli/ManifestChecks');
