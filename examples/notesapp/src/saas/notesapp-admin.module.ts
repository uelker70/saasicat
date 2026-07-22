import { Module, type OnModuleInit } from '@nestjs/common';
// From `/platform`, not `/admin`: the CJS bundles do not share code between
// entries, so only this entry hands out the same class object that
// SaasPlatformModule registered.
import { AdminManifestService } from '@saasicat/nest/platform';

import { NOTESAPP_MANIFEST_CONTRIBUTION } from './admin-manifest.contribution';
import { AdminStatsController } from './admin-stats.controller';

/**
 * Everything this app contributes to the SuperAdmin UI: the manifest
 * contribution and the KPI endpoints it points at.
 *
 * The platform core contribution declares the standard pages but grants no
 * capabilities — without the registration below the sidebar stays empty,
 * because the NavBuilder filters out every page whose `requiredCapability`
 * is not `true`.
 */
@Module({
    controllers: [AdminStatsController],
})
export class NotesAdminModule implements OnModuleInit {
    constructor(private readonly manifest: AdminManifestService) {}

    onModuleInit(): void {
        this.manifest.register(NOTESAPP_MANIFEST_CONTRIBUTION);
    }
}
