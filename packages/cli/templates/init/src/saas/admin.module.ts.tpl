import { Module, type OnModuleInit } from '@nestjs/common';
// From `/platform`, not `/admin`: the CJS bundles do not share code between
// entries, so only this entry hands out the same class object that
// `SaaSiCatModule` registered.
import { AdminManifestService } from '@saasicat/nest/platform';

import { __MANIFEST_CONST__ } from './admin-manifest.contribution';

/**
 * Registers this app's manifest contribution.
 *
 * Add the controllers that serve your dashboard KPIs here — the contribution
 * declares the cards, this module is what mounts the endpoints they point at.
 */
@Module({
    controllers: [],
})
export class __ADMIN_MODULE_CLASS__ implements OnModuleInit {
    constructor(private readonly manifest: AdminManifestService) {}

    onModuleInit(): void {
        this.manifest.register(__MANIFEST_CONST__);
    }
}
