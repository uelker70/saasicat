// Binding a subscription from one version of a retirement to the other: onto
// the replacement — the move at the date, the switch before it — and back onto
// the version retired, where the contract that has to come with either could
// not be written. One write for all three, so they claim the row the same way.

import type { Logger } from '@nestjs/common';
import type {
    ImmediatePlanChangeInput,
    RetiredVersionRef,
    SubscriptionUsageRecord,
    TenantSubscriptionWritePort,
    VersionRetiredNotice,
} from '@saasicat/core';

type Subscription = Pick<SubscriptionUsageRecord, 'billingCycle' | 'canceledAt'>;
type Retirement = Pick<VersionRetiredNotice, 'subscriptionId' | 'retired' | 'replacement'>;
type Version = Pick<RetiredVersionRef, 'planVersionId' | 'planKey'>;

/**
 * Binds the subscription from the version retired onto the replacement,
 * keeping its period and its term. Claimed only while it is still bound to the
 * version retired with the cancellation as read, and binding the replacement
 * or nothing: one that no longer takes bookings is not bound.
 * `keepsPendingChange` keeps a change the subscriber scheduled.
 */
export function bindReplacement(
    writes: TenantSubscriptionWritePort,
    tenantId: string,
    sub: Subscription,
    notice: Retirement,
    keepsPendingChange: boolean,
): Promise<{ claimed: boolean }> {
    return rebind(writes, tenantId, sub, notice.retired, notice.replacement, {
        keepsPendingChange,
        restoresQuotedVersion: false,
    });
}

/**
 * Binds the subscription back onto the version retired, where the contract
 * that has to come with the move or the switch could not be written; whether
 * it was. That version is off sale — often by its own end — and binding it
 * again undoes a move rather than booking anything, so its sale does not
 * decide. The change the subscription has scheduled goes back with it, made
 * before the move or while its contract was being written: it is the
 * subscriber's, and the move it undoes was not. Where it cannot be bound, the
 * subscription is on the replacement without its contract, and `logger` names
 * it.
 */
export async function bindRetiredAgain(
    writes: TenantSubscriptionWritePort,
    tenantId: string,
    sub: Subscription,
    notice: Retirement,
    logger: Pick<Logger, 'error'>,
): Promise<boolean> {
    let why: string;
    try {
        const { claimed } = await rebind(
            writes,
            tenantId,
            sub,
            notice.replacement,
            notice.retired,
            {
                keepsPendingChange: true,
                restoresQuotedVersion: true,
            },
        );
        if (claimed) return true;
        why = 'it changed in between';
    } catch (error) {
        why = String(error);
    }
    logger.error(
        `Subscription ${notice.subscriptionId} of tenant ${tenantId} is on the replacement ` +
            `without its contract, and could not be put back: ${why}.`,
    );
    return false;
}

function rebind(
    writes: TenantSubscriptionWritePort,
    tenantId: string,
    sub: Subscription,
    from: Version,
    to: Version,
    options: Required<
        Pick<ImmediatePlanChangeInput, 'keepsPendingChange' | 'restoresQuotedVersion'>
    >,
): Promise<{ claimed: boolean }> {
    return writes.changePlanImmediate(tenantId, {
        planId: to.planKey,
        cycle: sub.billingCycle,
        periodStart: null,
        periodEnd: null,
        nextStatus: null,
        expectedCanceledAt: sub.canceledAt ?? null,
        expectedPlanVersionId: from.planVersionId,
        keepsBoundVersion: false,
        quotedPlanVersionId: to.planVersionId,
        quotedVersionOnly: true,
        ...(options.keepsPendingChange ? { keepsPendingChange: true } : {}),
        ...(options.restoresQuotedVersion ? { restoresQuotedVersion: true } : {}),
    });
}
