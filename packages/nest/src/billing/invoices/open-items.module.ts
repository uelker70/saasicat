import {
    type CanActivate,
    Controller,
    type DynamicModule,
    type ForwardReference,
    Get,
    Inject,
    Module,
    Query,
    type Type,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type {
    AdminOpenCreditPage,
    AdminOpenInvoicePage,
    AdminOpenItemTotals,
    RlsBypassPort,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { UseRouteGuards } from '../../admin/use-route-guards.decorator.js';
import { AllowDuringMaintenance } from '../../maintenance/allow-during-maintenance.js';
import { OpenItemsService } from './open-items.service.js';

/** Longer than any id a store hands out; an `after` beyond it names nothing. */
const MAX_ID_LENGTH = 200;

/** `GET admin/open-credits?after=…` — one page of the credits the operator still owes. */
export class OpenCreditsQueryDto {
    @IsOptional()
    @IsString()
    @MaxLength(MAX_ID_LENGTH)
    after?: string;
}

/** `GET admin/open-items?overdue=true&after=…` — one page of the invoices that still owe. */
export class OpenInvoicesQueryDto extends OpenCreditsQueryDto {
    @IsOptional()
    @IsIn(['true', 'false', true, false])
    overdue?: 'true' | 'false' | boolean;
}

export interface OpenItemsModuleOptions {
    /** The same chain the tenant routes of the administration run behind. */
    guards: Array<Type<CanActivate>>;
    /**
     * Must bring `OpenItemsService` into scope — the tenant billing module
     * that already provides it, passed as the very object the application
     * imports. The `RlsBypassPort` has to be visible too; `SaaSiCatModule`
     * provides it globally.
     */
    imports: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

function buildOpenItemsController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin')
    @AllowDuringMaintenance()
    @UseRouteGuards(...guards)
    class GeneratedOpenItemsController {
        constructor(
            @Inject(OpenItemsService)
            private readonly openItems: OpenItemsService,
            // Required rather than optional: without it the open items would be
            // read in the request's row-level scope, which an operator's
            // request has none of. Missing, the module does not start.
            @Inject(RLS_BYPASS_PORT_TOKEN)
            private readonly rlsBypass: RlsBypassPort,
        ) {}

        /**
         * One page of the invoices that still owe something, the oldest due
         * date first, overdue ones alone where asked (`SC-ADM-044`).
         */
        @Get('open-items')
        invoices(@Query() query: OpenInvoicesQueryDto): Promise<AdminOpenInvoicePage> {
            return this.rlsBypass.runWithBypass(() =>
                this.openItems.invoicesPage({
                    // A query string carries text: only `true` asks for overdue ones alone.
                    overdue: String(query.overdue) === 'true',
                    after: query.after,
                }),
            );
        }

        /** One page of the credits the operator still owes, the oldest first (`SC-ADM-044`). */
        @Get('open-credits')
        credits(@Query() query: OpenCreditsQueryDto): Promise<AdminOpenCreditPage> {
            return this.rlsBypass.runWithBypass(() =>
                this.openItems.creditsPage({ after: query.after }),
            );
        }

        /** What the open invoices and credits add up to per currency (`SC-ADM-044`). */
        @Get('open-item-totals')
        totals(): Promise<AdminOpenItemTotals> {
            return this.rlsBypass.runWithBypass(() => this.openItems.totals());
        }
    }

    return GeneratedOpenItemsController;
}

/**
 * The operator's open items: the invoices that still owe and the credits the
 * operator still owes, with their totals. Mounted where the subscribers'
 * credits and the cases to reconcile are; a credit is paid out at the route
 * the record's credits are paid out at.
 */
@Module({})
export class OpenItemsModule {
    static forRoot(options: OpenItemsModuleOptions): DynamicModule {
        return {
            module: OpenItemsModule,
            imports: options.imports,
            controllers: [buildOpenItemsController(options.guards)],
        };
    }
}
