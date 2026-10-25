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
    Query,
    Req,
    type Type,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import {
    RECONCILIATION_NOTE_MAX_LENGTH,
    type AdminReconciliationCase,
    type AdminReconciliationCases,
    type AdminSubscriberPayments,
    type ReconciliationCaseState,
    type RlsBypassPort,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { EnforceMfa } from '../../admin/enforce-mfa.decorator.js';
import { UseRouteGuards } from '../../admin/use-route-guards.decorator.js';
import { WebAuditLogger } from '../../core/web-audit.js';
import { AllowDuringMaintenance } from '../../maintenance/allow-during-maintenance.js';
import { SubscriberReconciliationService } from './subscriber-reconciliation.service.js';

const STATES: readonly ReconciliationCaseState[] = ['open', 'closed'];
/** The longest case id a page is continued after. */
const MAX_ID_LENGTH = 200;
/** Something besides blanks. */
const NOT_BLANK = /\S/;

/** Which cases a page of the list reads. */
export class ReconciliationListQuery {
    @IsOptional()
    @IsIn(STATES)
    state?: ReconciliationCaseState;

    @IsOptional()
    @IsString()
    @MaxLength(MAX_ID_LENGTH)
    after?: string;
}

/** Why the operator closes a case. */
export class CloseReconciliationCaseDto {
    @IsString()
    @Matches(NOT_BLANK, { message: 'note must say why the case is closed' })
    @MaxLength(RECONCILIATION_NOTE_MAX_LENGTH)
    note!: string;
}

export interface SubscriberReconciliationModuleOptions {
    /** The same chain the tenant routes of the administration run behind. */
    guards: Array<Type<CanActivate>>;
    /**
     * Must bring `SubscriberReconciliationService` into scope — the module
     * that already provides it, passed as the very object the application
     * imports. The `RlsBypassPort` and the second factor have to be visible
     * too; `SaaSiCatModule` provides them globally.
     */
    imports: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

function buildSubscriberReconciliationController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin')
    @AllowDuringMaintenance()
    @UseRouteGuards(...guards)
    class GeneratedSubscriberReconciliationController {
        constructor(
            @Inject(SubscriberReconciliationService)
            private readonly reconciliation: SubscriberReconciliationService,
            @Inject(WebAuditLogger)
            private readonly audit: WebAuditLogger,
            // Required: without it the reads would run in the request's
            // row-level scope, and a case a policy hides would read as none.
            @Inject(RLS_BYPASS_PORT_TOKEN)
            private readonly rlsBypass: RlsBypassPort,
        ) {}

        /** One page of the cases to reconcile, open by default, the oldest first. */
        @Get('reconciliation')
        cases(@Query() query: ReconciliationListQuery): Promise<AdminReconciliationCases> {
            return this.rlsBypass.runWithBypass(() =>
                this.reconciliation.cases(query.state ?? 'open', query.after),
            );
        }

        /**
         * Closes an open case with the operator's note, with the second
         * factor, and answers the case as it stands after it.
         */
        @Post('reconciliation/:caseId/close')
        @HttpCode(200)
        @EnforceMfa()
        close(
            @Param('caseId') caseId: string,
            @Body() body: CloseReconciliationCaseDto,
            @Req() request: unknown,
        ): Promise<AdminReconciliationCase> {
            return this.rlsBypass.runWithBypass(async () => {
                const closed = await this.reconciliation.close(
                    caseId,
                    body.note,
                    this.audit.actorTagFromRequest(request),
                );
                await this.audit.logFromRequest(
                    request,
                    'SubscriberReconciliationCase',
                    caseId,
                    'SUBSCRIBER_RECONCILIATION_CASE_CLOSED',
                    {
                        tenantId: closed.record.tenantId,
                        kind: closed.record.kind,
                        amount: closed.record.amount,
                        currency: closed.record.currency,
                        note: closed.record.note,
                    },
                );
                return closed.case;
            });
        }

        /** The subscriber's invoices with what each still owes, and its open cases. */
        @Get('subscribers/:id/payments')
        paymentsOf(@Param('id') id: string): Promise<AdminSubscriberPayments> {
            return this.rlsBypass.runWithBypass(() => this.reconciliation.paymentsOf(id));
        }
    }

    return GeneratedSubscriberReconciliationController;
}

/**
 * The operator's list of what the gateway reported and nothing matched, the
 * closing of a case with a note, and a subscriber's invoices with what each
 * still owes beside its open cases. Mounted where the platform shows tenants
 * and records what invoices' collections brought.
 */
@Module({})
export class SubscriberReconciliationModule {
    static forRoot(options: SubscriberReconciliationModuleOptions): DynamicModule {
        return {
            module: SubscriberReconciliationModule,
            imports: options.imports,
            providers: [WebAuditLogger],
            controllers: [buildSubscriberReconciliationController(options.guards)],
        };
    }
}
