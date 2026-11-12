import {
    ConflictException,
    Controller,
    Get,
    HttpCode,
    Inject,
    Optional,
    Param,
    Post,
    Query,
    Req,
    StreamableFile,
    UseGuards,
} from '@nestjs/common';
import {
    PAYMENT_ERROR_CODES,
    installationZoneOf,
    tenantAccessViewOf,
    type PlanCatalogSettings,
    type TenantAccessView,
    type TenantAccount,
    type TenantContractConfirmations,
    type TenantInvoicePage,
    type TenantPaymentStarted,
} from '@saasicat/core';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { BillingPermissionGuard } from '../billing-permission.guard.js';
import { ComposedTenantAuthGuard } from '../composed-tenant-auth.guard.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from '../plan-catalog.module.js';
import { TENANT_ID_RESOLVER_TOKEN, type TenantIdResolver } from '../tenant-billing.tokens.js';
import { tenantIdOf } from '../tenant-id.js';
import { codedError } from '../../errors/coded-error.js';
import { ReadsItsState, StartsPayment } from '../../tenant-access/tenant-access-marks.js';
import { TenantAccessService } from '../../tenant-access/tenant-access.service.js';
import { downloadOf } from './archived-download.js';
import { InvoiceCollectionService } from './invoice-collection.service.js';
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
 * The tenant's account, invoices and contract confirmations, and their
 * archived documents, behind the billing permission for reading and
 * downloading alike (`SC-UI-023`): `GET billing/account`,
 * `GET billing/invoices`, `GET billing/invoices/:id/document`,
 * `GET billing/contracts` and `GET billing/contracts/:id/confirmation`;
 * paying what the account owes now, `POST billing/account/pay`
 * (`SC-PRIC-100`); and the tenant's state as a user who holds the permission
 * reads it, `GET billing/account/access` (`SC-ADM-054`). The tenant is the
 * session's; a document is the file archived when it was issued, never
 * rendered again (`SC-AUD-014`).
 */
@Controller('billing')
@UseGuards(ComposedTenantAuthGuard, BillingPermissionGuard)
export class TenantInvoicesController {
    constructor(
        @Inject(TenantInvoiceService) private readonly invoices: TenantInvoiceService,
        @Optional()
        @Inject(TENANT_ID_RESOLVER_TOKEN)
        private readonly tenantIdResolver: TenantIdResolver | null = null,
        // Where invoices are collected through a gateway; without it nothing
        // can be paid here.
        @Optional()
        @Inject(InvoiceCollectionService)
        private readonly collection: InvoiceCollectionService | null = null,
        @Optional()
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: Pick<PlanCatalogSettings, 'timeZone'> | null = null,
        @Optional()
        @Inject(TenantAccessService)
        private readonly access: TenantAccessService | null = null,
    ) {}

    /** What the subscriber owes and is owed, per currency (`SC-PRIC-049`). */
    @Get('account')
    account(@Req() request: unknown): Promise<TenantAccount> {
        return this.invoices.accountOf(tenantIdOf(this.tenantIdResolver, request));
    }

    /**
     * Pays every invoice still open now, with the payment method in use
     * (`SC-PRIC-100`) — the payment a read-only tenant may still start
     * (`SC-ADM-055`).
     */
    @Post('account/pay')
    @HttpCode(200)
    @StartsPayment()
    async pay(@Req() request: unknown): Promise<TenantPaymentStarted> {
        if (!this.collection) {
            throw new ConflictException(codedError(PAYMENT_ERROR_CODES.PAYMENTS_NOT_CONFIGURED));
        }
        return this.collection.payNow(tenantIdOf(this.tenantIdResolver, request));
    }

    /**
     * The tenant's state as `GET billing/access` answers it, and beside it the
     * invoices its reasons name by number and whether what is open can be paid
     * here (`SC-ADM-054`). Let through in every state, as that route is.
     */
    @Get('account/access')
    @ReadsItsState()
    async accessState(@Req() request: unknown): Promise<TenantAccessView> {
        const tenantId = tenantIdOf(this.tenantIdResolver, request);
        const asked = {
            timeZone: installationZoneOf(this.settings),
            holdsBillingPermission: true,
            mayPay: this.collection !== null,
        };
        if (!this.access) return tenantAccessViewOf({ state: 'open', holds: [] }, asked);
        return this.access.viewOf(tenantId, asked);
    }

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
