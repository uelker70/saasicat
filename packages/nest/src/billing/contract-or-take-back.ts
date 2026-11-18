import { HttpException, ServiceUnavailableException, type Logger } from '@nestjs/common';
import type {
    BillingCycle,
    SubscriptionPutBack,
    SubscriptionUsageRecord,
    TenantSubscriptionWritePort,
} from '@saasicat/core';
import { BILLING_ERROR_CODES, pendingAgreementColumns } from '@saasicat/core';

import type { ContractFreezePort } from './contract-freeze.tokens.js';

/** What `freezeOrTakeBack` writes through, and whom it tells. */
export interface ContractOrTakeBackPorts {
    readonly contractFreeze: ContractFreezePort | null;
    readonly writes: TenantSubscriptionWritePort;
    readonly entitlements: { invalidateTenant(tenantId: string): void };
    readonly logger: Pick<Logger, 'error'>;
}

/** A plan change made today: the subscription as read before it, and the version it bound. */
export interface PlanChangeMade {
    readonly read: SubscriptionUsageRecord;
    /** `null` where the version bound is not known; the take-back then claims no binding. */
    readonly boundAfter: string | null;
    /** Named in the log, as `a plan change` or `a version switch`. */
    readonly what: string;
}

/**
 * Freezes the contract a plan change made today ends in, or takes the change
 * back and refuses it (`SC-CHG-025`).
 *
 * A plan change and its contract are one. Left standing without its contract,
 * the subscription would name the new plan while the contract in force — what
 * the entitlements read first and the journal charges from — still names the
 * old one: the tenant would pay for what they left, or get what they did not
 * pay for. So the subscription is written back as it was read, and the caller
 * is refused: with the contract's own refusal where it gave one, with
 * `PLAN_CHANGE_CONTRACT_NOT_WRITTEN` where the store failed. Where even the
 * take-back is not written, the error stands as it came and the log says the
 * subscription is on the change without its contract.
 */
export async function freezeOrTakeBack(
    ports: ContractOrTakeBackPorts,
    tenantId: string,
    terms: { plan: string; cycle: BillingCycle; effectiveFrom: Date; endsAt: Date | null },
    change: PlanChangeMade,
): Promise<void> {
    if (!ports.contractFreeze) return;
    try {
        await ports.contractFreeze.freezeOnPlanChange(
            tenantId,
            terms.plan,
            terms.cycle,
            terms.effectiveFrom,
            terms.endsAt,
        );
        return;
    } catch (error) {
        const takenBack = await takeBack(ports, tenantId, change);
        ports.entitlements.invalidateTenant(tenantId);
        if (!takenBack) throw error;
        ports.logger.error(
            `The contract for ${change.what} of tenant ${tenantId} could not be written, and the ` +
                `change was taken back: ${String(error)}`,
        );
        if (error instanceof HttpException) throw error;
        throw new ServiceUnavailableException({
            code: BILLING_ERROR_CODES.PLAN_CHANGE_CONTRACT_NOT_WRITTEN,
            message: 'The contract for this change could not be written, so nothing was changed.',
            params: {},
        });
    }
}

/** Writes the subscription back as `change.read` held it; whether that was written. */
async function takeBack(
    ports: ContractOrTakeBackPorts,
    tenantId: string,
    change: PlanChangeMade,
): Promise<boolean> {
    const { read } = change;
    const versionRead = read.planVersion?.id ?? null;
    let why: string;
    try {
        const { claimed } = await ports.writes.changePlanImmediate(tenantId, {
            planId: read.plan,
            cycle: read.billingCycle,
            periodStart: null,
            periodEnd: null,
            nextStatus: null,
            expectedCanceledAt: read.canceledAt ?? null,
            expectedPlanVersionId: change.boundAfter ?? undefined,
            keepsBoundVersion: false,
            quotedPlanVersionId: versionRead,
            quotedVersionOnly: versionRead !== null,
            restoresQuotedVersion: true,
            putsBack: putBackOf(read),
        });
        if (claimed) return true;
        why = 'it changed in between';
    } catch (error) {
        why = String(error);
    }
    ports.logger.error(
        `Tenant ${tenantId} is on ${change.what} without its contract, and the change could not ` +
            `be taken back: ${why}.`,
    );
    return false;
}

function putBackOf(read: SubscriptionUsageRecord): SubscriptionPutBack {
    return {
        status: read.status,
        currentPeriodStart: read.currentPeriodStart,
        currentPeriodEnd: read.currentPeriodEnd,
        billingAnchorDay: read.billingAnchorDay ?? null,
        scheduledChange: {
            pendingPlan: read.pendingPlan,
            pendingBillingCycle: read.pendingBillingCycle,
            pendingEffectiveAt: read.pendingEffectiveAt,
            pendingChangeVersionId: read.pendingChangeVersionId ?? null,
            ...pendingAgreementColumns(read.pendingAgreement ?? null),
        },
    };
}
