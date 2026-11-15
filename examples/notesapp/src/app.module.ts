import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { LimitExceededFilter } from '@saasicat/nest/billing';
import { SaaSiCatModule } from '@saasicat/nest/platform';

import { DemoAuthModule } from './auth/demo-auth.module';
import { HealthController } from './health.controller';
import { NotesModule } from './notes/notes.module';
import { PrismaModule } from './prisma/prisma.module';
import { NotesAdminModule } from './saas/notesapp-admin.module';
import { NOTES_SAASICAT_CONFIG } from './saasicat.config';

@Module({
    imports: [
        PrismaModule,
        DemoAuthModule,
        // The platform's runs — here, the one that records each subscription
        // that ended and the day its data goes, and reminds the tenant before
        // that day — are scheduled by this module.
        ScheduleModule.forRoot(),

        // The platform's options, in a file of their own because the CLI
        // starts the same platform (`src/cli/cli.module.ts`).
        SaaSiCatModule.forRoot(NOTES_SAASICAT_CONFIG),

        NotesModule,
        // Manifest contribution + KPI endpoints for the SuperAdmin UI.
        NotesAdminModule,
    ],
    controllers: [HealthController],
    providers: [
        // Maps LimitExceededError from @EnforceQuota to HTTP 402 + quota payload.
        { provide: APP_FILTER, useClass: LimitExceededFilter },
    ],
})
export class AppModule {}
