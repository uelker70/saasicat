import { Module } from '@nestjs/common';
import { SaaSiCatModule } from '@saasicat/nest/platform';

import { NotesModule } from './notes/notes.module';
import { PrismaModule } from './prisma/prisma.module';
import { NotesAdminModule } from './saas/notesapp-admin.module';
import { NOTES_SAASICAT_CONFIG } from './saasicat.config';

/**
 * The platform the seed activates its subscriptions through:
 * started from the application's own options, as the command line starts it
 * (`src/cli/cli.module.ts`, where the reason for the notes app's modules is
 * given), without HTTP and without `ScheduleModule` — a seed runs no invoice
 * run of its own.
 */
@Module({
    imports: [
        PrismaModule,
        SaaSiCatModule.forRoot(NOTES_SAASICAT_CONFIG),
        NotesModule,
        NotesAdminModule,
    ],
})
export class SeedModule {}
