// SetupModule — First-Run-SuperAdmin-Bootstrap übers Admin-UI.
//
// Voraussetzung: `AdminModule.forRoot(...)` ist im selben App-Scope importiert
// (global), damit `MfaService` für das MFA-Enrollment injizierbar ist.
//
// Konsument liefert seinen `UserManagementPort`-Adapter (derselbe wie fürs
// `<app> user`-CLI) und optional Env-Var-Name + Issuer.

import { type DynamicModule, Module } from '@nestjs/common';
import type { SuperAdminProvisioningPort } from '@saasicat/types';

import { asProvider, type ProviderSpec } from '../core/di.js';
import { SetupController } from './setup.controller.js';
import { SetupService } from './setup.service.js';
import { SETUP_CONFIG_TOKEN, SETUP_PROVISIONING_PORT_TOKEN } from './tokens.js';

const DEFAULT_SETUP_TOKEN_ENV_VAR = 'SETUP_TOKEN';
const DEFAULT_MFA_ISSUER = 'SuperAdmin';

export interface SetupModuleOptions {
    /**
     * App-Adapter für Existenz-Check + Anlage des ersten SUPER_ADMIN. Ein voller
     * `UserManagementPort`-Adapter (CLI) erfüllt diesen Vertrag ebenfalls, kann
     * also wiederverwendet werden.
     */
    provisioningPort: ProviderSpec<SuperAdminProvisioningPort>;
    /** Env-Var-Name des Setup-Tokens. Default `SETUP_TOKEN`. */
    setupTokenEnvVar?: string;
    /** Authenticator-Issuer für das MFA-Enrollment. Default `SuperAdmin`. */
    mfaIssuer?: string;
    /** Modul global registrieren — Default `false`. */
    global?: boolean;
}

@Module({})
export class SetupModule {
    static forRoot(options: SetupModuleOptions): DynamicModule {
        return {
            module: SetupModule,
            global: options.global ?? false,
            controllers: [SetupController],
            providers: [
                asProvider(SETUP_PROVISIONING_PORT_TOKEN, options.provisioningPort),
                {
                    provide: SETUP_CONFIG_TOKEN,
                    useValue: {
                        setupTokenEnvVar: options.setupTokenEnvVar ?? DEFAULT_SETUP_TOKEN_ENV_VAR,
                        mfaIssuer: options.mfaIssuer ?? DEFAULT_MFA_ISSUER,
                    },
                },
                SetupService,
            ],
            exports: [SetupService],
        };
    }
}
