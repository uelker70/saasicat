// TenantManifestController — endpoint factory for `GET /tenant/manifest`.
//
// The platform does not provide a fixed route, but a controller factory:
// the app can adjust the path (`/tenant/manifest` vs.
// `/api/v1/tenant/manifest` etc.) and hook in its own guards. In
// `SaasPlatformModule.forRoot({ tenantManifest: { controller: {...} } })`
// the default is `controller: { guards: [JwtAuthGuard] }`.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P14.

import {
    type CanActivate,
    Controller,
    Get,
    Inject,
    Req,
    type Type,
    UseGuards,
} from '@nestjs/common';
import { TenantManifestService } from './tenant-manifest.service.js';

interface RequestWithUser {
    user?: { tenantId?: string };
    tenantId?: string;
}

export interface TenantManifestControllerOptions {
    path?: string;
    guards: Array<Type<CanActivate>>;
}

/**
 * Creates a controller class that maps `GET <path>` to
 * `TenantManifestService.getManifest(tenantId)`. `tenantId` comes from
 * `request.user.tenantId` (default — matches the JwtAuthGuard pattern of
 * most apps) or from `request.tenantId`.
 *
 * Route path: default `tenant/manifest`. Apps with a globalPrefix `/api/v1`
 * thus get `/api/v1/tenant/manifest`.
 */
export function buildTenantManifestController(
    options: TenantManifestControllerOptions,
): Type<unknown> {
    const path = options.path ?? 'tenant/manifest';

    @Controller(path)
    @UseGuards(...options.guards)
    class GeneratedTenantManifestController {
        constructor(@Inject(TenantManifestService) private readonly svc: TenantManifestService) {}

        @Get()
        async get(@Req() req: RequestWithUser) {
            const tenantId = req.user?.tenantId ?? req.tenantId;
            if (!tenantId) {
                throw new Error('Kein Mandant im Request — TenantManifest braucht user.tenantId.');
            }
            return this.svc.getManifest(tenantId);
        }
    }

    return GeneratedTenantManifestController;
}
