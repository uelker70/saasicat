import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { prismaPersistence } from '@saasicat/adapter-prisma';
import { LimitExceededFilter, loadPlanCatalogFromFile } from '@saasicat/nest/billing';
import { SaasPlatformModule } from '@saasicat/nest/platform';

import { DemoAuthGuard } from './auth/demo-auth.guard';
import { DemoPasswordHasher } from './auth/demo-password.hasher';
import { NotesModule } from './notes/notes.module';
import { PrismaModule } from './prisma/prisma.module';
import { PrismaService } from './prisma/prisma.service';
import { NotesAdminModule } from './saas/notesapp-admin.module';
import { NotesQuotaProvider } from './saas/notes-quota.provider';

/**
 * Auth must be a GLOBAL guard registered BEFORE the platform module: the
 * platform's StaticFeatureGuard/EnforceQuotaInterceptor are global too and
 * read `request.user` — global guards run in registration order, and
 * controller-level @UseGuards would come too late.
 */
@Global()
@Module({
    providers: [
        DemoAuthGuard,
        DemoPasswordHasher,
        { provide: APP_GUARD, useExisting: DemoAuthGuard },
    ],
    exports: [DemoAuthGuard, DemoPasswordHasher],
})
class DemoAuthModule {}

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
    ],
    providers: [
        // Maps LimitExceededError from @EnforceQuota to HTTP 402 + quota payload.
        { provide: APP_FILTER, useClass: LimitExceededFilter },
    ],
})
export class AppModule {}
