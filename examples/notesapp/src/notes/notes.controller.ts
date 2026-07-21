import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { RequireFeature } from '@saasicat/nest/billing';
import { EnforceQuota, ImplementsCapability } from '@saasicat/nest/discovery';
import { CreateNoteDto } from './create-note.dto';
import { NotesService } from './notes.service';

interface DemoRequest {
    user: { tenantId: string };
}

/**
 * The four platform decorators in action: `@ImplementsCapability` feeds
 * discovery, `@RequireFeature` gates by plan feature (403), `@EnforceQuota`
 * blocks over-limit creates (402 via `LimitExceededFilter`). Enforcement is
 * fully automatic — no platform code inside the handlers; auth comes from
 * the global DemoAuthGuard (see DemoAuthModule).
 */
@Controller('notes')
export class NotesController {
    constructor(private readonly notes: NotesService) {}

    @Get()
    @RequireFeature('NOTES')
    list(@Req() req: DemoRequest) {
        return this.notes.list(req.user.tenantId);
    }

    @Post()
    @ImplementsCapability('notes.create', {
        label: 'Create note',
        feature: 'NOTES',
        kind: 'endpoint',
        owner: 'notes',
    })
    @RequireFeature('NOTES')
    @EnforceQuota('notesMax')
    create(@Req() req: DemoRequest, @Body() dto: CreateNoteDto) {
        return this.notes.create(req.user.tenantId, dto);
    }

    @Post('export')
    @ImplementsCapability('notes.export', {
        label: 'Export notes',
        feature: 'NOTES_EXPORT',
        kind: 'endpoint',
        owner: 'notes',
    })
    @RequireFeature('NOTES_EXPORT') // STARTER → 403, PRO → export
    async export(@Req() req: DemoRequest) {
        const notes = await this.notes.list(req.user.tenantId);
        return { format: 'json', count: notes.length, notes };
    }
}
