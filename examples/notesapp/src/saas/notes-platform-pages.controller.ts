import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard } from '@saasicat/nest/admin';

import { SuspendTenantDto } from './admin-pages.dto';
import {
    NotesPlatformPagesService,
    type AuditListRow,
    type SubscriptionListRow,
    type TenantDetailData,
    type TenantListRow,
    type UserListRow,
} from './notes-platform-pages.service';

/**
 * App-owned SuperAdmin endpoints for the domain pages (tenants, users, audit,
 * subscriptions). Tenant/User/Note/Subscription are app tables, so the platform
 * does not serve them — these controllers do, under the same `/api/v1` prefix
 * and behind `SuperAdminGuard` (reads `platformRole === SUPER_ADMIN`, which the
 * global DemoAuthGuard sets from the `x-demo-role` header).
 *
 * Structural blueprint: autohauspro `backend/src/admin/admin.controller.ts`.
 */
interface AdminRequest {
    user: { userId: string; tenantId: string; platformRole?: string };
}

@Controller('admin')
@UseGuards(SuperAdminGuard)
export class NotesPlatformPagesController {
    constructor(private readonly pages: NotesPlatformPagesService) {}

    // ─── Tenants ────────────────────────────────────────────────────────

    @Get('tenants')
    listTenants(
        @Query() query: { status?: string; plan?: string; search?: string },
    ): Promise<TenantListRow[]> {
        return this.pages.listTenants({
            status: query.status,
            plan: query.plan,
            search: query.search,
        });
    }

    @Get('tenants/:slug')
    getTenant(@Param('slug') slug: string): Promise<TenantDetailData> {
        return this.pages.getTenantDetail(slug);
    }

    @Post('tenants/:slug/suspend')
    suspendTenant(
        @Req() req: AdminRequest,
        @Param('slug') slug: string,
        @Body() dto: SuspendTenantDto,
    ): Promise<{ ok: true; slug: string; isActive: boolean; status: string | null }> {
        return this.pages.suspendTenant(slug, dto.reason, req.user.userId);
    }

    @Post('tenants/:slug/reactivate')
    reactivateTenant(
        @Req() req: AdminRequest,
        @Param('slug') slug: string,
    ): Promise<{ ok: true; slug: string; isActive: boolean; status: string | null }> {
        return this.pages.reactivateTenant(slug, req.user.userId);
    }

    // ─── Users ──────────────────────────────────────────────────────────

    @Get('users')
    listUsers(@Query() query: { q?: string; tenant?: string }): Promise<UserListRow[]> {
        return this.pages.listUsers({ q: query.q, tenant: query.tenant });
    }

    // ─── Audit ──────────────────────────────────────────────────────────

    @Get('audit')
    listAudit(
        @Query()
        query: {
            actor?: string;
            action?: string;
            entity?: string;
            since?: string;
            limit?: string;
        },
    ): Promise<AuditListRow[]> {
        return this.pages.listAudit({
            actor: query.actor,
            action: query.action,
            entity: query.entity,
            since: query.since,
            limit: query.limit ? Number.parseInt(query.limit, 10) : undefined,
        });
    }

    // ─── Subscriptions ──────────────────────────────────────────────────

    @Get('subscriptions')
    listSubscriptions(): Promise<SubscriptionListRow[]> {
        return this.pages.listSubscriptions();
    }
}
