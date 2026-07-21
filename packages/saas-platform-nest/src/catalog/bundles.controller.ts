// BundlesController — REST endpoints for `bundles` + `bundle_versions`.
//
// Path convention: all endpoints under `/admin/catalog/bundles`. The
// controller is built dynamically at boot time so that the consumer decides
// the class-level guards itself (`SuperAdminGuard`, MFA, …) — analogous to
// DiscoveryController.

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
 * Builds the controller class at boot time with the guards configured by the
 * consumer. Pattern analogous to `buildDiscoveryController`.
 */
export function buildBundlesController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin/catalog/bundles')
    @UseGuards(...guards)
    class GeneratedBundlesController {
        constructor(
            @Inject(BundlesService)
            private readonly service: BundlesService,
        ) {}

        // ─── Root operations ───

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

        // ─── Version operations ───

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
 * Second controller with the version-specific endpoints. Deliberately
 * separate, because they do not go through `bundles/:id/versions/:vid` but
 * through stable version IDs (`/admin/catalog/bundle-versions/:id`) — this
 * way the UI can work with a version-ID reference without a bundle lookup.
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
                publishedByUserId: null, // set by the app's @CurrentUser(); not yet wired up in M3
                forceRegressive: dto.forceRegressive,
                allowZeroPrice: dto.allowZeroPrice,
                validFrom: dto.validFrom,
                validUntil: dto.validUntil,
            });
        }
    }

    return GeneratedBundleVersionsController;
}
