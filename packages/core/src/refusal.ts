import type { PlatformErrorCode } from './error-codes.js';
import { ERROR_MESSAGES_EN, formatErrorMessage } from './error-messages.js';
import { PersistenceRefusal, type PersistenceRefusalReason } from './errors.js';

/**
 * A refusal worded by the shipped English catalogue, so that it reads the same
 * as the answer the platform's own check gives for the case before it writes.
 */
export function refusal(
    code: PlatformErrorCode,
    reason: PersistenceRefusalReason,
    params: Readonly<Record<string, unknown>>,
): PersistenceRefusal {
    return new PersistenceRefusal(
        code,
        reason,
        formatErrorMessage(ERROR_MESSAGES_EN[code], params),
        params,
    );
}
