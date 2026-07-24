import { Module } from '@nestjs/common';
import {
    PrismaBundleRepository,
    PrismaCatalogEntryRepository,
    PrismaMarketingProjectionRepository,
    PrismaMarketingSettingsRepository,
    PrismaPlanRepository,
    PrismaPromotionRepository,
} from '@saasicat/adapter-prisma';
import { CatalogModule } from '@saasicat/nest/catalog';

import { DemoAuthGuard } from '../auth/demo-auth.guard';
import { DemoAuthModule } from '../auth/demo-auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { NOTES_FEATURE_UI_REGISTRY } from './feature-ui-registry';

/**
 * DB-backed catalog surface for the SuperAdmin UI: plans, bundles, discovery
 * review (catalog entries), promotions and marketing settings. Each repository
 * is the `@saasicat/adapter-prisma` implementation
 * over PrismaService; the controllers reuse the DemoAuthGuard the rest of the
 * example runs on.
 *
 * `strictModeCheckMode: 'warn-only'` keeps plan/bundle publishing from being
 * blocked while discovery coverage is still settling; `autoSyncDiscoveryAtBoot`
 * mirrors the code-scanned capabilities/features/quotas into the catalog-entry
 * tables at boot so the discovery-review page is populated on first start.
 */
@Module({
    imports: [
        CatalogModule.forRoot({
            planRepository: {
                useFactory: (prisma: PrismaService) => new PrismaPlanRepository(prisma),
                inject: [PrismaService],
            },
            bundleRepository: {
                useFactory: (prisma: PrismaService) => new PrismaBundleRepository(prisma),
                inject: [PrismaService],
            },
            catalogEntryRepository: {
                useFactory: (prisma: PrismaService) => new PrismaCatalogEntryRepository(prisma),
                inject: [PrismaService],
            },
            marketingProjectionRepository: {
                useFactory: (prisma: PrismaService) =>
                    new PrismaMarketingProjectionRepository(prisma),
                inject: [PrismaService],
            },
            promotionRepository: {
                useFactory: (prisma: PrismaService) => new PrismaPromotionRepository(prisma),
                inject: [PrismaService],
            },
            marketingSettingsRepository: {
                useFactory: (prisma: PrismaService) =>
                    new PrismaMarketingSettingsRepository(prisma),
                inject: [PrismaService],
            },
            controller: { guards: [DemoAuthGuard] },
            imports: [DemoAuthModule, PrismaModule],
            strictModeCheckMode: 'warn-only',
            autoSyncDiscoveryAtBoot: true,
            featureUiRegistry: NOTES_FEATURE_UI_REGISTRY,
        }),
    ],
})
export class NotesCatalogModule {}
