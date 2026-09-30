import { BILLING_ERROR_CODES } from '@saasicat/core';

import type { PlanChangePreviewIssue } from './plan-change-preview.service.js';

/** One quota as a change would leave it: what is used today, and what the target allows. */
export interface QuotaAgainstTarget {
    quotaKey: string;
    used: number;
    targetMax: number;
}

/** Whether a target leaves no room for what is used today; `-1` is unlimited. */
export function exceedsTarget(used: number, targetMax: number): boolean {
    return targetMax !== -1 && used > targetMax;
}

/**
 * The refusals for quotas whose usage today a target would not hold — a plan
 * changed to, or a version switched to. Each sentence names its values, and
 * the values travel beside it for a catalogue to rebuild it.
 */
export function quotaOverTargetBlockers(
    quotas: readonly QuotaAgainstTarget[],
    planName: string,
): PlanChangePreviewIssue[] {
    const blockers: PlanChangePreviewIssue[] = [];
    for (const { quotaKey, used, targetMax } of quotas) {
        if (!exceedsTarget(used, targetMax)) continue;
        const usedDisplay = isFloatQuota(quotaKey) ? used.toFixed(1) : used.toString();
        blockers.push({
            code: BILLING_ERROR_CODES.QUOTA_OVER_TARGET,
            message: `Current usage ${usedDisplay} exceeds the target limit ${targetMax} (${quotaKey}) in the ${planName} plan. Please reduce usage first.`,
            params: { used: usedDisplay, targetMax, quotaKey, planName },
        });
    }
    return blockers;
}

function isFloatQuota(key: string): boolean {
    // Storage values are GB floats; all others are integer counts.
    return key.toLowerCase().includes('storage');
}
