// TenantManifestController — Endpoint-Factory für `GET /tenant/manifest`.
//
// Plattform liefert keine fixe Route, sondern eine Controller-Factory:
// die App kann den Pfad anpassen (`/tenant/manifest` vs.
// `/api/v1/tenant/manifest` etc.) und eigene Guards einhängen. Im
// `SaasPlatformModule.forRoot({ tenantManifest: { controller: {...} } })`
// ist Default `controller: { guards: [JwtAuthGuard] }`.
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
 * Erzeugt einen Controller-Klasse, die `GET <path>` auf
 * `TenantManifestService.getManifest(tenantId)` mappt. `tenantId` kommt
 * aus `request.user.tenantId` (default — passt zum JwtAuthGuard-Pattern
 * der meisten Apps) oder aus `request.tenantId`.
 *
 * Routen-Pfad: Default `tenant/manifest`. Apps mit globalPrefix `/api/v1`
 * bekommen damit `/api/v1/tenant/manifest`.
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
