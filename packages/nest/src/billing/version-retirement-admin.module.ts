// The operator's retirement routes, beside the plan versions they act on.
//
// Built at boot with the operator's guard chain, like the catalogue's own
// routes. Announcing checks the second factor on the route itself: it changes
// what running contracts continue on, and a guard list that leaves the check
// out must not switch it off.

import {
    Body,
    type CanActivate,
    Controller,
    type DynamicModule,
    type ForwardReference,
    Get,
    Inject,
    Module,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
    Req,
    type Type,
} from '@nestjs/common';
import type {
    BundleRetirementAnnounced,
    BundleRetirementPreview,
    BundleVersionRetirementView,
    RetirementAnnounced,
    RetirementPreview,
    VersionRetirementView,
} from '@saasicat/core';

import { EnforceMfa } from '../admin/enforce-mfa.decorator.js';
import { UseRouteGuards } from '../admin/use-route-guards.decorator.js';
import { WebAuditLogger } from '../core/web-audit.js';
import { AllowDuringMaintenance } from '../maintenance/allow-during-maintenance.js';
import { BundleVersionRetirementService } from './bundle-version-retirement.service.js';
import {
    AnnounceBundleRetirementDto,
    AnnounceRetirementDto,
} from './dto/version-retirement.dto.js';
import { VersionRetirementService } from './version-retirement.service.js';

export interface VersionRetirementAdminModuleOptions {
    /** The chain the catalogue's operator routes run behind. */
    guards: Array<Type<CanActivate>>;
    /**
     * Must bring `VersionRetirementService` into scope — the tenant billing
     * module that provides it, passed as the very object the application
     * imports, so that no adapter is built a second time.
     */
    imports: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    /**
     * Serves retiring add-on versions beside plan versions; the imported
     * module then has to provide `BundleVersionRetirementService` as well.
     */
    bundleVersions?: boolean;
}

function buildVersionRetirementController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin/catalog')
    @AllowDuringMaintenance()
    @UseRouteGuards(...guards)
    class GeneratedVersionRetirementController {
        // Explicit @Inject: tsup/esbuild emit no `design:paramtypes`.
        constructor(
            @Inject(VersionRetirementService)
            private readonly retirements: VersionRetirementService,
            @Inject(WebAuditLogger) private readonly audit: WebAuditLogger,
        ) {}

        /** What retiring the version for `replacement` would do now. */
        @Get('plan-versions/:id/retirement')
        preview(
            @Param('id', new ParseUUIDPipe()) versionId: string,
            @Query('replacement', new ParseUUIDPipe()) replacementId: string,
        ): Promise<RetirementPreview> {
            return this.retirements.preview(versionId, replacementId, new Date());
        }

        @Post('plan-versions/:id/retirement')
        @EnforceMfa()
        announce(
            @Param('id', new ParseUUIDPipe()) versionId: string,
            @Body() dto: AnnounceRetirementDto,
            @Req() request: unknown,
        ): Promise<RetirementAnnounced> {
            return this.retirements.announce(
                versionId,
                dto.replacementPlanVersionId,
                dto.subscriptionIds,
                this.audit.actorFromRequest(request),
                new Date(),
            );
        }

        @Get('version-retirements')
        list(): Promise<VersionRetirementView[]> {
            return this.retirements.list();
        }
    }

    return GeneratedVersionRetirementController;
}

function buildBundleVersionRetirementController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin/catalog')
    @AllowDuringMaintenance()
    @UseRouteGuards(...guards)
    class GeneratedBundleVersionRetirementController {
        // Explicit @Inject: tsup/esbuild emit no `design:paramtypes`.
        constructor(
            @Inject(BundleVersionRetirementService)
            private readonly retirements: BundleVersionRetirementService,
            @Inject(WebAuditLogger) private readonly audit: WebAuditLogger,
        ) {}

        /** What retiring the add-on version for `replacement` would do now. */
        @Get('bundle-versions/:id/retirement')
        preview(
            @Param('id', new ParseUUIDPipe()) versionId: string,
            @Query('replacement', new ParseUUIDPipe()) replacementId: string,
        ): Promise<BundleRetirementPreview> {
            return this.retirements.preview(versionId, replacementId, new Date());
        }

        @Post('bundle-versions/:id/retirement')
        @EnforceMfa()
        announce(
            @Param('id', new ParseUUIDPipe()) versionId: string,
            @Body() dto: AnnounceBundleRetirementDto,
            @Req() request: unknown,
        ): Promise<BundleRetirementAnnounced> {
            return this.retirements.announce(
                versionId,
                dto.replacementBundleVersionId,
                dto.subscriptionBundleIds,
                this.audit.actorFromRequest(request),
                new Date(),
            );
        }

        @Get('bundle-version-retirements')
        list(): Promise<BundleVersionRetirementView[]> {
            return this.retirements.list();
        }
    }

    return GeneratedBundleVersionRetirementController;
}

/**
 * Retiring a plan version for the subscriptions on it, and an add-on version
 * for the bookings on it. Mounted where the catalogue serves its operator
 * routes and tenant billing keeps announcements.
 */
@Module({})
export class VersionRetirementAdminModule {
    static forRoot(options: VersionRetirementAdminModuleOptions): DynamicModule {
        return {
            module: VersionRetirementAdminModule,
            imports: options.imports,
            controllers: [
                buildVersionRetirementController(options.guards),
                ...(options.bundleVersions
                    ? [buildBundleVersionRetirementController(options.guards)]
                    : []),
            ],
            providers: [WebAuditLogger],
        };
    }
}
