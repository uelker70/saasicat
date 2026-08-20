// @saasicat/cli — cross-cutting helpers for consumer CLIs.
//
// Spec: packages/saas-platform-spec/cli-conventions.md.
//
// Contents:
//   - tokens:              CLI_CONTEXT_CONFIG_TOKEN, USER_PORT_TOKEN,
//                          AUDIT_QUERY_PORT_TOKEN, DOCTOR_CHECKS_TOKEN,
//                          MANIFEST_ACCESS_PORT_TOKEN, MANIFEST_CHECKS_TOKEN
//   - cli-context.service: CliContextService (Identity/MFA/Confirm/Audit) + CliError
//   - mfa-setup-flow:      MfaSetupFlow for `<app> admin mfa-setup`
//   - whoami-flow:         WhoAmIFlow for `<app> admin whoami`
//   - audit-tail-flow:     AuditTailFlow for `<app> audit tail`
//   - doctor-flow:         DoctorFlow + DoctorCheck interface
//   - manifest-cli-flow:   ManifestCliFlow + ManifestCheck interface
//   - manifest-checks:     DEFAULT_MANIFEST_CHECKS (10 platform defaults)
//   - migration-constraints: where the non-DSL constraints go in a migration
//   - fk-pointers:         enabling the FK relations to the app's own models
//   - init/plan:           what `saasicat init` writes, as data
//   - init/catalog-keys:   the key rules, read off the catalogue schema
//   - init/patch-app-module: adding the platform to an existing AppModule
//   - module:              CliContextModule.forRoot({config, userPort, …})

export * from './tokens.js';
export * from './cli-context.service.js';
export * from './mfa-setup-flow.js';
export * from './whoami-flow.js';
export * from './audit-tail-flow.js';
export * from './doctor-flow.js';
export * from './manifest-checks.js';
export * from './manifest-cli-flow.js';
export * from './default-doctor-checks.js';
export * from './prisma-blocks.js';
export * from './schema-apply.js';
export * from './schema-check.js';
export * from './migration-constraints.js';
export * from './fk-pointers.js';
export * from './init/plan.js';
export * from './init/catalog-keys.js';
export * from './init/patch-app-module.js';
export * from './module.js';
export * from './manifest.command.js';
export * from './admin.command.js';
export * from './audit.command.js';
export * from './doctor.command.js';
export * from './discovery.command.js';
export * from './user.command.js';
