// BundlesController — REST-Endpunkte für `bundles` + `bundle_versions`.
//
// Pfad-Konvention: alle Endpoints unter `/admin/catalog/bundles`. Der
// Controller wird zur Boot-Zeit dynamisch gebaut, damit der Konsument die
// Class-Level-Guards selbst bestimmt (`SuperAdminGuard`, MFA, …) — analog
// zu DiscoveryController.

import {
    Body,
    type CanActivate,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Inject,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    type Type,
    UseGuards,
} from '@nestjs/common';

import { BundlesService } from './bundles.service.js';
import {
    CreateBundleDto,
    CreateBundleVersionDraftDto,
    PublishBundleVersionDto,
    UpdateBundleDto,
    UpdateBundleVersionDraftDto,
} from './dto/bundles.dto.js';

/**
 * Baut zur Boot-Zeit die Controller-Klasse mit den vom Konsumenten
 * konfigurierten Guards. Pattern analog zu `buildDiscoveryController`.
 */
export function buildBundlesController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin/catalog/bundles')
    @UseGuards(...guards)
    class GeneratedBundlesController {
        constructor(
            @Inject(BundlesService)
            private readonly service: BundlesService,
        ) {}

        // ─── Stamm-Operationen ───

        @Get()
        listBundles(@Query('projectKey') projectKey: string) {
            return this.service.listBundles(projectKey);
        }

        @Get(':id')
        getBundle(@Param('id', new ParseUUIDPipe()) bundleId: string) {
            return this.service.getBundle(bundleId);
        }

        @Post()
        createBundle(@Body() dto: CreateBundleDto) {
            return this.service.createBundle(dto);
        }

        @Patch(':id')
        updateBundle(
            @Param('id', new ParseUUIDPipe()) bundleId: string,
            @Body() dto: UpdateBundleDto,
        ) {
            return this.service.updateBundle(bundleId, dto);
        }

        @Delete(':id')
        @HttpCode(HttpStatus.NO_CONTENT)
        async softDeleteBundle(@Param('id', new ParseUUIDPipe()) bundleId: string) {
            await this.service.softDeleteBundle(bundleId);
        }

        // ─── Version-Operationen ───

        @Get(':id/versions')
        listVersions(@Param('id', new ParseUUIDPipe()) bundleId: string) {
            return this.service.listBundleVersions(bundleId);
        }

        @Post(':id/versions')
        createDraft(
            @Param('id', new ParseUUIDPipe()) bundleId: string,
            @Body() dto: CreateBundleVersionDraftDto,
        ) {
            return this.service.createBundleDraft({
                bundleId,
                features: dto.features,
                quotas: dto.quotas,
                compatibility: dto.compatibility,
                pricingOverrides: dto.pricingOverrides,
                monthlyNet: dto.monthlyNet,
                yearlyNet: dto.yearlyNet,
                marketed: dto.marketed,
                changeNote: dto.changeNote,
                baseVersionId: dto.baseVersionId,
                validFrom: dto.validFrom,
                validUntil: dto.validUntil,
            });
        }
    }

    return GeneratedBundlesController;
}

/**
 * Zweiter Controller mit den Version-spezifischen Endpunkten. Bewusst
 * separat, weil sie nicht über `bundles/:id/versions/:vid` gehen, sondern
 * über stabile Version-IDs (`/admin/catalog/bundle-versions/:id`) — so
 * kann das UI mit einem Version-ID-Refer arbeiten ohne Bundle-Lookup.
 */
export function buildBundleVersionsController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin/catalog/bundle-versions')
    @UseGuards(...guards)
    class GeneratedBundleVersionsController {
        constructor(
            @Inject(BundlesService)
            private readonly service: BundlesService,
        ) {}

        @Get(':id')
        getVersion(@Param('id', new ParseUUIDPipe()) versionId: string) {
            return this.service.getBundleVersion(versionId);
        }

        @Patch(':id')
        updateDraft(
            @Param('id', new ParseUUIDPipe()) versionId: string,
            @Body() dto: UpdateBundleVersionDraftDto,
        ) {
            return this.service.updateBundleDraft(versionId, dto);
        }

        @Delete(':id')
        @HttpCode(HttpStatus.NO_CONTENT)
        async discardDraft(@Param('id', new ParseUUIDPipe()) versionId: string) {
            await this.service.discardBundleDraft(versionId);
        }

        @Post(':id/publish')
        publish(
            @Param('id', new ParseUUIDPipe()) versionId: string,
            @Body() dto: PublishBundleVersionDto,
        ) {
            return this.service.publishBundleVersion(versionId, {
                publishedByUserId: null, // wird vom @CurrentUser() der App gesetzt; in M3 noch nicht verdrahtet
                forceRegressive: dto.forceRegressive,
                allowZeroPrice: dto.allowZeroPrice,
                validFrom: dto.validFrom,
                validUntil: dto.validUntil,
            });
        }
    }

    return GeneratedBundleVersionsController;
}
