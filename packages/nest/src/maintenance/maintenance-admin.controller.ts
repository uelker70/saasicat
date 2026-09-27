// The operator's maintenance routes under `/admin/maintenance`.
//
// Built at boot with the consumer's guards, like the settings controller: the
// platform does not know how an installation authenticates its operators.
// Marked reachable during maintenance, because this is where an operator who
// locked the application comes back to unlock it.
//
// Locking and unlocking check the second factor on the route itself
// (`SC-ADM-029`), like suspending a tenant: every tenant is locked out at once,
// and a guard list that leaves the check out must not switch it off. Announcing,
// moving and cancelling lock nobody out and need neither.

import {
    BadRequestException,
    Body,
    type CanActivate,
    Controller,
    Get,
    Inject,
    Param,
    Patch,
    Post,
    Req,
    type Type,
    UseGuards,
} from '@nestjs/common';
import {
    MAINTENANCE_ERROR_CODES,
    MAINTENANCE_STATE_MAX_AGE_SECONDS,
    type MaintenanceLockView,
    type MaintenanceOverview,
    type MaintenanceUnlockView,
    type MaintenanceWindowRecord,
    type MaintenanceWindowView,
    maintenanceWindowViewOf,
    parseZonedInstant,
} from '@saasicat/core';

import { EnforceMfa } from '../admin/enforce-mfa.decorator.js';
import { WebAuditLogger } from '../core/web-audit.js';
import { codedError } from '../errors/coded-error.js';
import { AllowDuringMaintenance } from './allow-during-maintenance.js';
import {
    AnnounceMaintenanceDto,
    LockMaintenanceDto,
    RescheduleMaintenanceDto,
    UnlockMaintenanceDto,
} from './dto/maintenance.dto.js';
import { MaintenanceService } from './maintenance.service.js';

/** A time the operator typed, read with its zone, or refused naming the field. */
function instantOf(value: string, field: string): Date {
    const moment = parseZonedInstant(value);
    if (!moment) {
        throw new BadRequestException(
            codedError(MAINTENANCE_ERROR_CODES.MAINTENANCE_TIME_INVALID, { field }),
        );
    }
    return moment;
}

/** The same, for a time the operator may leave out. */
function optionalInstantOf(value: string | undefined, field: string): Date | undefined {
    return value === undefined ? undefined : instantOf(value, field);
}

const viewOf = (window: MaintenanceWindowRecord): MaintenanceWindowView =>
    maintenanceWindowViewOf(window, new Date());

export function buildMaintenanceAdminController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin')
    @UseGuards(...guards)
    @AllowDuringMaintenance()
    class GeneratedMaintenanceAdminController {
        // Explicit @Inject: tsup/esbuild emit no `design:paramtypes`.
        constructor(
            @Inject(MaintenanceService) private readonly maintenance: MaintenanceService,
            @Inject(WebAuditLogger) private readonly audit: WebAuditLogger,
        ) {}

        @Get('maintenance')
        overview(): Promise<MaintenanceOverview> {
            return this.maintenance.overview();
        }

        @Post('maintenance')
        async announce(
            @Body() dto: AnnounceMaintenanceDto,
            @Req() request: unknown,
        ): Promise<MaintenanceWindowView> {
            const window = await this.maintenance.announce(
                {
                    startsAt: instantOf(dto.startsAt, 'startsAt'),
                    endsAt: instantOf(dto.endsAt, 'endsAt'),
                    message: dto.message,
                },
                this.audit.actorFromRequest(request),
            );
            return viewOf(window);
        }

        @Patch('maintenance/:id')
        async reschedule(
            @Param('id') id: string,
            @Body() dto: RescheduleMaintenanceDto,
            @Req() request: unknown,
        ): Promise<MaintenanceWindowView> {
            const window = await this.maintenance.reschedule(
                id,
                {
                    startsAt: optionalInstantOf(dto.startsAt, 'startsAt'),
                    endsAt: optionalInstantOf(dto.endsAt, 'endsAt'),
                    message: dto.message,
                },
                this.audit.actorFromRequest(request),
            );
            return viewOf(window);
        }

        @Post('maintenance/:id/cancel')
        async cancel(
            @Param('id') id: string,
            @Req() request: unknown,
        ): Promise<MaintenanceWindowView> {
            return viewOf(await this.maintenance.cancel(id, this.audit.actorFromRequest(request)));
        }

        @Post('maintenance/lock')
        @EnforceMfa()
        async lock(
            @Body() dto: LockMaintenanceDto,
            @Req() request: unknown,
        ): Promise<MaintenanceLockView> {
            const outcome = await this.maintenance.lock(
                {
                    windowId: dto.windowId,
                    endsAt: optionalInstantOf(dto.endsAt, 'endsAt'),
                    message: dto.message,
                },
                this.audit.actorFromRequest(request),
            );
            return {
                window: viewOf(outcome.window),
                alreadyLocked: outcome.alreadyLocked,
                takesEffectWithinSeconds: MAINTENANCE_STATE_MAX_AGE_SECONDS,
            };
        }

        @Post('maintenance/unlock')
        @EnforceMfa()
        async unlock(
            @Body() dto: UnlockMaintenanceDto,
            @Req() request: unknown,
        ): Promise<MaintenanceUnlockView> {
            const outcome = await this.maintenance.unlock(
                { windowId: dto.windowId },
                this.audit.actorFromRequest(request),
            );
            return {
                window: outcome.window ? viewOf(outcome.window) : null,
                wasLocked: outcome.wasLocked,
            };
        }
    }

    return GeneratedMaintenanceAdminController;
}
