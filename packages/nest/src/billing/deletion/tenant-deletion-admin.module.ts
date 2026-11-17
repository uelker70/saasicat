import {
    type CanActivate,
    Controller,
    type DynamicModule,
    type ForwardReference,
    Get,
    Inject,
    Module,
    Param,
    type Type,
} from '@nestjs/common';
import type { AdminSubscriberDeletions, AdminTenantDeletion, RlsBypassPort } from '@saasicat/core';

import { AdminResourcesService } from '../../admin/admin-resources.module.js';
import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { UseRouteGuards } from '../../admin/use-route-guards.decorator.js';
import { AllowDuringMaintenance } from '../../maintenance/allow-during-maintenance.js';
import { TenantDeletionReadingService } from './tenant-deletion-reading.service.js';

export interface TenantDeletionAdminModuleOptions {
    /** The same chain the tenant routes of the administration run behind. */
    guards: Array<Type<CanActivate>>;
    /**
     * Must bring `AdminResourcesService` and `TenantDeletionReadingService`
     * into scope — the modules that already provide them, passed as the very
     * objects the application imports, so that no adapter is built a second
     * time. The `RlsBypassPort` has to be visible too; `SaaSiCatModule`
     * provides it globally.
     */
    imports: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

function buildTenantDeletionAdminController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin')
    @AllowDuringMaintenance()
    @UseRouteGuards(...guards)
    class GeneratedTenantDeletionAdminController {
        constructor(
            @Inject(AdminResourcesService)
            private readonly tenants: AdminResourcesService,
            @Inject(TenantDeletionReadingService)
            private readonly deletions: TenantDeletionReadingService,
            // Required rather than optional: a deletion is read across
            // tenants, and in the request's row-level scope a record a policy
            // hides would read as a deletion that never began. Missing, the
            // module does not start.
            @Inject(RLS_BYPASS_PORT_TOKEN)
            private readonly rlsBypass: RlsBypassPort,
        ) {}

        /**
         * Where the tenant's deletion stands, with its record once begun; null
         * where none has begun and no end decides one. Answers only while the
         * application has the tenant: after the deletion the subscriber's
         * record carries it.
         */
        @Get('tenants/:slug/deletion')
        deletionOf(@Param('slug') slug: string): Promise<{ deletion: AdminTenantDeletion | null }> {
            return this.rlsBypass.runWithBypass(async () => {
                const tenant = await this.tenants.getTenantDetail(slug);
                return { deletion: await this.deletions.ofTenant(tenant.id, new Date()) };
            });
        }

        /** Every deletion of the subscriber's tenants, also of those the application no longer has. */
        @Get('subscribers/:id/deletions')
        deletionsOf(@Param('id') id: string): Promise<AdminSubscriberDeletions> {
            return this.rlsBypass.runWithBypass(() => this.deletions.ofSubscriber(id, new Date()));
        }
    }

    return GeneratedTenantDeletionAdminController;
}

/**
 * The operator's view of a tenant's deletion, on the tenant's page and in its
 * subscriber's record (`SC-ADM-058`). Mounted where the platform shows the
 * administration's tenants and records the ends of their subscriptions.
 */
@Module({})
export class TenantDeletionAdminModule {
    static forRoot(options: TenantDeletionAdminModuleOptions): DynamicModule {
        return {
            module: TenantDeletionAdminModule,
            imports: options.imports,
            controllers: [buildTenantDeletionAdminController(options.guards)],
        };
    }
}
