import {
    type DynamicModule,
    type ForwardReference,
    Module,
    type Provider,
    type Type,
} from '@nestjs/common';
import type {
    AuditStatsPort,
    PromoCodeStatsPort,
    SubscriptionStatsPort,
} from '@saasicat/types';
import { asProvider, type ProviderSpec } from '../core/di.js';
import { AdminStatsController } from './admin-stats.controller.js';
import { AdminStatsService } from './admin-stats.service.js';
import { SuperAdminGuard } from './super-admin.guard.js';
import {
    ADMIN_STATS_AUDIT_WINDOW_DAYS_TOKEN,
    AUDIT_STATS_PORT_TOKEN,
    PROMO_CODE_STATS_PORT_TOKEN,
    SUBSCRIPTION_STATS_PORT_TOKEN,
} from './admin-stats.tokens.js';

// AdminStatsModule — registers `GET /admin/stats/dashboard` with the three
// app adapters. Consumers implement `SubscriptionStatsPort`,
// `PromoCodeStatsPort`, `AuditStatsPort` and pass them through via forRoot.
//
// Prerequisite: `SuperAdminGuard` is available in the DI scope — either
// through `AdminModule.forRoot({...})` (which exports it as a provider) or
// by registering the provider directly in the app.

export interface AdminStatsModuleOptions {
    subscriptionStatsPort: ProviderSpec<SubscriptionStatsPort>;
    promoCodeStatsPort: ProviderSpec<PromoCodeStatsPort>;
    auditStatsPort: ProviderSpec<AuditStatsPort>;
    /** Audit window in days for the "last N days" KPI. Default 7. */
    auditWindowDays?: number;
    /**
     * Modules whose providers must be visible in the DI scope of this
     * DynamicModule — e.g. the app module that registers the adapter classes
     * referenced by the factory `inject` lists.
     */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    /** Additional providers registered in the DynamicModule itself. */
    extraProviders?: Provider[];
    /** Register the module globally — default `false`. */
    global?: boolean;
}

@Module({})
export class AdminStatsModule {
    static forRoot(options: AdminStatsModuleOptions): DynamicModule {
        const providers: Provider[] = [
            asProvider(SUBSCRIPTION_STATS_PORT_TOKEN, options.subscriptionStatsPort),
            asProvider(PROMO_CODE_STATS_PORT_TOKEN, options.promoCodeStatsPort),
            asProvider(AUDIT_STATS_PORT_TOKEN, options.auditStatsPort),
            AdminStatsService,
            SuperAdminGuard,
        ];
        if (options.auditWindowDays !== undefined) {
            providers.push({
                provide: ADMIN_STATS_AUDIT_WINDOW_DAYS_TOKEN,
                useValue: options.auditWindowDays,
            });
        }
        if (options.extraProviders) providers.push(...options.extraProviders);
        return {
            module: AdminStatsModule,
            global: options.global ?? false,
            imports: options.imports ?? [],
            controllers: [AdminStatsController],
            providers,
            exports: [AdminStatsService, SuperAdminGuard],
        };
    }
}
