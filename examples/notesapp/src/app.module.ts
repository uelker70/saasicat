import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { prismaPersistence } from '@saasicat/adapter-prisma';
import { LimitExceededFilter, loadPlanCatalogFromFile } from '@saasicat/nest/billing';
import { SaasPlatformModule } from '@saasicat/nest/platform';

import { DemoAuthGuard } from './auth/demo-auth.guard';
import { DemoAuthModule } from './auth/demo-auth.module';
import { DemoPasswordHasher } from './auth/demo-password.hasher';
import { NotesModule } from './notes/notes.module';
import { PrismaModule } from './prisma/prisma.module';
import { PrismaService } from './prisma/prisma.service';
import { NotesAdminModule } from './saas/notesapp-admin.module';
import { NotesCatalogModule } from './saas/notes-catalog.module';
import { NotesPlatformPagesModule } from './saas/notes-platform-pages.module';
import { NotesQuotaProvider } from './saas/notes-quota.provider';

@Module({
    imports: [
        PrismaModule,
        DemoAuthModule,

        SaasPlatformModule.forRoot({
            // Static quickstart path: identity + plans straight from the YAML.
            planCatalog: loadPlanCatalogFromFile({ path: 'config/saas.yaml' }),
            // Real apps pass their JwtAuthGuard here.
            controller: { guards: [DemoAuthGuard] },
            imports: [DemoAuthModule],
            // The whole persistence wiring — one line.
            persistence: prismaPersistence({
                client: PrismaService,
                passwordHasher: DemoPasswordHasher,
            }),
            // No planResolver yet → every tenant is on STARTER. Swap for a
            // subscription-backed resolver when you enable V3 contracts.
            defaultPlanId: 'STARTER',
            quotaProviders: [NotesQuotaProvider],
            tenantManifest: { guards: [DemoAuthGuard] },
        }),

        NotesModule,
        // Manifest contribution + KPI endpoints for the SuperAdmin UI.
        NotesAdminModule,
        // DB-backed catalog surface (plans, bundles, business types, discovery
        // review, marketing) the SuperAdmin catalog pages read/write.
        NotesCatalogModule,
        // App-owned domain pages (tenants, users, audit, subscriptions, promo
        // codes) — these sit on the app's own tables, not the platform's.
        NotesPlatformPagesModule,
    ],
    providers: [
        // Maps LimitExceededError from @EnforceQuota to HTTP 402 + quota payload.
        { provide: APP_FILTER, useClass: LimitExceededFilter },
    ],
})
export class AppModule {}
