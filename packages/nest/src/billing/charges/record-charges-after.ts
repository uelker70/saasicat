import type { Logger } from '@nestjs/common';

import type { SubscriberChargeService } from './subscriber-charge.service.js';

/**
 * Brings the tenant's account up to date after a change the platform wrote.
 *
 * Non-fatal, like the contract freeze before it: the change is already
 * written, and every charge is derived from records that stay, so one this
 * call could not write is found again by the next — the application's renewal
 * job at the latest.
 */
export async function recordChargesAfter(
    charges: SubscriberChargeService | null,
    tenantId: string,
    change: string,
    logger: Logger,
): Promise<void> {
    if (!charges) return;
    try {
        await charges.recordDueCharges(tenantId);
    } catch (err) {
        logger.error(
            `Recording charges after ${change} failed (tenant ${tenantId}): ${String(err)}`,
        );
    }
}
