// TenantAccessService — what a tenant's users may do, asked on every request
// (`SC-ADM-024`).
//
// The application calls `enforce` at the end of its own authentication guard,
// once the tenant of the request is known, and `assertAllowed` where there is
// no request to read a method from: a sign-in, a scheduled job. The platform
// does the same behind the application's guards on its own tenant routes. A
// session opened before the state changed is held to it on its next request,
// since nothing is cached between two.

import { type ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
    TENANT_ACCESS_ERROR_CODES,
    type TenantAccess,
    type TenantAccessErrorCode,
    type TenantAccessActor,
    type TenantAccessHoldPort,
    type TenantAccessState,
    requestWrites,
    tenantAccessOf,
    tenantAccessRefusal,
} from '@saasicat/core';

import { codedError } from '../errors/coded-error.js';
import { tenantAccessMarkOf } from './tenant-access-marks.js';
import { TENANT_ACCESS_HOLDS_TOKEN } from './tenant-access.tokens.js';

const REFUSAL_CODE: Readonly<Record<Exclude<TenantAccessState, 'open'>, TenantAccessErrorCode>> = {
    'read-only': TENANT_ACCESS_ERROR_CODES.TENANT_READ_ONLY,
    suspended: TENANT_ACCESS_ERROR_CODES.TENANT_SUSPENDED,
    deleting: TENANT_ACCESS_ERROR_CODES.TENANT_BEING_DELETED,
};

/** What a request asks to do, where there is no request to read it from. */
export interface TenantAccessIntent extends TenantAccessActor {
    writes: boolean;
}

interface RequestLike {
    method?: string;
}

@Injectable()
export class TenantAccessService {
    constructor(
        @Inject(TENANT_ACCESS_HOLDS_TOKEN) private readonly holds: TenantAccessHoldPort,
        @Inject(Reflector) private readonly reflector: Reflector,
    ) {}

    /** The state of `tenantId` and the open reasons it follows from. */
    async accessOf(tenantId: string): Promise<TenantAccess> {
        return tenantAccessOf(await this.holds.listOpen(tenantId));
    }

    /**
     * Refuses the current request where `tenantId`'s state does not allow it.
     * Whether it writes is its route's mark, or else its method; a request
     * whose method cannot be read counts as a write.
     */
    async enforce(
        context: ExecutionContext,
        tenantId: string,
        actor: TenantAccessActor = {},
    ): Promise<void> {
        const { method } = context.switchToHttp().getRequest<RequestLike>();
        const mark = tenantAccessMarkOf(this.reflector, context);
        const writes =
            typeof method === 'string' ? requestWrites(method, mark) : mark !== 'writes-nothing';
        await this.assertAllowed(tenantId, { ...actor, writes });
    }

    /** Refuses what `intent` describes where `tenantId`'s state does not allow it. */
    async assertAllowed(tenantId: string, intent: TenantAccessIntent): Promise<void> {
        const access = await this.accessOf(tenantId);
        const refusal = tenantAccessRefusal(access, intent.writes, intent);
        if (!refusal) return;
        // The operator's note on a suspension is theirs, not the tenant's: a
        // refusal names each reason by its kind and the moment it began.
        throw new ForbiddenException(
            codedError(REFUSAL_CODE[refusal], {
                reasons: access.holds.map((hold) => ({
                    kind: hold.kind,
                    since: hold.since.toISOString(),
                })),
            }),
        );
    }
}
