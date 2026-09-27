// `GET /public/maintenance` — what a tenant's page is told: nothing, a window
// ahead, or a lock.
//
// Public, because the sign-in page shows an announced window to somebody who
// is not signed in yet, and reachable during maintenance, because the page a
// locked-out tenant sees asks it to learn when the lock is lifted. It says
// only what every tenant is shown anyway: the times and the operator's message,
// never who locked it.

import { Controller, Get, Inject } from '@nestjs/common';
import type { MaintenanceStatusView } from '@saasicat/core';

import { SaaSiCatPublicRoute } from '../core/public-route.js';
import { AllowDuringMaintenance } from './allow-during-maintenance.js';
import { MaintenanceService } from './maintenance.service.js';

@Controller('public')
@SaaSiCatPublicRoute()
@AllowDuringMaintenance()
export class MaintenanceStatusController {
    // Explicit @Inject: tsup/esbuild emit no `design:paramtypes`.
    constructor(@Inject(MaintenanceService) private readonly maintenance: MaintenanceService) {}

    @Get('maintenance')
    status(): Promise<MaintenanceStatusView> {
        return this.maintenance.status();
    }
}
