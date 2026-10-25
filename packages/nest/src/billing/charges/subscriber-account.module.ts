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
import type { AdminSubscriberAccount, RlsBypassPort } from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { SubscriberAccountService } from './subscriber-account.service.js';
import { AllowDuringMaintenance } from '../../maintenance/allow-during-maintenance.js';
import { UseRouteGuards } from '../../admin/use-route-guards.decorator.js';

export interface SubscriberAccountModuleOptions {
    /** The same chain the tenant routes of the administration run behind. */
    guards: Array<Type<CanActivate>>;
    /**
     * Must bring `SubscriberAccountService` into scope — the module that
     * already provides it, passed as the very object the application imports,
     * so that no adapter is built a second time. The `RlsBypassPort` has to be
     * visible too; `SaaSiCatModule` provides it globally.
     */
    imports: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

function buildSubscriberAccountController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin')
    @AllowDuringMaintenance()
    @UseRouteGuards(...guards)
    class GeneratedSubscriberAccountController {
        constructor(
            @Inject(SubscriberAccountService)
            private readonly accounts: SubscriberAccountService,
            // Required rather than optional: without it the read would run in
            // the request's row-level scope, and an account a policy hides
            // reads exactly like an empty one. Missing, the module does not
            // start.
            @Inject(RLS_BYPASS_PORT_TOKEN)
            private readonly rlsBypass: RlsBypassPort,
        ) {}

        /**
         * The subscriber's charges, whichever tenant they arose for. An
         * operator's request is scoped to no tenant, so the account is read
         * outside any row-level policy the application keeps its tenants
         * apart with.
         */
        @Get('subscribers/:id/charges')
        chargesOf(@Param('id') id: string): Promise<AdminSubscriberAccount> {
            return this.rlsBypass.runWithBypass(() => this.accounts.accountOf(id));
        }
    }

    return GeneratedSubscriberAccountController;
}

/**
 * The operator's view of a subscriber's account, served in its record (`SC-ADM-037`).
 * Mounted where the platform keeps both the administration's tenants and a
 * charge journal.
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
