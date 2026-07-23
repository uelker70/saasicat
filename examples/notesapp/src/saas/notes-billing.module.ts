import { Module } from '@nestjs/common';
import {
    PrismaBundleRepository,
    PrismaCatalogEntryRepository,
    PrismaPlanVersionRepository,
    PrismaSubscriptionBundleRepository,
    PrismaSubscriptionRepository,
    PrismaTenantSubscriptionWriteAdapter,
    PrismaTransactionRunner,
    type PrismaLike,
} from '@saasicat/adapter-prisma';
import { EntitlementModule } from '@saasicat/nest/entitlement';
import {
    PublicCatalogModule,
    SubscriptionBundleModule,
    TenantBillingModule,
} from '@saasicat/nest/billing';

import { DemoAuthGuard } from '../auth/demo-auth.guard';
import { DemoAuthModule } from '../auth/demo-auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { NOTES_FEATURE_UI_REGISTRY } from './feature-ui-registry';
import { NotesSubscriptionUsagePort } from './notes-subscription-usage.port';
import { NotesUsageSnapshotPort } from './notes-usage-snapshot.port';

const PROJECT_KEY = 'notesapp';

/**
 * Tenant-facing billing surface — the counterpart to the SuperAdmin catalog in
 * NotesCatalogModule. A tenant web app reads its entitlement/usage, browses the
 * public catalog, changes its plan and manages standalone add-on bundles.
 *
 *   - EntitlementModule (global) — the full subscription-backed
 *     EntitlementService that PlanChangePreviewService depends on; also
 *     aggregates booked SubscriptionBundles into computeLimits.
 *   - PublicCatalogModule — auth-free `GET /billing/plans|bundles|
 *     feature-registry`.
 *   - TenantBillingModule — `GET /billing/entitlement|usage` and the plan
 *     mutations, guarded by DemoAuthGuard.
 *   - SubscriptionBundleModule — the tenant bundle store at
 *     `/billing/subscription-bundles`.
 *
 * Platform adapters (PRISMA_CLIENT_TOKEN-bound) are constructed via
 * `new X(prisma)` factories over the @Global PrismaService, matching
 * NotesCatalogModule; the two app-owned ports inject PrismaService directly.
 */
@Module({
    imports: [
        EntitlementModule.forRoot({
            global: true,
            subscriptionRepository: {
                useFactory: (prisma: PrismaLike) => new PrismaSubscriptionRepository(prisma),
                inject: [PrismaService],
            },
            planVersionRepository: {
                useFactory: (prisma: PrismaLike) => new PrismaPlanVersionRepository(prisma),
                inject: [PrismaService],
            },
            transactionRunner: {
                useFactory: (prisma: PrismaLike) => new PrismaTransactionRunner(prisma),
                inject: [PrismaService],
            },
            // Both together let independently booked add-on bundles flow into
            // computeLimits (platform #61); without them only plan quotas count.
            subscriptionBundleRepository: {
                useFactory: (prisma: PrismaLike) => new PrismaSubscriptionBundleRepository(prisma),
                inject: [PrismaService],
            },
            bundleRepository: {
                useFactory: (prisma: PrismaLike) => new PrismaBundleRepository(prisma),
                inject: [PrismaService],
            },
            resolutionConfig: { defaultTrialEntitlementPlan: 'STARTER' },
        }),

        PublicCatalogModule.forRoot({
            featureUiRegistry: NOTES_FEATURE_UI_REGISTRY,
            projectKey: PROJECT_KEY,
            imports: [PrismaModule],
            // projectKey + bundleRepository activate `GET /billing/bundles`.
            bundleRepository: {
                useFactory: (prisma: PrismaLike) => new PrismaBundleRepository(prisma),
                inject: [PrismaService],
            },
            // Overlays the editable FeatureCatalogEntry.icon in
            // `GET /billing/feature-registry`.
            catalogEntryRepository: {
                useFactory: (prisma: PrismaLike) => new PrismaCatalogEntryRepository(prisma),
                inject: [PrismaService],
            },
        }),

        TenantBillingModule.forRoot({
            imports: [DemoAuthModule, PrismaModule],
            // App-owned ports injected by the factories below live in this
            // DynamicModule's own scope.
            extraProviders: [NotesSubscriptionUsagePort, NotesUsageSnapshotPort],
            authGuards: {
                useFactory: (guard: DemoAuthGuard) => [guard],
                inject: [DemoAuthGuard],
            },
            subscriptionUsagePort: {
                useFactory: (port: NotesSubscriptionUsagePort) => port,
                inject: [NotesSubscriptionUsagePort],
            },
            usageSnapshotPort: {
                useFactory: (port: NotesUsageSnapshotPort) => port,
                inject: [NotesUsageSnapshotPort],
            },
            subscriptionWritePort: {
                useFactory: (prisma: PrismaLike) =>
                    new PrismaTenantSubscriptionWriteAdapter(prisma),
                inject: [PrismaService],
            },
            // tenantIdResolver default (req.user.tenantId) works with
            // DemoAuthGuard. Optional trial/pending/contract-freeze ports skipped.
        }),

        SubscriptionBundleModule.forRoot({
            imports: [DemoAuthModule, PrismaModule],
            extraProviders: [NotesSubscriptionUsagePort],
            subscriptionBundleRepository: {
                useFactory: (prisma: PrismaLike) => new PrismaSubscriptionBundleRepository(prisma),
                inject: [PrismaService],
            },
            bundleRepository: {
                useFactory: (prisma: PrismaLike) => new PrismaBundleRepository(prisma),
                inject: [PrismaService],
            },
            // Mounts the tenant bundle store at `/billing/subscription-bundles`.
            controller: {
                authGuards: {
                    useFactory: (guard: DemoAuthGuard) => [guard],
                    inject: [DemoAuthGuard],
                },
                subscriptionUsagePort: {
                    useFactory: (port: NotesSubscriptionUsagePort) => port,
                    inject: [NotesSubscriptionUsagePort],
                },
            },
        }),
    ],
})
export class NotesBillingModule {}
