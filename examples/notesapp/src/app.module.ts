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
                    resolutionConfig: {
                        defaultTrialEntitlementPlan: 'STARTER',
                        // What a subscription keeps once its cancellation has
                        // taken effect. Omitted — as here — it keeps nothing,
                        // which is what ending a contract means. Name a plan to
                        // leave a floor instead: a read-only tier a former
                        // customer can export from, or a free plan.
                        //
                        //   canceledEntitlementPlan: 'STARTER',
                    },
                },
                catalog: {
                    featureUiRegistry: NOTES_FEATURE_UI_REGISTRY,
                    strictModeCheckMode: 'warn-only',
                    autoSyncDiscoveryAtBoot: true,
                },
                tenantBilling: {
                    authGuards: [DemoAuthGuard],
                    // How many days before the term ends a cancellation is
                    // still in time. Zero — the default, spelled out here
                    // because it is a commercial decision rather than a
                    // technical one — means there is no door to be shut out of:
                    // a cancellation on the last day still lands at the term
                    // end. Raise it and the cut is hard, so a declaration made
                    // after the window lands one full period later. With a
                    // yearly cycle that is a year, which is why the wizard
                    // states the date before the customer confirms.
                    // Two rhythms, two numbers. Both zero here: the example does
                    // not model a notice period, and zero is the reading a
                    // customer expects.
                    cancellationNoticeDays: { monthly: 0, yearly: 0 },
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
