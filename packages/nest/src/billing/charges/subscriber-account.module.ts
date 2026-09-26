import {
    type CanActivate,
    Controller,
    type DynamicModule,
    type ForwardReference,
    Get,
    Inject,
    Module,
    Optional,
    Param,
    type Type,
    UseGuards,
} from '@nestjs/common';
import type { AdminSubscriberAccount, RlsBypassPort } from '@saasicat/core';

import { AdminResourcesService } from '../../admin/admin-resources.module.js';
import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { SubscriberAccountService } from './subscriber-account.service.js';

export interface SubscriberAccountModuleOptions {
    /** The same chain the tenant routes of the administration run behind. */
    guards: Array<Type<CanActivate>>;
    /**
     * Must bring `AdminResourcesService` and `SubscriberAccountService` into
     * scope — the modules that already provide them, passed as the very objects
     * the application imports, so that no adapter is built a second time.
     */
    imports: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

function buildSubscriberAccountController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin')
    @UseGuards(...guards)
    class GeneratedSubscriberAccountController {
        constructor(
            @Inject(AdminResourcesService)
            private readonly tenants: AdminResourcesService,
            @Inject(SubscriberAccountService)
            private readonly accounts: SubscriberAccountService,
            // Provided by the platform's admin module; optional so that the
            // module can be built without it.
            @Optional()
            @Inject(RLS_BYPASS_PORT_TOKEN)
            private readonly rlsBypass: RlsBypassPort | null = null,
        ) {}

        /**
         * The charges of the tenant's subscriber. An operator's request is
         * scoped to no tenant, so finding the tenant and reading its account
         * both run outside any row-level policy the application keeps its
         * tenants apart with.
         */
        @Get('tenants/:slug/charges')
        chargesOf(@Param('slug') slug: string): Promise<AdminSubscriberAccount> {
            const read = async (): Promise<AdminSubscriberAccount> => {
                const tenant = await this.tenants.getTenantDetail(slug);
                return this.accounts.accountOf(tenant.id);
            };
            return this.rlsBypass ? this.rlsBypass.runWithBypass(read) : read();
        }
    }

    return GeneratedSubscriberAccountController;
}

/**
 * The operator's view of a subscriber's account, served beside the tenant it
 * belongs to. Mounted where the platform keeps both the administration's
 * tenants and a charge journal.
 */
@Module({})
export class SubscriberAccountModule {
    static forRoot(options: SubscriberAccountModuleOptions): DynamicModule {
        return {
            module: SubscriberAccountModule,
            imports: options.imports,
            controllers: [buildSubscriberAccountController(options.guards)],
        };
    }
}
