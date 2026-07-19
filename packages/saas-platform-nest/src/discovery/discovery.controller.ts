// Discovery-Controller — `GET /admin/discovery` liefert den DiscoverySnapshot
// als JSON mit ETag-Caching.
//
// Der Controller wird zur Boot-Zeit dynamisch gebaut, damit der Konsument
// die Class-Level-Guards selbst bestimmt (`SuperAdminGuard`, MFA, …).
// Pattern analog zu admin/admin-manifest.module.ts (`buildManifestController`).
//
// Spec: yada-services/handoff/superadmin/SPEC_V2.md §3.3

import {
    type CanActivate,
    Controller,
    Get,
    Header,
    Headers,
    HttpStatus,
    Inject,
    Post,
    Res,
    type Type,
    UseGuards,
} from '@nestjs/common';

import { DiscoveryScanner } from './discovery.scanner.js';
import type { DiscoverySnapshot } from './types.js';

interface HttpResponseLike {
    header(name: string, value: string): unknown;
    status(code: number): unknown;
}

/**
 * Baut zur Boot-Zeit eine Controller-Klasse mit den vom Konsumenten
 * konfigurierten Guards. Wird vom DiscoveryModule.forRoot() aufgerufen,
 * wenn `controller`-Option gesetzt ist.
 */
export function buildDiscoveryController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin')
    @UseGuards(...guards)
    class GeneratedDiscoveryController {
        // Explizites @Inject statt Type-Reflection: tsup/esbuild emittieren
        // keine `design:paramtypes`-Metadata, sodass Nest den Service-Typ am
        // Constructor sonst nicht auflösen kann.
        constructor(@Inject(DiscoveryScanner) private readonly scanner: DiscoveryScanner) {}

        @Get('discovery')
        @Header('Cache-Control', 'private, no-cache')
        getDiscovery(
            @Headers('if-none-match') ifNoneMatch: string | undefined,
            @Res({ passthrough: true }) res: HttpResponseLike,
        ): DiscoverySnapshot | null {
            const snapshot = this.scanner.getSnapshot();
            // `hash` deckt nur die fachlichen Daten ab — `scannedAt` muss in
            // den ETag, sonst liefert ein 304 einen veralteten Scan-Zeitpunkt.
            const etag = `"${snapshot.hash}-${snapshot.scannedAt}"`;
            res.header('ETag', etag);

            if (ifNoneMatch && ifNoneMatch === etag) {
                res.status(HttpStatus.NOT_MODIFIED);
                return null;
            }

            return snapshot;
        }

        /**
         * Erzwingt einen frischen Code-Scan und liefert den neuen Snapshot.
         * `scannedAt` wird aktualisiert; die Capability-/Feature-/Quota-Daten
         * sind im laufenden Prozess identisch (Code ist zur Laufzeit stabil).
         */
        @Post('discovery/rescan')
        rescanDiscovery(): DiscoverySnapshot {
            return this.scanner.rebuildSnapshot();
        }
    }

    return GeneratedDiscoveryController;
}
