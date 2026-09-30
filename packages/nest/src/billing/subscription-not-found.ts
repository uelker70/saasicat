import { NotFoundException } from '@nestjs/common';
import { BILLING_ERROR_CODES } from '@saasicat/core';

/** The refusal for a tenant that has no subscription, wherever one is read. */
export function subscriptionNotFound(tenantId: string): NotFoundException {
    return new NotFoundException({
        code: BILLING_ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
        message: `No subscription for tenant ${tenantId}`,
        params: { tenantId },
    });
}
