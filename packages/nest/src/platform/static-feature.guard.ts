// StaticFeatureGuard — reads `@RequireFeature(...)` metadata and checks it
// against the `StaticEntitlementService` (plan catalog).
//
// The mega module registers it automatically as `APP_GUARD`, so that in the
// quickstart path the consumer can simply annotate controllers with
// `@RequireFeature('NOTES')` — without `@UseGuards(...)` boilerplate.
//
// The SUPER_ADMIN bypass and tenantId resolver hooks are identical to the
// heavyweight `FeatureGuard` from billing/feature.guard.ts, so that switching
// from static → V3 preserves the behavior.
//

import {
    CanActivate,
    type ExecutionContext,
    ForbiddenException,
    Inject,
    Injectable,
    Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
    AUTH_ERROR_CODES,
    FEATURE_NOT_LICENSED,
    type FeatureNotLicensedBody,
} from '@saasicat/types';
import { FEATURE_GUARD_MARKER } from '../billing/feature-guard-marker.js';
import { REQUIRE_FEATURE_KEY } from '../billing/require-feature.decorator.js';
import { StaticEntitlementService } from './static-entitlement.service.js';

export const STATIC_FEATURE_GUARD_CONFIG_TOKEN = Symbol.for(
    'saasicat/nest/StaticFeatureGuardConfig',
);

export interface StaticFeatureGuardConfig {
    /**
     * Resolver for the user role (e.g. `(user) => user.platformRole`).
     * SUPER_ADMIN gets a bypass.
     */
    userRoleResolver?: (user: unknown) => string | undefined;
    /**
     * Resolver for the tenant ID from the request. Default:
     * `request.tenantId ?? request.user?.tenantId`.
     */
    tenantIdResolver?: (request: unknown) => string | undefined;
}

interface RequestWithUser {
    user?: { role?: string; platformRole?: string; tenantId?: string };
    tenantId?: string;
}

@Injectable()
export class StaticFeatureGuard implements CanActivate {
    /** Lets `EnforcementChainCheck` recognise this guard across CJS entries. */
    static readonly [FEATURE_GUARD_MARKER] = true;

    constructor(
        @Inject(Reflector) private readonly reflector: Reflector,
        @Inject(StaticEntitlementService)
        private readonly entitlements: StaticEntitlementService,
        @Optional()
        @Inject(STATIC_FEATURE_GUARD_CONFIG_TOKEN)
        private readonly config: StaticFeatureGuardConfig | null = null,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const required = this.reflector.getAllAndOverride<string[] | undefined>(
            REQUIRE_FEATURE_KEY,
            [context.getHandler(), context.getClass()],
        );
        if (!required || required.length === 0) return true;

        const request = context.switchToHttp().getRequest<RequestWithUser>();
        const user = request.user;
        if (!user) {
            throw new ForbiddenException({
                code: AUTH_ERROR_CODES.NOT_AUTHENTICATED,
                message: 'Not authenticated',
            });
        }

        // SUPER_ADMIN bypass — platform support is allowed even without the feature.
        const role = this.config?.userRoleResolver
            ? this.config.userRoleResolver(user)
            : (user.role ?? user.platformRole);
        if (role === 'SUPER_ADMIN') return true;

        const tenantId = this.config?.tenantIdResolver
            ? this.config.tenantIdResolver(request)
            : (request.tenantId ?? user.tenantId);
        if (!tenantId) {
            throw new ForbiddenException({
                code: AUTH_ERROR_CODES.NO_TENANT_ASSIGNED,
                message: 'No tenant assigned',
            });
        }

        const snap = await this.entitlements.snapshot(tenantId);
        const allowed = required.some((f) => snap.features.includes(f));
        if (!allowed) {
            // Same wire body as the heavyweight `FeatureGuard`: the full
            // `FeatureNotLicensedBody`, with empty `offers` because the static
            // path knows no `UpsellOfferResolver`.
            //
            // The message must keep starting with the word `Feature` —
            // consumers that predate the `code` field classify the response by
            // that prefix.
            const body: FeatureNotLicensedBody = {
                code: FEATURE_NOT_LICENSED,
                featureKey: required[0],
                featureKeys: required,
                offers: [],
                message: `Feature ${required.join(' / ')} is not included in the current plan.`,
            };
            throw new ForbiddenException(body);
        }
        return true;
    }
}
