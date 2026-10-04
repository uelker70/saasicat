import {
    Body,
    Controller,
    Get,
    Inject,
    NotFoundException,
    Optional,
    Patch,
    Req,
    UseGuards,
} from '@nestjs/common';
import type { SubscriberRecord } from '@saasicat/core';
import { AUTH_ERROR_CODES } from '@saasicat/core';

import { BillingPermissionGuard } from '../billing/billing-permission.guard.js';
import { ComposedTenantAuthGuard } from '../billing/composed-tenant-auth.guard.js';
import {
    AUDIT_CONTEXT_RESOLVER_TOKEN,
    TENANT_ID_RESOLVER_TOKEN,
    TENANT_SELF_SERVICE_CONTEXT,
    USER_EMAIL_RESOLVER_TOKEN,
    USER_ID_RESOLVER_TOKEN,
    type AuditContextResolver,
    type TenantIdResolver,
    type UserEmailResolver,
    type UserIdResolver,
} from '../billing/tenant-billing.tokens.js';
import { actorFromRequest, actorTagOf } from '../core/web-audit.js';
import { codedError } from '../errors/coded-error.js';
import { SubscriberService } from '../subscriber/subscriber.service.js';
import { ChangeBillingDetailsDto } from './dto/change-billing-details.dto.js';

/** The subscriber as its tenant sees it in its billing area. */
export interface TenantBillingDetailsView {
    customerNumber: string;
    legalName: string;
    vatId: string | null;
    taxNumber: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
    invoiceEmail: string | null;
}

/**
 * `GET /billing/details` and `PATCH /billing/details` — whom the tenant's
 * subscription is billed to, behind the billing permission for reading and
 * changing alike. The contact details change here; the legal name and the tax
 * identifiers are shown and corrected by the operator (`SC-SUB-017`). A change
 * names the user who made it, derived the way the audit log derives it: the
 * country is part of the tax origin, and its change is recorded with who made
 * it.
 */
@Controller('billing/details')
@UseGuards(ComposedTenantAuthGuard, BillingPermissionGuard)
export class TenantBillingDetailsController {
    constructor(
        @Inject(SubscriberService) private readonly subscribers: SubscriberService,
        @Inject(TENANT_ID_RESOLVER_TOKEN) private readonly tenantIdResolver: TenantIdResolver,
        @Optional()
        @Inject(USER_ID_RESOLVER_TOKEN)
        private readonly userIdResolver: UserIdResolver | null = null,
        @Optional()
        @Inject(USER_EMAIL_RESOLVER_TOKEN)
        private readonly userEmailResolver: UserEmailResolver | null = null,
        @Optional()
        @Inject(AUDIT_CONTEXT_RESOLVER_TOKEN)
        private readonly auditContextResolver: AuditContextResolver | null = null,
    ) {}

    @Get()
    async current(@Req() request: unknown): Promise<{ details: TenantBillingDetailsView }> {
        const subscriber = await this.subscribers.requireForTenant(this.tenantOf(request));
        return { details: viewOf(subscriber) };
    }

    @Patch()
    async change(
        @Req() request: unknown,
        @Body() body: ChangeBillingDetailsDto,
    ): Promise<{ details: TenantBillingDetailsView }> {
        const subscriber = await this.subscribers.changeContactOfTenant(
            this.tenantOf(request),
            body,
            this.actorOf(request),
        );
        return { details: viewOf(subscriber) };
    }

    /** The tenant's user behind a request, as the audit log tags them. */
    private actorOf(request: unknown): string {
        return actorTagOf(
            actorFromRequest(
                request,
                {
                    userId: this.userIdResolver,
                    email: this.userEmailResolver,
                    context: this.auditContextResolver,
                },
                TENANT_SELF_SERVICE_CONTEXT,
            ),
        );
    }

    private tenantOf(request: unknown): string {
        const tenantId = this.tenantIdResolver(request);
        if (!tenantId)
            throw new NotFoundException(codedError(AUTH_ERROR_CODES.TENANT_CONTEXT_MISSING));
        return tenantId;
    }
}

function viewOf(subscriber: SubscriberRecord): TenantBillingDetailsView {
    return {
        customerNumber: subscriber.customerNumber,
        legalName: subscriber.legalName,
        vatId: subscriber.vatId,
        taxNumber: subscriber.taxNumber,
        addressLine1: subscriber.addressLine1,
        addressLine2: subscriber.addressLine2,
        postalCode: subscriber.postalCode,
        city: subscriber.city,
        country: subscriber.country,
        invoiceEmail: subscriber.invoiceEmail,
    };
}
