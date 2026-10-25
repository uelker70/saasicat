import {
    Body,
    type CanActivate,
    Controller,
    type DynamicModule,
    type ForwardReference,
    Get,
    HttpCode,
    Inject,
    Module,
    Param,
    Post,
    Req,
    type Type,
} from '@nestjs/common';
import {
    IsISO8601,
    IsNumber,
    IsOptional,
    IsPositive,
    IsString,
    Matches,
    Max,
    MaxLength,
    ValidateIf,
} from 'class-validator';
import type { AdminSubscriberCredits, CalendarDay, RlsBypassPort } from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { EnforceMfa } from '../../admin/enforce-mfa.decorator.js';
import { UseRouteGuards } from '../../admin/use-route-guards.decorator.js';
import { WebAuditLogger } from '../../core/web-audit.js';
import { AllowDuringMaintenance } from '../../maintenance/allow-during-maintenance.js';
import { SubscriberCreditService } from './subscriber-credit.service.js';

/** The longest reference a payout is recorded with, such as a transfer's. */
const MAX_REFERENCE_LENGTH = 200;
const MAX_NOTE_LENGTH = 500;
/** The largest amount the credit columns hold, `numeric(12, 2)`. */
const MAX_AMOUNT = 9_999_999_999.99;
/** A day as `YYYY-MM-DD`, and nothing else: a payout left on a day, not at a moment. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Something besides blanks. */
const NOT_BLANK = /\S/;

/** A payout the operator made outside the gateway against one credit. */
export class RecordSubscriberPayoutDto {
    // To the cent: a payout is recorded as the bank statement names it.
    @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
    @IsPositive()
    @Max(MAX_AMOUNT)
    amount!: number;

    @IsString()
    @Matches(NOT_BLANK, { message: 'reference must name the transfer' })
    @MaxLength(MAX_REFERENCE_LENGTH)
    reference!: string;

    @IsString()
    @Matches(DAY_PATTERN, { message: 'paidOn must be a day, YYYY-MM-DD' })
    @IsISO8601({ strict: true })
    paidOn!: CalendarDay;

    @IsOptional()
    @ValidateIf((_, value: unknown) => value !== null)
    @IsString()
    @MaxLength(MAX_NOTE_LENGTH)
    note?: string | null;
}

export interface SubscriberCreditModuleOptions {
    /** The same chain the tenant routes of the administration run behind. */
    guards: Array<Type<CanActivate>>;
    /**
     * Must bring `SubscriberCreditService` into scope — the module that
     * already provides it, passed as the very object the application imports.
     * The `RlsBypassPort` and the second factor have to be visible too;
     * `SaaSiCatModule` provides them globally.
     */
    imports: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

function buildSubscriberCreditController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin')
    @AllowDuringMaintenance()
    @UseRouteGuards(...guards)
    class GeneratedSubscriberCreditController {
        constructor(
            @Inject(SubscriberCreditService)
            private readonly credits: SubscriberCreditService,
            @Inject(WebAuditLogger)
            private readonly audit: WebAuditLogger,
            // Required: without it the reads would run in the request's
            // row-level scope, and a credit a policy hides would read as none.
            @Inject(RLS_BYPASS_PORT_TOKEN)
            private readonly rlsBypass: RlsBypassPort,
        ) {}

        /** The subscriber's credits, with what paid each out and what is open. */
        @Get('subscribers/:id/credits')
        creditsOf(@Param('id') id: string): Promise<AdminSubscriberCredits> {
            return this.rlsBypass.runWithBypass(() => this.credits.creditsOf(id));
        }

        /**
         * Records a payout the operator made outside the gateway against one
         * of the subscriber's credits, with the second factor, and answers the
         * credits as they stand after it.
         */
        @Post('subscribers/:id/credits/:creditId/payouts')
        @HttpCode(200)
        @EnforceMfa()
        payOut(
            @Param('id') id: string,
            @Param('creditId') creditId: string,
            @Body() body: RecordSubscriberPayoutDto,
            @Req() request: unknown,
        ): Promise<AdminSubscriberCredits> {
            return this.rlsBypass.runWithBypass(async () => {
                const recorded = await this.credits.payOut(
                    id,
                    creditId,
                    body,
                    this.audit.actorTagFromRequest(request),
                );
                await this.audit.logFromRequest(
                    request,
                    'SubscriberCredit',
                    creditId,
                    'SUBSCRIBER_CREDIT_PAID_OUT',
                    {
                        subscriberId: id,
                        amount: recorded.entry.amount,
                        reference: recorded.entry.reference,
                        paidOn: recorded.entry.paidOn,
                    },
                );
                return recorded.credits;
            });
        }
    }

    return GeneratedSubscriberCreditController;
}

/**
 * The operator's view of a subscriber's credits, and the payout recorded
 * against one, served in the subscriber's record. Mounted where the platform
 * shows tenants and records what invoices' collections brought.
 */
@Module({})
export class SubscriberCreditModule {
    static forRoot(options: SubscriberCreditModuleOptions): DynamicModule {
        return {
            module: SubscriberCreditModule,
            imports: options.imports,
            providers: [WebAuditLogger],
            controllers: [buildSubscriberCreditController(options.guards)],
        };
    }
}
