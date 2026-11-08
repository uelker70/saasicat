// BundlesController — REST endpoints for `bundles` + `bundle_versions`.
//
// Path convention: all endpoints under `/admin/catalog/bundles`. The
// controller is built dynamically at boot time so that the consumer decides
// the class-level guards itself (authentication, `SuperAdminGuard`) —
// analogous to DiscoveryController. Publishing a version is not left to that
// chain: `@EnforceMfa()` puts the second factor on the handler.

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
    Req,
    type Type,
} from '@nestjs/common';

import { EnforceMfa } from '../admin/enforce-mfa.decorator.js';
import { BundlesService } from './bundles.service.js';
import {
    CreateBundleDto,
    CreateBundleVersionDraftDto,
    PublishBundleVersionDto,
    UpdateBundleDto,
    UpdateBundleVersionDraftDto,
} from './dto/bundles.dto.js';
import { AllowDuringMaintenance } from '../maintenance/allow-during-maintenance.js';
import { UseRouteGuards } from '../admin/use-route-guards.decorator.js';
import { WebAuditLogger } from '../core/web-audit.js';

/**
 * Builds the controller class at boot time with the guards configured by the
 * consumer. Pattern analogous to `buildDiscoveryController`.
 */
export function buildBundlesController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin/catalog/bundles')
    @AllowDuringMaintenance()
    @UseRouteGuards(...guards)
    class GeneratedBundlesController {
        constructor(
            @Inject(BundlesService)
            private readonly service: BundlesService,
            @Optional()
            @Inject(WebAuditLogger)
            private readonly audit: WebAuditLogger | null = null,
        ) {}

        // ─── Root operations ───

        @Get()
        listBundles() {
            return this.service.listBundles();
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
            @Req() request: unknown,
        ) {
            return this.service.createBundleDraft({
                bundleId,
                createdByUserId: this.audit?.resolveUserId(request) ?? null,
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
    @AllowDuringMaintenance()
    @UseRouteGuards(...guards)
    class GeneratedBundleVersionsController {
        constructor(
            @Inject(BundlesService)
            private readonly service: BundlesService,
            @Optional()
            @Inject(WebAuditLogger)
            private readonly audit: WebAuditLogger | null = null,
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
        @EnforceMfa()
        async publish(
            @Param('id', new ParseUUIDPipe()) versionId: string,
            @Body() dto: PublishBundleVersionDto,
            @Req() request: unknown,
        ) {
            const result = await this.service.publishBundleVersion(versionId, {
                publishedByUserId: this.audit?.resolveUserId(request) ?? null,
                forceRegressive: dto.forceRegressive,
                allowZeroPrice: dto.allowZeroPrice,
                validFrom: dto.validFrom,
                validUntil: dto.validUntil,
            });
            const published = result.bundleVersion;
            await this.audit?.logFromRequest(
                request,
                'BundleVersion',
                published.id,
                'BUNDLE_VERSION_PUBLISH',
                {
                    bundleKey: published.bundleKey,
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
    }

    return GeneratedBundleVersionsController;
}
