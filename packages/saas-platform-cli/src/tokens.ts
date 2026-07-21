// DI tokens for the CliContextService.
//
// Consumers register their `UserPort` implementation + their
// `CliContextConfig` (env-var names, production detection) via
// `CliContextModule.forRoot({...})`.

export const CLI_CONTEXT_CONFIG_TOKEN = Symbol.for('saas-platform-cli/Config');
export const USER_PORT_TOKEN = Symbol.for('saas-platform-cli/UserPort');
/** Write/list operations for the shared `<app> user` command. */
export const USER_MANAGEMENT_PORT_TOKEN = Symbol.for('saas-platform-cli/UserManagementPort');
export const AUDIT_QUERY_PORT_TOKEN = Symbol.for('saas-platform-cli/AuditQueryPort');
/** List of DoctorCheck implementations — consumers may extend. */
export const DOCTOR_CHECKS_TOKEN = Symbol.for('saas-platform-cli/DoctorChecks');
export const MANIFEST_ACCESS_PORT_TOKEN = Symbol.for('saas-platform-cli/ManifestAccessPort');
/** List of ManifestCheck implementations — consumers may extend. */
export const MANIFEST_CHECKS_TOKEN = Symbol.for('saas-platform-cli/ManifestChecks');
