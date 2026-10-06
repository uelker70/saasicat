// The operator's routes for withdrawing a feature for a reason outside the
// platform.
//
// Built at boot with the operator's guard chain, like the catalogue's own
// routes. Announcing and lifting check the second factor on the route itself:
// both change what every subscription holding the feature is granted and
// charged, and a guard list that leaves the check out must not switch it off.

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
    Post,
    Query,
    Req,
    type Type,
} from '@nestjs/common';
import type {
    FeatureWithdrawalAnnounced,
    FeatureWithdrawalLifted,
    FeatureWithdrawalPreview,
    FeatureWithdrawalView,
} from '@saasicat/core';

import { EnforceMfa } from '../admin/enforce-mfa.decorator.js';
import { UseRouteGuards } from '../admin/use-route-guards.decorator.js';
import { WebAuditLogger } from '../core/web-audit.js';
import { AllowDuringMaintenance } from '../maintenance/allow-during-maintenance.js';
import {
    AnnounceFeatureWithdrawalDto,
    FeatureWithdrawalPreviewQueryDto,
    LiftFeatureWithdrawalDto,
} from './dto/feature-withdrawal.dto.js';
import { FeatureWithdrawalService } from './feature-withdrawal.service.js';

export interface FeatureWithdrawalAdminModuleOptions {
    /** The chain the operator's routes run behind. */
    guards: Array<Type<CanActivate>>;
    /**
     * Must bring `FeatureWithdrawalService` into scope — the tenant billing
     * module that provides it, passed as the very object the application
     * imports, so that no adapter is built a second time.
     */
    imports: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

function buildFeatureWithdrawalController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin/feature-withdrawals')
    @AllowDuringMaintenance()
    @UseRouteGuards(...guards)
    class GeneratedFeatureWithdrawalController {
        // Explicit @Inject: tsup/esbuild emit no `design:paramtypes`.
        constructor(
            @Inject(FeatureWithdrawalService)
            private readonly withdrawals: FeatureWithdrawalService,
            @Inject(WebAuditLogger) private readonly audit: WebAuditLogger,
        ) {}

        /** What withdrawing the feature from the date — now where left out — would do. */
        @Get('preview')
        preview(
            @Query() query: FeatureWithdrawalPreviewQueryDto,
        ): Promise<FeatureWithdrawalPreview> {
            return this.withdrawals.preview(
                query.featureKey,
                query.effectiveFrom ? new Date(query.effectiveFrom) : null,
                new Date(),
            );
        }

        @Post()
        @EnforceMfa()
        announce(
            @Body() dto: AnnounceFeatureWithdrawalDto,
            @Req() request: unknown,
        ): Promise<FeatureWithdrawalAnnounced> {
            return this.withdrawals.announce(
                {
                    featureKey: dto.featureKey,
                    reason: dto.reason,
                    effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
                    reductions: dto.reductions,
                    subscriptionIds: dto.subscriptionIds,
                },
                this.audit.actorFromRequest(request),
                new Date(),
            );
        }

        @Get()
        list(): Promise<FeatureWithdrawalView[]> {
            return this.withdrawals.list();
        }

        @Post(':id/lift')
        @EnforceMfa()
        lift(
            @Param('id') id: string,
            @Body() dto: LiftFeatureWithdrawalDto,
            @Req() request: unknown,
        ): Promise<FeatureWithdrawalLifted> {
            return this.withdrawals.lift(
                id,
                dto.liftedFrom ? new Date(dto.liftedFrom) : null,
                this.audit.actorFromRequest(request),
                new Date(),
            );
        }
    }

    return GeneratedFeatureWithdrawalController;
}

/**
 * Withdrawing a feature for every subscription that holds it, and lifting the
 * withdrawal. Mounted where tenant billing keeps withdrawals.
 */
@Module({})
export class FeatureWithdrawalAdminModule {
    static forRoot(options: FeatureWithdrawalAdminModuleOptions): DynamicModule {
        return {
            module: FeatureWithdrawalAdminModule,
            imports: options.imports,
            controllers: [buildFeatureWithdrawalController(options.guards)],
            providers: [WebAuditLogger],
        };
    }
}
