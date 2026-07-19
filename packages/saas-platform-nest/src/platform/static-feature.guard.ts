// StaticFeatureGuard — liest `@RequireFeature(...)`-Metadata und checkt
// gegen den `StaticEntitlementService` (Plan-Catalog).
//
// Aktiviert das Mega-Modul automatisch als `APP_GUARD`, sodass der
// Konsument im Quickstart-Pfad einfach `@RequireFeature('NOTES')` auf
// Controllern annotieren kann — ohne `@UseGuards(...)`-Boilerplate.
//
// SUPER_ADMIN-Bypass und tenantId-Resolver-Hooks sind identisch zum
// schwergewichtigen `FeatureGuard` aus billing/feature.guard.ts, damit
// der Wechsel von Static → V3 das Verhalten erhält.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P7+P9.

import {
    CanActivate,
    type ExecutionContext,
    ForbiddenException,
    Inject,
    Injectable,
    Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_FEATURE_KEY } from '../billing/require-feature.decorator.js';
import { StaticEntitlementService } from './static-entitlement.service.js';

export const STATIC_FEATURE_GUARD_CONFIG_TOKEN = Symbol.for(
    'saas-platform-nest/StaticFeatureGuardConfig',
);

export interface StaticFeatureGuardConfig {
    /**
     * Resolver für die User-Rolle (z. B. `(user) => user.platformRole`).
     * SUPER_ADMIN bekommt Bypass.
     */
    userRoleResolver?: (user: unknown) => string | undefined;
    /**
     * Resolver für die Tenant-ID aus dem Request. Default:
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
        if (!user) throw new ForbiddenException('Nicht authentifiziert');

        // SUPER_ADMIN-Bypass — Plattform-Support darf auch ohne Feature.
        const role = this.config?.userRoleResolver
            ? this.config.userRoleResolver(user)
            : (user.role ?? user.platformRole);
        if (role === 'SUPER_ADMIN') return true;

        const tenantId = this.config?.tenantIdResolver
            ? this.config.tenantIdResolver(request)
            : (request.tenantId ?? user.tenantId);
        if (!tenantId) throw new ForbiddenException('Kein Mandant zugeordnet');

        const snap = await this.entitlements.snapshot(tenantId);
        const allowed = required.some((f) => snap.features.includes(f));
        if (!allowed) {
            throw new ForbiddenException(
                `Feature ${required.join(' / ')} nicht im aktuellen Plan enthalten.`,
            );
        }
        return true;
    }
}
