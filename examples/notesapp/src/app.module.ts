import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { prismaPersistence } from '@saasicat/adapter-prisma';
import { LimitExceededFilter, loadPlanCatalogFromFile } from '@saasicat/nest/billing';
import { defineSaaSiCat, SaaSiCatModule } from '@saasicat/nest/platform';

import { DemoAuthGuard } from './auth/demo-auth.guard';
import { DemoAuthModule } from './auth/demo-auth.module';
import { DemoPasswordHasher } from './auth/demo-password.hasher';
import { NotesModule } from './notes/notes.module';
import { PrismaModule } from './prisma/prisma.module';
import { PrismaService } from './prisma/prisma.service';
import { NOTES_FEATURE_UI_REGISTRY } from './saas/feature-ui-registry';
import { NotesAdminModule } from './saas/notesapp-admin.module';
import { NotesQuotaProvider } from './saas/notes-quota.provider';

@Module({
    imports: [
        PrismaModule,
        DemoAuthModule,

        SaaSiCatModule.forRoot(
            defineSaaSiCat({
                // Static quickstart path: identity + plans straight from the YAML.
                planCatalog: loadPlanCatalogFromFile({ path: 'config/saas.yaml' }),
                // Real apps pass their JwtAuthGuard here.
                controller: { guards: [DemoAuthGuard] },
                imports: [DemoAuthModule, PrismaModule],
                // The whole persistence wiring — one line.
                persistence: prismaPersistence({
                    client: PrismaService,
                    passwordHasher: DemoPasswordHasher,
                    adminResources: { tenantMetrics: ['notes', 'users'] },
                }),
                // The standard stack takes every repository from the persistence
                // bundle. No forwarding Catalog/Billing modules are needed.
                entitlement: {
                    resolutionConfig: { defaultTrialEntitlementPlan: 'STARTER' },
                },
                catalog: {
                    featureUiRegistry: NOTES_FEATURE_UI_REGISTRY,
                    strictModeCheckMode: 'warn-only',
                    autoSyncDiscoveryAtBoot: true,
                },
                tenantBilling: {
                    authGuards: [DemoAuthGuard],
                },
                subscriptionBundles: true,
                adminResources: true,
                promoCodes: true,
                quotaProviders: [NotesQuotaProvider],
                tenantManifest: true,
            }),
        ),

        NotesModule,
        // Manifest contribution + KPI endpoints for the SuperAdmin UI.
        NotesAdminModule,
    ],
    providers: [
        // Maps LimitExceededError from @EnforceQuota to HTTP 402 + quota payload.
        { provide: APP_FILTER, useClass: LimitExceededFilter },
    ],
})
export class AppModule {}
