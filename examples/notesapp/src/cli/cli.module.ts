import { Module } from '@nestjs/common';
import {
    CliContextModule,
    DoctorCommands,
    InstallationCliFlow,
    InstallationCommands,
    InstallationMarkCommand,
    InstallationStatusCommand,
} from '@saasicat/cli';
import { SaaSiCatModule } from '@saasicat/nest/platform';

import { NotesModule } from '../notes/notes.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { NotesAdminModule } from '../saas/notesapp-admin.module';
import { NOTES_SAASICAT_CONFIG } from '../saasicat.config';
import { NotesOperators } from './notes-operators';

/**
 * The notes app's command line: what an operator needs to let a tenant's data
 * be deleted — `installation status`, `installation mark <identifier>` — and
 * `doctor`, which says whether the database is marked among its other checks.
 * `docs/guides/extend-your-cli.md` lists every command the platform ships; an
 * application registers the ones its options switch on.
 *
 * It starts the platform from the application's own options. Every start
 * mirrors the code's capabilities and features into the catalogue, and a start
 * that left out the notes app's modules would find fewer of them than the
 * application and mark the rest obsolete; the admin module adds the manifest
 * contribution the doctor reads. So the CLI imports both. It does not import
 * `ScheduleModule`: the platform's runs belong to the application, not to a
 * command waiting for a second factor.
 */
@Module({
    imports: [
        PrismaModule,
        SaaSiCatModule.forRoot(NOTES_SAASICAT_CONFIG),
        NotesModule,
        NotesAdminModule,
        CliContextModule.forRoot({
            config: {
                adminEmailEnvVar: 'NOTESAPP_ADMIN_EMAIL',
                mfaSkipEnvVar: 'NOTESAPP_SKIP_MFA',
                mfaIssuer: 'NotesApp',
                isProductionEnvironment: () => process.env.NOTESAPP_ENV === 'production',
            },
            userPort: {
                useFactory: (prisma: PrismaService) => new NotesOperators(prisma),
                inject: [PrismaService],
            },
            // The platform's checks, the installation's mark among them.
            defaultDoctorChecks: true,
        }),
    ],
    providers: [
        DoctorCommands,
        // Where tenant billing keeps the ends of subscriptions (`subscriptionEnds`).
        InstallationCliFlow,
        InstallationCommands,
        InstallationStatusCommand,
        InstallationMarkCommand,
    ],
})
export class CliModule {}
