// CliContextModule — DI wrapper for CliContextService.
//
// Consumers register their `UserPort` adapters + configuration via
// `CliContextModule.forRoot({...})`. Prerequisite: `AdminModule.forRoot`
// (from saas-platform-nest) is already imported — `MfaService` and
// `AdminAuditService` are provided via platform DI.

import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { asProvider, type ProviderSpec } from '@saasicat/nest';
import type {
    AuditQueryPort,
    ManifestAccessPort,
    UserManagementPort,
    UserPort,
} from '@saasicat/types';
import { AuditTailFlow } from './audit-tail-flow.js';
import { CliContextService, type CliContextConfig } from './cli-context.service.js';
import { PLATFORM_DOCTOR_CHECK_PROVIDERS } from './default-doctor-checks.js';
import { type DoctorCheck, DoctorFlow } from './doctor-flow.js';
import { ManifestCliFlow } from './manifest-cli-flow.js';
import { DEFAULT_MANIFEST_CHECKS, type ManifestCheck } from './manifest-checks.js';
import { MfaSetupFlow } from './mfa-setup-flow.js';
import {
    AUDIT_QUERY_PORT_TOKEN,
    CLI_CONTEXT_CONFIG_TOKEN,
    DOCTOR_CHECKS_TOKEN,
    MANIFEST_ACCESS_PORT_TOKEN,
    MANIFEST_CHECKS_TOKEN,
    USER_MANAGEMENT_PORT_TOKEN,
    USER_PORT_TOKEN,
} from './tokens.js';
import { WhoAmIFlow } from './whoami-flow.js';

export interface CliContextModuleOptions {
    config: CliContextConfig;
    userPort: ProviderSpec<UserPort>;
    /**
     * Optional: audit query port for `AuditTailFlow`. If not set,
     * `AuditTailFlow` rejects with a DI error — `<app> audit tail` is then
     * not available.
     */
    auditQueryPort?: ProviderSpec<AuditQueryPort>;
    /**
     * Optional: list of DoctorChecks for `DoctorFlow`. Default: empty
     * — `<app> doctor` runs but returns no content. Consumers register
     * project-specific checks.
     *
     * Note: if `defaultDoctorChecks: true`, the 4 platform standard checks
     * (PlanCatalog/Discovery/UserPort/AdminManifest) are registered **in
     * addition** to this list.
     */
    doctorChecks?: ProviderSpec<DoctorCheck[]>;
    /**
     * Default `false`. If `true`, the platform registers the four standard
     * checks from `PLATFORM_DOCTOR_CHECK_PROVIDERS` in addition to
     * `doctorChecks`. Recommended for all apps that take `<app> doctor` seriously.
     */
    defaultDoctorChecks?: boolean;
    /**
     * Optional: ManifestAccessPort for `<app> manifest dump|hash|check|...`.
     * If not set, `ManifestCliFlow` is not registered.
     */
    manifestAccessPort?: ProviderSpec<ManifestAccessPort>;
    /**
     * Optional: full ManifestChecks list. Default is the 10
     * `DEFAULT_MANIFEST_CHECKS`. Consumer extensions should pass through
     * `[...DEFAULT_MANIFEST_CHECKS, ...projectSpecific]`.
     */
    manifestChecks?: ProviderSpec<ManifestCheck[]>;
    /**
     * Optional: UserManagementPort for the shared `<app> user` command
     * (create-super-admin/reassign-admin/list/reset-password/deactivate).
     * Without this port `UserCommands` cannot be resolved — register the
     * command only if this port is set.
     */
    userManagementPort?: ProviderSpec<UserManagementPort>;
    /** Register the module globally — default `false`. */
    global?: boolean;
}

@Module({})
export class CliContextModule {
    static forRoot(options: CliContextModuleOptions): DynamicModule {
        const providers: Provider[] = [
            { provide: CLI_CONTEXT_CONFIG_TOKEN, useValue: options.config },
            asProvider(USER_PORT_TOKEN, options.userPort),
            CliContextService,
            MfaSetupFlow,
            WhoAmIFlow,
        ];
        const exports_: NonNullable<DynamicModule['exports']> = [
            CLI_CONTEXT_CONFIG_TOKEN,
            CliContextService,
            MfaSetupFlow,
            WhoAmIFlow,
        ];
        if (options.auditQueryPort) {
            providers.push(asProvider(AUDIT_QUERY_PORT_TOKEN, options.auditQueryPort));
            providers.push(AuditTailFlow);
            exports_.push(AuditTailFlow);
        }
        // DoctorFlow is always registered; with a missing checks provider
        // it runs with an empty list (a sensible default over a hard error).
        // Default platform checks are opt-in (apps without a discovery snapshot
        // or without a UserPort should not abort with "missing dependency").
        if (options.defaultDoctorChecks) {
            providers.push(...PLATFORM_DOCTOR_CHECK_PROVIDERS);
            providers.push({
                provide: DOCTOR_CHECKS_TOKEN,
                useFactory: (...platformChecks: DoctorCheck[]) => {
                    const extra = Array.isArray(options.doctorChecks)
                        ? (options.doctorChecks as DoctorCheck[])
                        : [];
                    return [...platformChecks, ...extra];
                },
                inject: PLATFORM_DOCTOR_CHECK_PROVIDERS,
            });
        } else {
            providers.push(asProvider(DOCTOR_CHECKS_TOKEN, options.doctorChecks ?? []));
        }
        providers.push(DoctorFlow);
        exports_.push(DoctorFlow);

        if (options.manifestAccessPort) {
            providers.push(
                asProvider(MANIFEST_ACCESS_PORT_TOKEN, options.manifestAccessPort),
                asProvider(
                    MANIFEST_CHECKS_TOKEN,
                    options.manifestChecks ?? DEFAULT_MANIFEST_CHECKS,
                ),
                ManifestCliFlow,
            );
            exports_.push(ManifestCliFlow);
        }

        // Shared `<app> user` command: only available if the consumer provides
        // the UserManagementPort. The token is exported so that the
        // `UserCommands` registered in the consumer module can inject it.
        if (options.userManagementPort) {
            providers.push(asProvider(USER_MANAGEMENT_PORT_TOKEN, options.userManagementPort));
            exports_.push(USER_MANAGEMENT_PORT_TOKEN);
        }

        return {
            module: CliContextModule,
            global: options.global ?? false,
            providers,
            exports: exports_,
        };
    }
}
