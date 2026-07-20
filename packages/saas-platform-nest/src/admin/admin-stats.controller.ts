import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { AdminStatsService, type AdminStatsSnapshot } from './admin-stats.service.js';
import { SuperAdminGuard } from './super-admin.guard.js';

// AdminStatsController — `GET /admin/stats/dashboard` für die SuperAdmin-
// Dashboard-Page. SuperAdminGuard schützt vor Tenant-Zugriff. App-spezifische
// Extra-KPIs (z. B. DATEV- oder Bundles/Members-Usage) bleiben in den
// jeweiligen App-eigenen `/admin/extras/*`-Endpoints — der Plattform-Endpoint
// liefert nur die generischen Subscription-/Promo-/Audit-Aggregate.

@Controller('admin/stats')
@UseGuards(SuperAdminGuard)
export class AdminStatsController {
    // Explizites @Inject statt Type-Reflection: tsup/esbuild emittieren keine
    // `design:paramtypes`-Metadata, sodass Nest den Service-Typ am Constructor
    // sonst nicht auflösen kann.
    constructor(@Inject(AdminStatsService) private readonly stats: AdminStatsService) {}

    @Get('dashboard')
    async getDashboardSnapshot(): Promise<AdminStatsSnapshot> {
        return this.stats.getSnapshot();
    }
}
