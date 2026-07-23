import { Module } from '@nestjs/common';
import {
    PrismaBundleRepository,
    PrismaCatalogEntryRepository,
    PrismaMarketingProjectionRepository,
    PrismaMarketingSettingsRepository,
    PrismaPlanRepository,
    PrismaPromotionRepository,
    type PrismaLike,
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
                useFactory: (prisma: PrismaLike) => new PrismaPlanRepository(prisma),
                inject: [PrismaService],
            },
            bundleRepository: {
                useFactory: (prisma: PrismaLike) => new PrismaBundleRepository(prisma),
                inject: [PrismaService],
            },
            catalogEntryRepository: {
                useFactory: (prisma: PrismaLike) => new PrismaCatalogEntryRepository(prisma),
                inject: [PrismaService],
            },
            marketingProjectionRepository: {
                useFactory: (prisma: PrismaLike) => new PrismaMarketingProjectionRepository(prisma),
                inject: [PrismaService],
            },
            promotionRepository: {
                useFactory: (prisma: PrismaLike) => new PrismaPromotionRepository(prisma),
                inject: [PrismaService],
            },
            marketingSettingsRepository: {
                useFactory: (prisma: PrismaLike) => new PrismaMarketingSettingsRepository(prisma),
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
