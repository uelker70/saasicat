// CliContextModule — DI-Wrapper für CliContextService.
//
// Konsumenten registrieren ihre `UserPort`-Adapter + Konfiguration via
// `CliContextModule.forRoot({...})`. Voraussetzung: das `AdminModule.forRoot`
// (aus saas-platform-nest) ist bereits importiert — `MfaService` und
// `AdminAuditService` werden via Plattform-DI bereitgestellt.

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
     * Optional: Audit-Query-Port für `AuditTailFlow`. Wenn nicht gesetzt,
     * lehnt `AuditTailFlow` mit DI-Fehler ab — `<app> audit tail` ist
     * dann nicht verfügbar.
     */
    auditQueryPort?: ProviderSpec<AuditQueryPort>;
    /**
     * Optional: Liste von DoctorChecks für `DoctorFlow`. Default: leer
     * — `<app> doctor` läuft, liefert aber keinen Inhalt. Konsumenten
     * registrieren projektspezifische Checks.
     *
     * Hinweis: Wenn `defaultDoctorChecks: true`, werden die 4 Plattform-
     * Standard-Checks (PlanCatalog/Discovery/UserPort/AdminManifest)
     * **zusätzlich** zu dieser Liste registriert.
     */
    doctorChecks?: ProviderSpec<DoctorCheck[]>;
    /**
     * Default `false`. Wenn `true`, registriert die Plattform die vier
     * Standard-Checks aus `PLATFORM_DOCTOR_CHECK_PROVIDERS` zusätzlich zu
     * `doctorChecks`. Empfohlen für alle Apps, die `<app> doctor` ernst nehmen.
     */
    defaultDoctorChecks?: boolean;
    /**
     * Optional: ManifestAccessPort für `<app> manifest dump|hash|check|...`.
     * Wenn nicht gesetzt, ist `ManifestCliFlow` nicht registriert.
     */
    manifestAccessPort?: ProviderSpec<ManifestAccessPort>;
    /**
     * Optional: vollständige ManifestChecks-Liste. Default sind die 10
     * `DEFAULT_MANIFEST_CHECKS`. Konsument-Erweiterungen sollten
     * `[...DEFAULT_MANIFEST_CHECKS, ...projectSpecific]` durchreichen.
     */
    manifestChecks?: ProviderSpec<ManifestCheck[]>;
    /**
     * Optional: UserManagementPort für das geteilte `<app> user`-Command
     * (create-super-admin/reassign-admin/list/reset-password/deactivate).
     * Ohne diesen Port kann `UserCommands` nicht aufgelöst werden — registriere
     * das Command nur, wenn dieser Port gesetzt ist.
     */
    userManagementPort?: ProviderSpec<UserManagementPort>;
    /** Modul global registrieren — Default `false`. */
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
        // DoctorFlow wird immer registriert; bei fehlendem checks-Provider
        // läuft er mit leerer Liste durch (sinnvoller Default als hard error).
        // Default-Plattform-Checks sind opt-in (Apps ohne Discovery-Snapshot
        // oder ohne UserPort sollen nicht mit „missing dependency" abbrechen).
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

        // Geteiltes `<app> user`-Command: nur verfügbar, wenn der Konsument den
        // UserManagementPort liefert. Token wird exportiert, damit das in der
        // Konsumenten-Module registrierte `UserCommands` es injizieren kann.
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
