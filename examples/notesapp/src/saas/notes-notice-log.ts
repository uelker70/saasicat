import { Injectable, Logger } from '@nestjs/common';
import type {
    SubscriptionNotice,
    SubscriptionNoticeDelivery,
    SubscriptionNoticePort,
} from '@saasicat/core';
import { PrismaService } from '../prisma/prisma.service';

/** How the notes app says it sent a notice, as the platform records it. */
const CHANNEL = 'log';

/**
 * The notes app's notice port: how a tenant's users hear what the platform
 * decides is due. Here that is the reminder before the tenant's data is
 * deleted, which names the day and where to take the export first
 * (`SC-CANC-022`); the notes app turns on no other notice.
 *
 * The notes app sends no e-mail, so it writes each notice to its log, for the
 * tenant's users, and answers who it went to — their ids, not their addresses,
 * so the log carries nobody's e-mail — and how. The platform records that
 * answer. A real app finds the tenant's administrators and e-mails them in its
 * own words. A tenant without users is told nobody: the platform records that
 * and does not try again.
 */
@Injectable()
export class NotesNoticeLog implements SubscriptionNoticePort {
    private readonly logger = new Logger(NotesNoticeLog.name);

    constructor(private readonly prisma: PrismaService) {}

    async deliver(notice: SubscriptionNotice): Promise<SubscriptionNoticeDelivery> {
        const users = await this.prisma.user.findMany({
            where: { tenantId: notice.tenantId },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
        });
        const recipients = users.map((user) => user.id);
        if (recipients.length > 0) {
            this.logger.log(`To users ${recipients.join(', ')}: ${wordingOf(notice)}`);
        }
        return { recipients, channel: CHANNEL };
    }
}

/** What the notice says, in the notes app's words. */
function wordingOf(notice: SubscriptionNotice): string {
    if (notice.kind !== 'deletion-reminder') return `A notice of kind ${notice.kind}.`;
    const deletion =
        `Your notes are deleted on ${notice.deletesOn}. Until ${notice.readOnlyUntil} you can ` +
        'still read them and take everything as one file from GET billing/export.';
    // The notes app's own report keeps nothing (`NotesKeepReport`), so this
    // sentence never appears in its log; an app that reports lines says them
    // here, in the reader's language where `labels` names it.
    if (notice.keep.length === 0) return deletion;
    const lines = notice.keep.map((line) => `${line.labels.en}: ${line.count}`).join(', ');
    return (
        `${deletion} Take along what you have to keep yourself, as the deletion does not wait ` +
        `for them: ${lines}.`
    );
}
