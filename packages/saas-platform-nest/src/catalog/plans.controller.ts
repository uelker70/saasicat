// PlansController + PlanVersionsController — REST-Endpunkte für `plans`
// (SPEC_V2 §11.1 M6).
//
// Pack 1: Plan-Stamm-CRUD unter `/admin/catalog/plans`.
// Pack 2a: PlanVersion-Lifecycle unter
//   `/admin/catalog/plans/:id/versions` (list+createDraft) und
//   `/admin/catalog/plan-versions/:id` (get/patch/publish).
//
// Beide PlansController-Endpunkte (Stamm + Version-Listen) leben in einem
// Controller, weil sie unter `plans` gemountet sind. Version-spezifische
// Endpoints kommen separat in PlanVersionsController, damit das UI mit
// stabilen Version-IDs arbeiten kann ohne Plan-Lookup (analog Bundle).

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

        // ─── Stamm-Operationen ───

        @Get()
        listPlans(
            @Query('projectKey') projectKey: string,
            @Query('onlyPublished') onlyPublished?: string,
        ) {
            return this.service.listPlans(projectKey, { onlyPublished: onlyPublished === 'true' });
        }

        // Statische Route VOR `@Get(':id')` — Fastify priorisiert statisch vor
        // parametrisch, dies macht die Reihenfolge zusätzlich explizit.
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

        // ─── Version-Operationen (Pack 2a, optional) ───
        // Wenn PlanVersionsService nicht registriert ist, liefern beide
        // Endpoints HTTP 501. Apps ohne SuperAdmin-Plan-Editor mounten den
        // Service einfach nicht.

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
 * Version-spezifische Endpoints. Stabil per Version-ID — UI muss nicht
 * den Plan-Stamm kennen.
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
                publishedByUserId: null, // wird vom @CurrentUser() der App gesetzt; in Pack 2a noch nicht verdrahtet
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
