import {
    type CanActivate,
    Controller,
    type DynamicModule,
    type ForwardReference,
    Get,
    Inject,
    Module,
    Param,
    Query,
    type Type,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsString, MinLength } from 'class-validator';
import {
    SUBSCRIBER_ATTENTION_PAGE_SIZE,
    type AdminSubscriberAttention,
    type AdminTenantSubscriber,
    type RlsBypassPort,
    type SubscriberRepository,
} from '@saasicat/core';

import { AdminResourcesService } from '../admin/admin-resources.module.js';
import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { UseRouteGuards } from '../admin/use-route-guards.decorator.js';
import { asProvider, type ProviderSpec } from '../core/di.js';
import { AllowDuringMaintenance } from '../maintenance/allow-during-maintenance.js';
import { SubscriberStandingService } from './subscriber-standing.service.js';
import { SUBSCRIBER_REPOSITORY_TOKEN } from './subscriber.tokens.js';

/** `GET admin/subscribers/attention?tenantId=…&tenantId=…` — the tenants of the page shown. */
export class SubscriberAttentionQueryDto {
    // A query string carries one value as a string and several as a list.
    @Transform(({ value }: { value: unknown }) => (Array.isArray(value) ? value : [value]))
    @IsArray()
    @ArrayMaxSize(SUBSCRIBER_ATTENTION_PAGE_SIZE)
    @IsString({ each: true })
    @MinLength(1, { each: true })
    tenantId: string[] = [];
}

export interface SubscriberStandingModuleOptions {
    /** The same chain the tenant routes of the administration run behind. */
    guards: Array<Type<CanActivate>>;
    subscriberRepository: ProviderSpec<SubscriberRepository>;
    /**
     * Must bring `AdminResourcesService` into scope — the module that already
     * provides it, passed as the very object the application imports. The
     * `RlsBypassPort` and the tax treatments have to be visible too;
     * `SaaSiCatModule` provides both globally.
     */
    imports: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

function buildSubscriberStandingController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin')
    @AllowDuringMaintenance()
    @UseRouteGuards(...guards)
    class GeneratedSubscriberStandingController {
        constructor(
            @Inject(AdminResourcesService)
            private readonly tenants: AdminResourcesService,
            @Inject(SubscriberStandingService)
            private readonly standing: SubscriberStandingService,
            // Required: without it the reads would run in the request's
            // row-level scope, and a subscriber a policy hides would read as one
            // the tenant does not have.
            @Inject(RLS_BYPASS_PORT_TOKEN)
            private readonly rlsBypass: RlsBypassPort,
        ) {}

        /** The tenant's subscriber, its tax details and what holds its next contract back. */
        @Get('tenants/:slug/subscriber')
        subscriberOf(@Param('slug') slug: string): Promise<AdminTenantSubscriber> {
            return this.rlsBypass.runWithBypass(async () => {
                const tenant = await this.tenants.getTenantDetail(slug);
                return this.standing.ofTenant(tenant.id);
            });
        }

        /** Which of the tenants named cannot give their subscriber its next contract, and why. */
        @Get('subscribers/attention')
        attention(
            @Query() query: SubscriberAttentionQueryDto,
        ): Promise<{ attention: AdminSubscriberAttention[] }> {
            return this.rlsBypass.runWithBypass(async () => ({
                attention: await this.standing.attentionAmong(query.tenantId),
            }));
        }
    }

    return GeneratedSubscriberStandingController;
}

/**
 * The operator's view of a tenant's subscriber — its tax details and, where a
 * tax adapter decides, what holds its next contract back (`SC-PRIC-070`) —
 * served beside the tenant it belongs to.
 */
@Module({})
export class SubscriberStandingModule {
    static forRoot(options: SubscriberStandingModuleOptions): DynamicModule {
        return {
            module: SubscriberStandingModule,
            imports: options.imports,
            providers: [
                asProvider(SUBSCRIBER_REPOSITORY_TOKEN, options.subscriberRepository),
                SubscriberStandingService,
            ],
            controllers: [buildSubscriberStandingController(options.guards)],
        };
    }
}
