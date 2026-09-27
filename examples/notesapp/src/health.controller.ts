import { Controller, Get } from '@nestjs/common';
import { AllowDuringMaintenance, SaaSiCatPublicRoute } from '@saasicat/nest';

/**
 * What a deploy's health gate asks before it unlocks. Public, because the gate
 * holds no session, and reachable while the application is locked for
 * maintenance — otherwise the lock would answer 503 here too, and the gate
 * would never see the new version come up.
 */
@Controller('health')
@SaaSiCatPublicRoute()
@AllowDuringMaintenance()
export class HealthController {
    @Get()
    health(): { status: 'ok' } {
        return { status: 'ok' };
    }
}
