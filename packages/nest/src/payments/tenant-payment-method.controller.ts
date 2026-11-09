import {
    Body,
    Controller,
    Get,
    HttpCode,
    Inject,
    Optional,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import type { PaymentMethodType, SubscriberPaymentMethodRecord } from '@saasicat/core';

import { BillingPermissionGuard } from '../billing/billing-permission.guard.js';
import { ComposedTenantAuthGuard } from '../billing/composed-tenant-auth.guard.js';
import {
    TENANT_ID_RESOLVER_TOKEN,
    USER_EMAIL_RESOLVER_TOKEN,
    type TenantIdResolver,
    type UserEmailResolver,
} from '../billing/tenant-billing.tokens.js';
import { tenantIdOf } from '../billing/tenant-id.js';
import { StartsPayment } from '../tenant-access/tenant-access-marks.js';
import { StartPaymentMethodSetupDto } from './dto/start-payment-method-setup.dto.js';
import { SubscriberPaymentMethodService } from './subscriber-payment-method.service.js';

/** How a payment method in use is shown: what tells it apart, and nothing that reaches it at the gateway. */
export interface TenantPaymentMethodView {
    type: PaymentMethodType;
    brand: string | null;
    last4: string;
    expiryMonth: number | null;
    expiryYear: number | null;
    country: string | null;
    mandateReference: string | null;
    confirmedAt: string;
}

/**
 * `GET /billing/payment-method` and `POST /billing/payment-method/setup` — the
 * tenant's view of what its subscriber pays with, behind the billing
 * permission for reading and changing alike. Replacing it is one of the two
 * writes a read-only tenant makes, beside paying now, while one of its
 * subscriber's invoices is open (`SC-ADM-052`).
 */
@Controller('billing/payment-method')
@UseGuards(ComposedTenantAuthGuard, BillingPermissionGuard)
export class TenantPaymentMethodController {
    constructor(
        private readonly paymentMethods: SubscriberPaymentMethodService,
        @Inject(TENANT_ID_RESOLVER_TOKEN) private readonly tenantIdResolver: TenantIdResolver,
        @Optional()
        @Inject(USER_EMAIL_RESOLVER_TOKEN)
        private readonly userEmailResolver: UserEmailResolver | null = null,
    ) {}

    @Get()
    async current(
        @Req() request: unknown,
    ): Promise<{ paymentMethod: TenantPaymentMethodView | null }> {
        const method = await this.paymentMethods.current(
            tenantIdOf(this.tenantIdResolver, request),
        );
        return { paymentMethod: method ? viewOf(method) : null };
    }

    @Post('setup')
    @HttpCode(200)
    @StartsPayment()
    startSetup(
        @Req() request: unknown,
        @Body() body: StartPaymentMethodSetupDto,
    ): Promise<{ redirectUrl: string }> {
        return this.paymentMethods.startChange(tenantIdOf(this.tenantIdResolver, request), {
            successUrl: body.successUrl,
            cancelUrl: body.cancelUrl,
            fallbackEmail: this.emailOf(request),
        });
    }

    private emailOf(request: unknown): string | null {
        if (this.userEmailResolver) return this.userEmailResolver(request) ?? null;
        return (request as { user?: { email?: string | null } }).user?.email ?? null;
    }
}

function viewOf(method: SubscriberPaymentMethodRecord): TenantPaymentMethodView {
    return {
        type: method.type,
        brand: method.brand,
        last4: method.last4,
        expiryMonth: method.expiryMonth,
        expiryYear: method.expiryYear,
        country: method.country,
        mandateReference: method.mandateReference,
        confirmedAt: method.confirmedAt.toISOString(),
    };
}
