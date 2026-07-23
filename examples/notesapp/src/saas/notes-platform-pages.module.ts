import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { NotesPlatformPagesController } from './notes-platform-pages.controller';
import { NotesPlatformPagesService } from './notes-platform-pages.service';
import { NotesPromoCodesController } from './notes-promo-codes.controller';

/**
 * App-owned SuperAdmin domain pages: tenants, users, audit, subscriptions and
 * promo codes. These sit next to the DB-backed catalog surface
 * (NotesCatalogModule) and the KPI/manifest wiring (NotesAdminModule); together
 * they complete the SuperAdmin UI on top of the app's own Prisma tables.
 */
@Module({
    imports: [PrismaModule],
    controllers: [NotesPlatformPagesController, NotesPromoCodesController],
    providers: [NotesPlatformPagesService],
})
export class NotesPlatformPagesModule {}
