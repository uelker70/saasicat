// `POST billing/subscription/return` and its preview — a tenant whose
// subscription ended takes out a new one before its deletion day
// (`SC-CANC-034`). The tenant is the session's, never the body's, and the rules
// are the return's (`SubscriptionReturnService`): this controller says who
// asks, and hands out the days of the moments it answers with.
//
// Its own controller rather than a route of `TenantBillingController`, which
// carries every other tenant billing route already.

import {
    Body,
    Controller,
    ForbiddenException,
    HttpCode,
    HttpStatus,
    Inject,
    Optional,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import {
    TENANT_ACCESS_ERROR_CODES,
    installationZoneOf,
    withDays,
    type PlanCatalogSettings,
    type WithDays,
} from '@saasicat/core';

import { codedError } from '../errors/coded-error.js';
import { Returns, WritesNothing } from '../tenant-access/tenant-access-marks.js';
import { TenantAccessService } from '../tenant-access/tenant-access.service.js';
import { ComposedTenantAuthGuard } from './composed-tenant-auth.guard.js';
import { PreviewPlanChangeDto } from './dto/tenant-billing.dto.js';
import { SubscriptionReturnDto } from './dto/subscription-return.dto.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from './plan-catalog.module.js';
import {
    SubscriptionReturnService,
    type SubscriptionReturnRefused,
    type SubscriptionReturnTerms,
    type SubscriptionReturned,
} from './subscription-return.service.js';
import { TenantAdminGuard } from './tenant-admin.guard.js';
import {
    requireTenantUserId,
    tenantActorOf,
    type TenantAuditResolvers,
} from './tenant-audit-actor.js';
import {
    AUDIT_CONTEXT_RESOLVER_TOKEN,
    TENANT_ID_RESOLVER_TOKEN,
    USER_EMAIL_RESOLVER_TOKEN,
    USER_ID_RESOLVER_TOKEN,
    type AuditContextResolver,
    type TenantIdResolver,
    type UserEmailResolver,
    type UserIdResolver,
} from './tenant-billing.tokens.js';
import { tenantIdOf } from './tenant-id.js';
import { isTheOperator } from './tenant-roles.js';

/** The moments a return answers with, each handed out with its days in the installation's zone. */
const MOMENTS = ['periodStart', 'periodEnd'] as const;

type Moment = (typeof MOMENTS)[number];

/** The subscription a tenant came back on, with the days of its first period. */
export type SubscriptionReturnedWithDays = WithDays<SubscriptionReturned, Moment>;

/** What a tenant is shown before it comes back, with the days of the first period; or why it cannot. */
export type SubscriptionReturnPreviewWithDays =
    WithDays<SubscriptionReturnTerms, Moment> | SubscriptionReturnRefused;

@Controller('billing/subscription/return')
@UseGuards(ComposedTenantAuthGuard)
export class TenantSubscriptionReturnController {
    // Explicit @Inject: tsup/esbuild emit no `design:paramtypes`.
    constructor(
        @Inject(SubscriptionReturnService) private readonly returns: SubscriptionReturnService,
        @Optional()
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: Pick<PlanCatalogSettings, 'timeZone'> | null = null,
        @Optional()
        @Inject(TENANT_ID_RESOLVER_TOKEN)
        private readonly tenantIdResolver: TenantIdResolver | null = null,
        @Optional()
        @Inject(USER_ID_RESOLVER_TOKEN)
        private readonly userIdResolver: UserIdResolver | null = null,
        @Optional()
        @Inject(USER_EMAIL_RESOLVER_TOKEN)
        private readonly userEmailResolver: UserEmailResolver | null = null,
        @Optional()
        @Inject(AUDIT_CONTEXT_RESOLVER_TOKEN)
        private readonly auditContextResolver: AuditContextResolver | null = null,
        // Says whether the application's check let the request through as the
        // operator acting as the tenant; without it only a user holding
        // `SUPER_ADMIN` is the operator.
        @Optional()
        @Inject(TenantAccessService)
        private readonly access: TenantAccessService | null = null,
    ) {}

    /**
     * What the tenant would come back on, and pay — a change's preview, open
     * to every signed-in user of the tenant (`SC-ADM-026`) — or why it cannot.
     */
    @Post('preview')
    @HttpCode(HttpStatus.OK)
    @WritesNothing()
    async preview(
        @Req() req: unknown,
        @Body() dto: PreviewPlanChangeDto,
    ): Promise<SubscriptionReturnPreviewWithDays> {
        const preview = await this.returns.preview(
            tenantIdOf(this.tenantIdResolver, req),
            { plan: dto.plan, billingCycle: dto.billingCycle },
            new Date(),
        );
        return preview.refusal === null ? withDays(preview, MOMENTS, this.zone()) : preview;
    }

    /**
     * Takes out the new subscription, as the tenant's own administrator, where
     * the deletion day its page showed, if it sent one, is still the one its
     * end names. The operator acting as the tenant is refused.
     */
    @Post()
    @UseGuards(TenantAdminGuard)
    @Returns()
    async takeOut(
        @Req() req: unknown,
        @Body() dto: SubscriptionReturnDto,
    ): Promise<SubscriptionReturnedWithDays> {
        if (isTheOperator(req, this.access?.actsAsOperator(req) ?? false)) {
            throw new ForbiddenException(
                codedError(TENANT_ACCESS_ERROR_CODES.TENANT_RETURN_NOT_FOR_OPERATOR),
            );
        }
        const resolvers = this.resolvers();
        const returned = await this.returns.takeOut(
            tenantIdOf(this.tenantIdResolver, req),
            {
                plan: dto.plan,
                billingCycle: dto.billingCycle,
                expectedDeletesOn: dto.expectedDeletesOn,
            },
            tenantActorOf(req, requireTenantUserId(req, resolvers), resolvers),
            new Date(),
        );
        return withDays(returned, MOMENTS, this.zone());
    }

    private zone(): string {
        return installationZoneOf(this.settings);
    }

    private resolvers(): TenantAuditResolvers {
        return {
            userId: this.userIdResolver,
            email: this.userEmailResolver,
            context: this.auditContextResolver,
        };
    }
}
