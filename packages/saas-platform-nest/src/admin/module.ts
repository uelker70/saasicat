// AdminModule — DI-Wrapper um die SuperAdmin-Bausteine.
//
// Konsumenten registrieren die drei Adapter (`MfaPort`, `AuditPort`,
// `RlsBypassPort`) über `AdminModule.forRoot({...})` und bekommen die
// Plattform-Services (`MfaService`, `AdminAuditService`) plus die
// Guards/Interceptor (`SuperAdminGuard`, `MfaGuard`,
// `AdminBypassRlsInterceptor`) als injectable Provider zurück.

import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import type { AuditPort, MfaPort, RlsBypassPort } from '@saasicat/types';
import { asProvider, type ProviderSpec } from '../core/di.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminBypassRlsInterceptor } from './admin-bypass-rls.interceptor.js';
import { MfaService } from './mfa.js';
import { MfaGuard } from './mfa.guard.js';
import { SuperAdminGuard } from './super-admin.guard.js';
import { AUDIT_PORT_TOKEN, MFA_PORT_TOKEN, RLS_BYPASS_PORT_TOKEN } from './tokens.js';

export interface AdminModuleOptions {
    mfaPort: ProviderSpec<MfaPort>;
    auditPort: ProviderSpec<AuditPort>;
    rlsBypassPort: ProviderSpec<RlsBypassPort>;
    /** Modul global registrieren — Default `false`. */
    global?: boolean;
}

@Module({})
export class AdminModule {
    static forRoot(options: AdminModuleOptions): DynamicModule {
        const providers: Provider[] = [
            asProvider(MFA_PORT_TOKEN, options.mfaPort),
            asProvider(AUDIT_PORT_TOKEN, options.auditPort),
            asProvider(RLS_BYPASS_PORT_TOKEN, options.rlsBypassPort),
            MfaService,
            AdminAuditService,
            SuperAdminGuard,
            MfaGuard,
            AdminBypassRlsInterceptor,
        ];

        return {
            module: AdminModule,
            global: options.global ?? false,
            providers,
            exports: [
                MFA_PORT_TOKEN,
                AUDIT_PORT_TOKEN,
                RLS_BYPASS_PORT_TOKEN,
                MfaService,
                AdminAuditService,
                SuperAdminGuard,
                MfaGuard,
                AdminBypassRlsInterceptor,
            ],
        };
    }
}
