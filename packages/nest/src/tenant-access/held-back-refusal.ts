// What a tenant held back is refused with wherever it asks (`SC-ADM-060`): the
// platform's one answer, given by the access check and by every path that
// decides on a tenant's reasons itself. Not exported from the package.

import { ForbiddenException } from '@nestjs/common';
import {
    TENANT_ACCESS_ERROR_CODES,
    type TenantAccessErrorCode,
    type TenantAccessHold,
    type TenantAccessState,
} from '@saasicat/core';

import { codedError } from '../errors/coded-error.js';

const REFUSAL_CODE: Readonly<Record<Exclude<TenantAccessState, 'open'>, TenantAccessErrorCode>> = {
    'read-only': TENANT_ACCESS_ERROR_CODES.TENANT_READ_ONLY,
    suspended: TENANT_ACCESS_ERROR_CODES.TENANT_SUSPENDED,
    deleting: TENANT_ACCESS_ERROR_CODES.TENANT_BEING_DELETED,
};

/**
 * What a tenant held back in `state` is refused with, its open reasons `holds`
 * named. The operator's note on a suspension is theirs, not the tenant's: a
 * refusal names each reason by its kind and the moment it began.
 */
export function heldBackRefusal(
    state: Exclude<TenantAccessState, 'open'>,
    holds: readonly TenantAccessHold[],
): ForbiddenException {
    return new ForbiddenException(
        codedError(REFUSAL_CODE[state], {
            reasons: holds.map((hold) => ({ kind: hold.kind, since: hold.since.toISOString() })),
        }),
    );
}
