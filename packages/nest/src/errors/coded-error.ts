import { ERROR_MESSAGES_EN, formatErrorMessage } from '@saasicat/core';

import type { PlatformErrorBody, PlatformErrorCode } from '@saasicat/core';

/**
 * Builds the body of a coded exception.
 *
 * `PlatformErrorBody` declares `message` as required, but a throw site that
 * passes only `{ code }` produces a body without one — NestJS hands an object
 * argument through verbatim. A consumer typing the response then reads
 * `undefined` where a string was promised, and `body.message.includes(...)`
 * throws. Deriving the message from the shipped English catalogue closes that
 * gap, and keeps the fallback text identical to the shipped default by
 * construction.
 *
 * Use it wherever there is no reason to word the message differently from the
 * catalogue:
 *
 *     throw new BadRequestException(codedError(REGISTRATION_ERROR_CODES.OTP_INVALID));
 *     throw new NotFoundException(codedError(BILLING_ERROR_CODES.TENANT_NOT_FOUND, { slug }));
 */
export function codedError(
    code: PlatformErrorCode,
    params?: Record<string, unknown>,
): PlatformErrorBody {
    const message = formatErrorMessage(ERROR_MESSAGES_EN[code], params ?? {});
    return params ? { code, message, params } : { code, message };
}
