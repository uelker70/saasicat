import { Controller, Get, Inject, Optional, Req, UseGuards } from '@nestjs/common';
import {
    installationZoneOf,
    tenantAccessViewOf,
    type PlanCatalogSettings,
    type TenantAccessView,
} from '@saasicat/core';

import { ReadsItsState } from '../tenant-access/tenant-access-marks.js';
import { TenantAccessService } from '../tenant-access/tenant-access.service.js';
import { ComposedTenantAuthGuard } from './composed-tenant-auth.guard.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from './plan-catalog.module.js';
import { TENANT_ID_RESOLVER_TOKEN, type TenantIdResolver } from './tenant-billing.tokens.js';
import { tenantIdOf } from './tenant-id.js';

/**
 * `GET billing/access` — the tenant's state as every one of its users reads
 * it, in every state, suspended and being deleted included (`SC-ADM-054`):
 * what holds it back and from which day, without the invoices by number and
 * without paying, which are the billing permission's
 * (`GET billing/account/access`). The tenant is the session's.
 */
@Controller('billing')
@UseGuards(ComposedTenantAuthGuard)
export class TenantAccessStateController {
    constructor(
        @Optional()
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: Pick<PlanCatalogSettings, 'timeZone'> | null = null,
        @Optional()
        @Inject(TENANT_ID_RESOLVER_TOKEN)
        private readonly tenantIdResolver: TenantIdResolver | null = null,
        // Without it — a module wired by hand without `SaaSiCatModule` —
        // nothing records a reason, so the tenant is open.
        @Optional()
        @Inject(TenantAccessService)
        private readonly access: TenantAccessService | null = null,
    ) {}

    @Get('access')
    @ReadsItsState()
    async state(@Req() request: unknown): Promise<TenantAccessView> {
        const tenantId = tenantIdOf(this.tenantIdResolver, request);
        const asked = {
            timeZone: installationZoneOf(this.settings),
            holdsBillingPermission: false,
            mayPay: false,
        };
        if (!this.access) return tenantAccessViewOf({ state: 'open', holds: [] }, asked);
        return this.access.viewOf(tenantId, asked);
    }
}
