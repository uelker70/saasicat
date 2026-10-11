// The tenant's side of a feature withdrawal: what its subscription was told
// and what that means now, and ending at once — the subscription, or one
// booking — with what it would credit shown first.
//
// The tenant comes from the authenticated request, never from the body, and
// whether an end is open is decided by `EndAtOnceService` from what the
// subscription was told.

import {
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Inject,
    Logger,
    NotFoundException,
    Optional,
    Param,
    ParseUUIDPipe,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import {
    AUTH_ERROR_CODES,
    type EndAtOncePreview,
    type EndedAtOnce,
    type TenantFeatureWithdrawal,
} from '@saasicat/core';

import { AdminAuditService } from '../admin/admin-audit.service.js';
import { ComposedTenantAuthGuard } from './composed-tenant-auth.guard.js';
import { EndAtOnceService } from './end-at-once.service.js';
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

interface TenantRequest {
    user?: { tenantId?: string } | null;
}

@Controller('billing/feature-withdrawals')
@UseGuards(ComposedTenantAuthGuard)
export class FeatureWithdrawalTenantController {
    private readonly logger = new Logger(FeatureWithdrawalTenantController.name);

    // Explicit @Inject: tsup/esbuild emit no `design:paramtypes`.
    constructor(
        @Inject(EndAtOnceService) private readonly endings: EndAtOnceService,
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
        @Optional()
        @Inject(AdminAuditService)
        private readonly audit: AdminAuditService | null = null,
    ) {}

    /** The withdrawals the subscription was told of that are not over, and what each means now. */
    @Get()
    list(@Req() req: unknown): Promise<TenantFeatureWithdrawal[]> {
        return this.endings.withdrawalsOf(this.tenantOf(req), new Date());
    }

    /** What ending the subscription at once now would credit. */
    @Get(':id/end')
    @UseGuards(TenantAdminGuard)
    previewEnd(@Req() req: unknown, @Param('id') withdrawalId: string): Promise<EndAtOncePreview> {
        return this.endings.preview(this.tenantOf(req), withdrawalId, null, new Date());
    }

    /** Ends the subscription at once, and every add-on with it. */
    @Post(':id/end')
    @UseGuards(TenantAdminGuard)
    @HttpCode(HttpStatus.OK)
    async end(@Req() req: unknown, @Param('id') withdrawalId: string): Promise<EndedAtOnce> {
        const tenantId = this.tenantOf(req);
        const userId = requireTenantUserId(req, this.resolvers());
        const ended = await this.endings.end(tenantId, withdrawalId, null, new Date());
        await this.record(req, userId, 'Subscription', tenantId, 'END_SUBSCRIPTION_AT_ONCE', ended);
        return ended;
    }

    /** What ending one booking at once now would credit. */
    @Get(':id/bookings/:subscriptionBundleId/end')
    @UseGuards(TenantAdminGuard)
    previewBookingEnd(
        @Req() req: unknown,
        @Param('id') withdrawalId: string,
        @Param('subscriptionBundleId', new ParseUUIDPipe()) subscriptionBundleId: string,
    ): Promise<EndAtOncePreview> {
        return this.endings.preview(
            this.tenantOf(req),
            withdrawalId,
            subscriptionBundleId,
            new Date(),
        );
    }

    /** Ends one booking at once. */
    @Post(':id/bookings/:subscriptionBundleId/end')
    @UseGuards(TenantAdminGuard)
    @HttpCode(HttpStatus.OK)
    async endBooking(
        @Req() req: unknown,
        @Param('id') withdrawalId: string,
        @Param('subscriptionBundleId', new ParseUUIDPipe()) subscriptionBundleId: string,
    ): Promise<EndedAtOnce> {
        const tenantId = this.tenantOf(req);
        const userId = requireTenantUserId(req, this.resolvers());
        const ended = await this.endings.end(
            tenantId,
            withdrawalId,
            subscriptionBundleId,
            new Date(),
        );
        await this.record(
            req,
            userId,
            'SubscriptionBundle',
            subscriptionBundleId,
            'END_ADD_ON_AT_ONCE',
            ended,
        );
        return ended;
    }

    private tenantOf(req: unknown): string {
        const tenantId = this.tenantIdResolver
            ? this.tenantIdResolver(req)
            : ((req as TenantRequest).user?.tenantId ?? null);
        if (!tenantId) {
            throw new NotFoundException({
                code: AUTH_ERROR_CODES.TENANT_CONTEXT_MISSING,
                message: 'No tenant ID found on the request',
            });
        }
        return tenantId;
    }

    private resolvers(): TenantAuditResolvers {
        return {
            userId: this.userIdResolver,
            email: this.userEmailResolver,
            context: this.auditContextResolver,
        };
    }

    /** Best effort: the end stands whether or not its record could be written (`SC-AUD-004`). */
    private async record(
        req: unknown,
        userId: string,
        entity: string,
        entityId: string,
        action: string,
        ended: EndedAtOnce,
    ): Promise<void> {
        if (!this.audit) return;
        try {
            await this.audit.log({
                actor: tenantActorOf(req, userId, this.resolvers()),
                entity,
                entityId,
                action,
                changes: {
                    withdrawalId: ended.withdrawalId,
                    endsAt: ended.endsAt,
                    creditNet: ended.creditNet,
                    currency: ended.currency,
                },
            });
        } catch (error) {
            this.logger.error(
                `The end at once of ${entity} ${entityId} stands, but writing its audit entry failed.`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }
}
