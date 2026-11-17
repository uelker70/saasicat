import { Controller, Get, Inject, Optional, Req, UseGuards } from '@nestjs/common';
import type { TenantKeepView } from '@saasicat/core';

import { ComposedTenantAuthGuard } from './composed-tenant-auth.guard.js';
import { TenantKeepReadingService } from './deletion/tenant-keep-reading.service.js';
import { TENANT_ID_RESOLVER_TOKEN, type TenantIdResolver } from './tenant-billing.tokens.js';
import { tenantIdOf } from './tenant-id.js';

/**
 * `GET billing/access/keep` — what the tenant keeps for obligations of its
 * own, for every one of its users, while its subscription's end holds it to
 * reading (`SC-PRIV-022`). The tenant is the session's, never a value the
 * request carries.
 */
@Controller('billing')
@UseGuards(ComposedTenantAuthGuard)
export class TenantKeepController {
    constructor(
        @Inject(TenantKeepReadingService) private readonly reading: TenantKeepReadingService,
        @Optional()
        @Inject(TENANT_ID_RESOLVER_TOKEN)
        private readonly tenantIdResolver: TenantIdResolver | null = null,
    ) {}

    // No access mark: it reads the application's data on the tenant, not the
    // tenant's state, so a suspension or a deletion under way refuses it as it
    // refuses every read, and the read-only period it is meant for lets it
    // through as a `GET`.
    @Get('access/keep')
    async keep(@Req() request: unknown): Promise<TenantKeepView> {
        return this.reading.linesFor(tenantIdOf(this.tenantIdResolver, request));
    }
}
