import { type CanActivate, Controller, Get, Inject, type Type } from '@nestjs/common';
import { AdminStatsService, type AdminStatsSnapshot } from './admin-stats.service.js';
import { SuperAdminGuard } from './super-admin.guard.js';
import { AllowDuringMaintenance } from '../maintenance/allow-during-maintenance.js';
import { UseRouteGuards } from './use-route-guards.decorator.js';

// AdminStatsController — `GET /admin/stats/dashboard` for the SuperAdmin
// dashboard page. SuperAdminGuard guards against tenant access. App-specific
// extra KPIs (e.g. DATEV or bundles/members usage) stay in the respective
// app-owned `/admin/extras/*` endpoints — the platform endpoint only
// delivers the generic subscription/promo/audit aggregates.

@Controller('admin/stats')
@AllowDuringMaintenance()
@UseRouteGuards(SuperAdminGuard)
export class AdminStatsController {
    // Explicit @Inject instead of type reflection: tsup/esbuild do not emit
    // `design:paramtypes` metadata, so Nest could otherwise not resolve the
    // service type at the constructor.
    constructor(@Inject(AdminStatsService) private readonly stats: AdminStatsService) {}

    @Get('dashboard')
    async getDashboardSnapshot(): Promise<AdminStatsSnapshot> {
        return this.stats.getSnapshot();
    }
}

/** Builds the stats controller with an explicit, ordered authentication chain. */
export function buildAdminStatsController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin/stats')
    @AllowDuringMaintenance()
    @UseRouteGuards(...guards)
    class GeneratedAdminStatsController {
        constructor(@Inject(AdminStatsService) private readonly stats: AdminStatsService) {}

        @Get('dashboard')
        async getDashboardSnapshot(): Promise<AdminStatsSnapshot> {
            return this.stats.getSnapshot();
        }
    }

    return GeneratedAdminStatsController;
}
