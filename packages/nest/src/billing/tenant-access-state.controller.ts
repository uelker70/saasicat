import {
    Controller,
    type ExecutionContext,
    Get,
    Inject,
    Optional,
    Req,
    UseGuards,
} from '@nestjs/common';
import type { PlanCatalogSettings, TenantAccessView } from '@saasicat/core';

import { ReadsItsState } from '../tenant-access/tenant-access-marks.js';
import { TenantAccessService } from '../tenant-access/tenant-access.service.js';
import { BillingPermissionGuard } from './billing-permission.guard.js';
import { ComposedTenantAuthGuard } from './composed-tenant-auth.guard.js';
import { InvoiceCollectionService } from './invoices/invoice-collection.service.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from './plan-catalog.module.js';
import { RouteContext } from './route-context.decorator.js';
import { tenantAccessViewFor } from './tenant-access-reading.js';
import { TENANT_ID_RESOLVER_TOKEN, type TenantIdResolver } from './tenant-billing.tokens.js';
import { tenantIdOf } from './tenant-id.js';

/**
 * `GET billing/access` — the tenant's state as every one of its users reads
 * it, in every state, suspended and being deleted included (`SC-ADM-054`):
 * what holds it back and from which day, the days an ended subscription leaves
 * (`SC-CANC-033`), and whether this reader can take the export
 * (`SC-PRIV-020`). Where the installation issues invoices and the reader holds
 * the billing permission, the same answer names the invoices by number and
 * says whether what is open can be paid here; whoever else reads it is told
 * neither, and is not refused (`SC-ADM-056`). The tenant is the session's.
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
        // Provided exactly where the tenant's invoices are mounted, so its
        // absence is the installation that issues none: nobody is told an
        // invoice by number there.
        @Optional()
        @Inject(BillingPermissionGuard)
        private readonly billingPermission: BillingPermissionGuard | null = null,
        // Where invoices are collected through a gateway; without it nothing
        // can be paid here.
        @Optional()
        @Inject(InvoiceCollectionService)
        private readonly collection: InvoiceCollectionService | null = null,
    ) {}

    @Get('access')
    @ReadsItsState()
    async state(
        @Req() request: unknown,
        @RouteContext() context: ExecutionContext,
    ): Promise<TenantAccessView> {
        const tenantId = tenantIdOf(this.tenantIdResolver, request);
        const holdsBillingPermission =
            this.billingPermission !== null && (await this.billingPermission.isHeldBy(context));
        return tenantAccessViewFor({
            access: this.access,
            settings: this.settings,
            tenantId,
            request,
            holdsBillingPermission,
            collects: this.collection !== null,
        });
    }
}
