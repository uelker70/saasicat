// AdminModule — DI wrapper around the SuperAdmin building blocks.
//
// Consumers register the three adapters (`MfaPort`, `AuditPort`,
// `RlsBypassPort`) via `AdminModule.forRoot({...})` and get back the
// platform services (`MfaService`, `AdminAuditService`) plus the
// guards/interceptor (`SuperAdminGuard`, `MfaGuard`,
// `AdminBypassRlsInterceptor`) as injectable providers.

import {
    type DynamicModule,
    type ForwardReference,
    Module,
    type Provider,
    type Type,
} from '@nestjs/common';
import type { AuditPort, MfaPort, RlsBypassPort } from '@saasicat/core';
import { asProvider, type ProviderSpec } from '../core/di.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminBypassRlsInterceptor } from './admin-bypass-rls.interceptor.js';
import { MfaService } from './mfa.service.js';
import { MfaGuard } from './mfa.guard.js';
import { SuperAdminGuard } from './super-admin.guard.js';
import { AUDIT_PORT_TOKEN, MFA_PORT_TOKEN, RLS_BYPASS_PORT_TOKEN } from './admin.tokens.js';

export interface AdminModuleOptions {
    mfaPort: ProviderSpec<MfaPort>;
    auditPort: ProviderSpec<AuditPort>;
    rlsBypassPort: ProviderSpec<RlsBypassPort>;
    /** Modules required by adapter factory `inject` tokens. */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    /** Register the module globally — default `false`. */
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
            imports: options.imports ?? [],
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
