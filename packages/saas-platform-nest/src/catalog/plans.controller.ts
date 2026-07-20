// PlansController + PlanVersionsController — REST endpoints for `plans`
// (SPEC_V2 §11.1 M6).
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
    type Type,
    UseGuards,
} from '@nestjs/common';

import { PlansService } from './plans.service.js';
import { PlanVersionsService } from './plan-versions.service.js';
import { CreatePlanDto, UpdatePlanDto } from './dto/plans.dto.js';
import {
    CreatePlanVersionDraftDto,
    PublishPlanVersionDto,
    TerminatePlanVersionDto,
    UpdatePlanVersionDraftDto,
} from './dto/plan-versions.dto.js';

export function buildPlansController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin/catalog/plans')
    @UseGuards(...guards)
    class GeneratedPlansController {
        constructor(
            @Inject(PlansService)
            private readonly service: PlansService,
            @Optional()
            @Inject(PlanVersionsService)
            private readonly versionsService: PlanVersionsService | null = null,
        ) {}

        // ─── Master operations ───

        @Get()
        listPlans(
            @Query('projectKey') projectKey: string,
            @Query('onlyPublished') onlyPublished?: string,
        ) {
            return this.service.listPlans(projectKey, { onlyPublished: onlyPublished === 'true' });
        }

        // Static route BEFORE `@Get(':id')` — Fastify prioritizes static over
        // parametric; this makes the ordering additionally explicit.
        @Get('tenant-counts')
        getTenantCounts(@Query('projectKey') projectKey: string) {
            return this.service.getTenantCounts(projectKey);
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
        ) {
            this.assertVersionsService();
            return this.versionsService!.createPlanDraft({
                planId,
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
                    'PlanVersionsService nicht registriert — App hat den ' +
                        'Plan-Lifecycle-Editor nicht aktiviert.',
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
    @UseGuards(...guards)
    class GeneratedPlanVersionsController {
        constructor(
            @Inject(PlanVersionsService)
            private readonly service: PlanVersionsService,
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
        publish(
            @Param('id', new ParseUUIDPipe()) versionId: string,
            @Body() dto: PublishPlanVersionDto,
        ) {
            return this.service.publishPlanVersion(versionId, {
                publishedByUserId: null, // set by the app's @CurrentUser(); not yet wired up in Pack 2a
                forceRegressive: dto.forceRegressive,
                allowZeroPrice: dto.allowZeroPrice,
                validFrom: dto.validFrom,
                validUntil: dto.validUntil,
            });
        }

        @Delete(':id')
        @HttpCode(HttpStatus.NO_CONTENT)
        async discardDraft(@Param('id', new ParseUUIDPipe()) versionId: string): Promise<void> {
            await this.service.discardPlanDraft(versionId);
        }

        @Post(':id/terminate')
        terminate(
            @Param('id', new ParseUUIDPipe()) versionId: string,
            @Body() dto: TerminatePlanVersionDto,
        ) {
            return this.service.terminatePlanVersion(versionId, new Date(dto.endsAt));
        }
    }

    return GeneratedPlanVersionsController;
}
