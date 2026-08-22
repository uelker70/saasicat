// Discovery controller — `GET /admin/discovery` returns the DiscoverySnapshot
// as JSON with ETag caching.
//
// The controller is built dynamically at boot time so that the consumer
// decides the class-level guards themselves (`SuperAdminGuard`, MFA, …).
// Pattern analogous to admin/admin-manifest.module.ts (`buildManifestController`).

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
 * Builds a controller class at boot time with the guards configured by the
 * consumer. Called by DiscoveryModule.forRoot() when the `controller`
 * option is set.
 */
export function buildDiscoveryController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin')
    @UseGuards(...guards)
    class GeneratedDiscoveryController {
        // Explicit @Inject instead of type reflection: tsup/esbuild do not emit
        // any `design:paramtypes` metadata, so otherwise Nest cannot resolve the
        // service type on the constructor.
        constructor(@Inject(DiscoveryScanner) private readonly scanner: DiscoveryScanner) {}

        @Get('discovery')
        @Header('Cache-Control', 'private, no-cache')
        getDiscovery(
            @Headers('if-none-match') ifNoneMatch: string | undefined,
            @Res({ passthrough: true }) res: HttpResponseLike,
        ): DiscoverySnapshot | null {
            const snapshot = this.scanner.getSnapshot();
            // `hash` covers only the domain data — `scannedAt` must go into
            // the ETag, otherwise a 304 returns a stale scan timestamp.
            const etag = `"${snapshot.hash}-${snapshot.scannedAt}"`;
            res.header('ETag', etag);

            if (ifNoneMatch && ifNoneMatch === etag) {
                res.status(HttpStatus.NOT_MODIFIED);
                return null;
            }

            return snapshot;
        }

        /**
         * Forces a fresh code scan and returns the new snapshot.
         * `scannedAt` is updated; the Capability/Feature/Quota data
         * are identical within the running process (code is stable at runtime).
         */
        @Post('discovery/rescan')
        rescanDiscovery(): DiscoverySnapshot {
            return this.scanner.rebuildSnapshot();
        }
    }

    return GeneratedDiscoveryController;
}
