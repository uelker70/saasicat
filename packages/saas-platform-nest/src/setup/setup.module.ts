// SetupModule — first-run SuperAdmin bootstrap via the admin UI.
//
// Precondition: `AdminModule.forRoot(...)` is imported in the same app scope
// (global) so that `MfaService` is injectable for MFA enrollment.
//
// The consumer provides its `UserManagementPort` adapter (the same one used for
// the `<app> user` CLI) and optionally an env-var name + issuer.

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
     * App adapter for the existence check + creation of the first SUPER_ADMIN. A
     * full `UserManagementPort` adapter (CLI) satisfies this contract as well, so
     * it can be reused.
     */
    provisioningPort: ProviderSpec<SuperAdminProvisioningPort>;
    /** Env-var name of the setup token. Default `SETUP_TOKEN`. */
    setupTokenEnvVar?: string;
    /** Authenticator issuer for MFA enrollment. Default `SuperAdmin`. */
    mfaIssuer?: string;
    /** Register the module globally — default `false`. */
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
