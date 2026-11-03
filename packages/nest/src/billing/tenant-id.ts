import { NotFoundException } from '@nestjs/common';
import { AUTH_ERROR_CODES } from '@saasicat/core';

import { codedError } from '../errors/coded-error.js';
import type { TenantIdResolver } from './tenant-billing.tokens.js';

/** Where the tenant is read from when the application names no resolver: `req.user.tenantId`. */
export function userTenantIdOf(request: unknown): string | null {
    if (typeof request !== 'object' || request === null || !('user' in request)) return null;
    const { user } = request;
    if (typeof user !== 'object' || user === null || !('tenantId' in user)) return null;
    return typeof user.tenantId === 'string' ? user.tenantId : null;
}

/**
 * The tenant a request is served for, as the application's resolver derives
 * it from the session — never from a value the caller sends — and refused
 * where the request carries none.
 */
export function tenantIdOf(resolver: TenantIdResolver | null, request: unknown): string {
    const tenantId = (resolver ?? userTenantIdOf)(request);
    if (!tenantId) throw new NotFoundException(codedError(AUTH_ERROR_CODES.TENANT_CONTEXT_MISSING));
    return tenantId;
}
