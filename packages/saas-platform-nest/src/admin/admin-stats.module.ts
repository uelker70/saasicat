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

// AdminStatsModule — registriert `GET /admin/stats/dashboard` mit den drei
// App-Adaptern. Konsumenten implementieren `SubscriptionStatsPort`,
// `PromoCodeStatsPort`, `AuditStatsPort` und reichen sie via forRoot durch.
//
// Voraussetzung: `SuperAdminGuard` ist im DI-Scope verfügbar — entweder
// durch `AdminModule.forRoot({...})` (das ihn als Provider exportiert) oder
// durch direktes Provider-Registrieren in der App.

export interface AdminStatsModuleOptions {
    subscriptionStatsPort: ProviderSpec<SubscriptionStatsPort>;
    promoCodeStatsPort: ProviderSpec<PromoCodeStatsPort>;
    auditStatsPort: ProviderSpec<AuditStatsPort>;
    /** Audit-Fenster in Tagen für die "letzte N Tage"-KPI. Default 7. */
    auditWindowDays?: number;
    /**
     * Module, deren Provider im DI-Scope dieses DynamicModules sichtbar sein
     * müssen — z. B. das App-Modul, das die Adapter-Klassen registriert, die
     * die Factory-`inject`-Listen referenzieren.
     */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    /** Zusätzliche Provider, die im DynamicModule selbst registriert werden. */
    extraProviders?: Provider[];
    /** Modul global registrieren — Default `false`. */
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
