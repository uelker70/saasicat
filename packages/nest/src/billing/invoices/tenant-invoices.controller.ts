import {
    Controller,
    Get,
    Inject,
    Optional,
    Param,
    Query,
    Req,
    StreamableFile,
    UseGuards,
} from '@nestjs/common';
import type { TenantContractConfirmations, TenantInvoicePage } from '@saasicat/core';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { BillingPermissionGuard } from '../billing-permission.guard.js';
import { ComposedTenantAuthGuard } from '../composed-tenant-auth.guard.js';
import { TENANT_ID_RESOLVER_TOKEN, type TenantIdResolver } from '../tenant-billing.tokens.js';
import { tenantIdOf } from '../tenant-id.js';
import { downloadOf } from './archived-download.js';
import { TenantInvoiceService } from './tenant-invoice.service.js';

/** The longest invoice id a page may go on after; an id is a uuid, far shorter. */
const MAX_ID_LENGTH = 200;

/** `GET billing/invoices` — the invoice the page goes on after. */
export class TenantInvoiceListQuery {
    @IsOptional()
    @IsString()
    @MaxLength(MAX_ID_LENGTH)
    after?: string;
}

/**
 * The tenant's invoices and contract confirmations, and their archived
 * documents, behind the billing permission for listing and downloading alike
 * (`SC-UI-023`): `GET billing/invoices`, `GET billing/invoices/:id/document`,
 * `GET billing/contracts` and `GET billing/contracts/:id/confirmation`. The
 * tenant is the session's; a document is the file archived when it was issued,
 * never rendered again (`SC-AUD-014`).
 */
@Controller('billing')
@UseGuards(ComposedTenantAuthGuard, BillingPermissionGuard)
export class TenantInvoicesController {
    constructor(
        @Inject(TenantInvoiceService) private readonly invoices: TenantInvoiceService,
        @Optional()
        @Inject(TENANT_ID_RESOLVER_TOKEN)
        private readonly tenantIdResolver: TenantIdResolver | null = null,
    ) {}

    @Get('invoices')
    page(
        @Req() request: unknown,
        @Query() query: TenantInvoiceListQuery,
    ): Promise<TenantInvoicePage> {
        return this.invoices.page(tenantIdOf(this.tenantIdResolver, request), query.after);
    }

    @Get('invoices/:id/document')
    async documentOf(@Req() request: unknown, @Param('id') id: string): Promise<StreamableFile> {
        const tenantId = tenantIdOf(this.tenantIdResolver, request);
        return downloadOf(await this.invoices.documentOf(tenantId, id), 'invoice');
    }

    @Get('contracts')
    confirmations(@Req() request: unknown): Promise<TenantContractConfirmations> {
        return this.invoices.confirmationsOf(tenantIdOf(this.tenantIdResolver, request));
    }

    @Get('contracts/:id/confirmation')
    async confirmationOf(
        @Req() request: unknown,
        @Param('id') id: string,
    ): Promise<StreamableFile> {
        const tenantId = tenantIdOf(this.tenantIdResolver, request);
        return downloadOf(await this.invoices.confirmationOf(tenantId, id), 'confirmation');
    }
}
