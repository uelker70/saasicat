import {
    Body,
    Controller,
    Get,
    HttpCode,
    Inject,
    NotFoundException,
    Optional,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import type { PaymentMethodType, SubscriberPaymentMethodRecord } from '@saasicat/core';
import { AUTH_ERROR_CODES } from '@saasicat/core';

import { BillingPermissionGuard } from '../billing/billing-permission.guard.js';
import { ComposedTenantAuthGuard } from '../billing/composed-tenant-auth.guard.js';
import {
    TENANT_ID_RESOLVER_TOKEN,
    USER_EMAIL_RESOLVER_TOKEN,
    type TenantIdResolver,
    type UserEmailResolver,
} from '../billing/tenant-billing.tokens.js';
import { codedError } from '../errors/coded-error.js';
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
 * permission for reading and changing alike.
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
    async current(@Req() request: unknown): Promise<{ paymentMethod: TenantPaymentMethodView | null }> {
        const method = await this.paymentMethods.current(this.tenantOf(request));
        return { paymentMethod: method ? viewOf(method) : null };
    }

    @Post('setup')
    @HttpCode(200)
    startSetup(
        @Req() request: unknown,
        @Body() body: StartPaymentMethodSetupDto,
    ): Promise<{ redirectUrl: string }> {
        return this.paymentMethods.startChange(this.tenantOf(request), {
            successUrl: body.successUrl,
            cancelUrl: body.cancelUrl,
            fallbackEmail: this.emailOf(request),
        });
    }

    private tenantOf(request: unknown): string {
        const tenantId = this.tenantIdResolver(request);
        if (!tenantId) throw new NotFoundException(codedError(AUTH_ERROR_CODES.TENANT_CONTEXT_MISSING));
        return tenantId;
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
