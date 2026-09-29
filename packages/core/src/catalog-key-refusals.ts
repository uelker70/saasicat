import { CATALOG_ERROR_CODES } from './error-codes.js';
import type { PersistenceRefusal } from './errors.js';
import { refusal } from './refusal.js';

// A key is unique in the catalogue, retired entries included. The platform
// checks before it creates; these are what the unique index answers when two
// creates race past that check.

/** A plan key a plan already carries. */
export function planKeyTaken(planKey: string): PersistenceRefusal {
    return refusal(CATALOG_ERROR_CODES.PLAN_ALREADY_EXISTS, 'moved', { planKey });
}

/** A bundle key a bundle already carries. */
export function bundleKeyTaken(bundleKey: string): PersistenceRefusal {
    return refusal(CATALOG_ERROR_CODES.BUNDLE_ALREADY_EXISTS, 'moved', { bundleKey });
}

/** A marketing projection for a version and locale that already has one. */
export function marketingProjectionTaken(target: {
    targetType: string;
    targetVersionId: string;
    locale: string;
}): PersistenceRefusal {
    return refusal(CATALOG_ERROR_CODES.MARKETING_PROJECTION_ALREADY_EXISTS, 'moved', {
        targetType: target.targetType,
        targetVersionId: target.targetVersionId,
        locale: target.locale,
    });
}
