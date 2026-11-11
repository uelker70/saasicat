import type { AnnouncedDeletion } from '@saasicat/core';

import { writeDay } from './day-as-instant.js';
import { messageText } from './message-parts.js';

/**
 * The sentence that tells a tenant until when it can only read its data once its
 * subscription has ended, and the day it is deleted on — `template` with
 * `{readOnlyUntil}` and `{deletesOn}` written as the application writes a day.
 *
 * Both are days the server named in the installation's zone (`SC-UI-028`),
 * written as they are: counting them here from the moment the subscription
 * ends would name another day wherever the viewer's zone, or the read-only
 * period the tenant was told, is not the one a browser would assume.
 *
 * Null where the server named none — a booking ending alone deletes nothing,
 * an installation may record no end of a subscription, and a server that
 * predates the days answers without them. A sentence with a dash where a day
 * should be would announce a deletion nobody scheduled.
 */
export function deletionSentence(
    template: string,
    deletion: AnnouncedDeletion | null | undefined,
    formatDate: (iso: string) => string,
): string | null {
    if (!deletion) return null;
    return messageText(template, {
        readOnlyUntil: writeDay(formatDate, deletion.readOnlyUntil),
        deletesOn: writeDay(formatDate, deletion.deletesOn),
    });
}
