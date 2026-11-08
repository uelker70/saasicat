// PlansController + PlanVersionsController — REST endpoints for `plans`
//
// Pack 1: plan master CRUD under `/admin/catalog/plans`.
// Pack 2a: PlanVersion lifecycle under
//   `/admin/catalog/plans/:id/versions` (list+createDraft) and
//   `/admin/catalog/plan-versions/:id` (get/patch/publish).
//
// Both PlansController endpoints (master + version lists) live in one
// controller because they are mounted under `plans`. Version-specific
// endpoints come separately in PlanVersionsController, so the UI can work
// with stable version IDs without a plan lookup (analogous to Bundle).

import {
    Body,
    type CanActivate,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Inject,
    Optional,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    Req,
    type Type,
} from '@nestjs/common';

import { EnforceMfa } from '../admin/enforce-mfa.decorator.js';
import { PlansService } from './plans.service.js';
import { PlanVersionsService } from './plan-versions.service.js';
import { CreatePlanDto, UpdatePlanDto } from './dto/plans.dto.js';
import {
    CreatePlanVersionDraftDto,
    PublishPlanVersionDto,
    TerminatePlanVersionDto,
    UpdatePlanVersionDraftDto,
} from './dto/plan-versions.dto.js';
import { AllowDuringMaintenance } from '../maintenance/allow-during-maintenance.js';
import { UseRouteGuards } from '../admin/use-route-guards.decorator.js';
import { WebAuditLogger } from '../core/web-audit.js';

export function buildPlansController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin/catalog/plans')
    @AllowDuringMaintenance()
    @UseRouteGuards(...guards)
    class GeneratedPlansController {
        constructor(
            @Inject(PlansService)
            private readonly service: PlansService,
            @Optional()
            @Inject(PlanVersionsService)
            private readonly versionsService: PlanVersionsService | null = null,
            @Optional()
            @Inject(WebAuditLogger)
            private readonly audit: WebAuditLogger | null = null,
        ) {}

        // ─── Master operations ───

        @Get()
        listPlans(@Query('onlyPublished') onlyPublished?: string) {
            return this.service.listPlans({ onlyPublished: onlyPublished === 'true' });
        }

        // Static route BEFORE `@Get(':id')` — Fastify prioritizes static over
        // parametric; this makes the ordering additionally explicit.
        @Get('tenant-counts')
        getTenantCounts() {
            return this.service.getTenantCounts();
        }

        @Get(':id')
        getPlan(@Param('id', new ParseUUIDPipe()) planId: string) {
            return this.service.getPlan(planId);
        }

        @Post()
        createPlan(@Body() dto: CreatePlanDto) {
            return this.service.createPlan(dto);
        }

        @Patch(':id')
        updatePlan(@Param('id', new ParseUUIDPipe()) planId: string, @Body() dto: UpdatePlanDto) {
            return this.service.updatePlan(planId, dto);
        }

        @Delete(':id')
        @HttpCode(HttpStatus.NO_CONTENT)
        async softDeletePlan(@Param('id', new ParseUUIDPipe()) planId: string) {
            await this.service.softDeletePlan(planId);
        }

        @Delete(':id/purge')
        @EnforceMfa()
        @HttpCode(HttpStatus.NO_CONTENT)
        async hardDeletePlan(@Param('id', new ParseUUIDPipe()) planId: string) {
            await this.service.hardDeletePlan(planId);
        }

        // ─── Version operations (Pack 2a, optional) ───
        // When PlanVersionsService is not registered, both endpoints return
        // HTTP 501. Apps without a SuperAdmin plan editor simply do not mount
        // the service.

        @Get(':id/versions')
        listVersions(@Param('id', new ParseUUIDPipe()) planId: string) {
            this.assertVersionsService();
            return this.versionsService!.listPlanVersions(planId);
        }

        @Post(':id/versions')
        createDraft(
            @Param('id', new ParseUUIDPipe()) planId: string,
            @Body() dto: CreatePlanVersionDraftDto,
            @Req() request: unknown,
        ) {
            this.assertVersionsService();
            return this.versionsService!.createPlanDraft({
                planId,
                createdByUserId: this.audit?.resolveUserId(request) ?? null,
                features: dto.features,
                bundles: dto.bundles,
                quotas: dto.quotas,
                monthlyNet: dto.monthlyNet,
                yearlyNet: dto.yearlyNet,
                marketed: dto.marketed,
                changeNote: dto.changeNote,
                baseVersionId: dto.baseVersionId,
                validFrom: dto.validFrom,
                validUntil: dto.validUntil,
            });
        }

        private assertVersionsService(): void {
            if (!this.versionsService) {
                throw new Error(
                    'PlanVersionsService is not registered — the app has not enabled the ' +
                        'plan lifecycle editor.',
                );
            }
        }
    }

    return GeneratedPlansController;
}

/**
 * Version-specific endpoints. Stable by version ID — the UI does not need
 * to know the plan master.
 */
export function buildPlanVersionsController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin/catalog/plan-versions')
    @AllowDuringMaintenance()
    @UseRouteGuards(...guards)
    class GeneratedPlanVersionsController {
        constructor(
            @Inject(PlanVersionsService)
            private readonly service: PlanVersionsService,
            @Optional()
            @Inject(WebAuditLogger)
            private readonly audit: WebAuditLogger | null = null,
        ) {}

        @Get(':id')
        getVersion(@Param('id', new ParseUUIDPipe()) versionId: string) {
            return this.service.getPlanVersion(versionId);
        }

        @Patch(':id')
        updateDraft(
            @Param('id', new ParseUUIDPipe()) versionId: string,
            @Body() dto: UpdatePlanVersionDraftDto,
        ) {
            return this.service.updatePlanDraft(versionId, dto);
        }

        @Post(':id/publish')
        @EnforceMfa()
        async publish(
            @Param('id', new ParseUUIDPipe()) versionId: string,
            @Body() dto: PublishPlanVersionDto,
            @Req() request: unknown,
        ) {
            const result = await this.service.publishPlanVersion(versionId, {
                publishedByUserId: this.audit?.resolveUserId(request) ?? null,
                forceRegressive: dto.forceRegressive,
                allowZeroPrice: dto.allowZeroPrice,
                validFrom: dto.validFrom,
                validUntil: dto.validUntil,
            });
            const published = result.planVersion;
            await this.audit?.logFromRequest(
                request,
                'PlanVersion',
                published.id,
                'PLAN_VERSION_PUBLISH',
                {
                    planId: published.planId,
                    version: published.version,
                    validFrom: published.validFrom,
                    validUntil: published.validUntil,
                    nonRegressive: published.nonRegressive,
                    forceRegressive: dto.forceRegressive === true,
                    allowZeroPrice: dto.allowZeroPrice === true,
                },
            );
            return result;
        }

        @Delete(':id')
        @HttpCode(HttpStatus.NO_CONTENT)
        async discardDraft(@Param('id', new ParseUUIDPipe()) versionId: string): Promise<void> {
            await this.service.discardPlanDraft(versionId);
        }

        @Post(':id/terminate')
        @EnforceMfa()
        async terminate(
            @Param('id', new ParseUUIDPipe()) versionId: string,
            @Body() dto: TerminatePlanVersionDto,
            @Req() request: unknown,
        ) {
            const terminated = await this.service.terminatePlanVersion(
                versionId,
                new Date(dto.endsAt),
            );
            await this.audit?.logFromRequest(
                request,
                'PlanVersion',
                terminated.id,
                'PLAN_VERSION_TERMINATE',
                {
                    planId: terminated.planId,
                    version: terminated.version,
                    endsAt: terminated.endsAt,
                },
            );
            return terminated;
        }
    }

    return GeneratedPlanVersionsController;
}
