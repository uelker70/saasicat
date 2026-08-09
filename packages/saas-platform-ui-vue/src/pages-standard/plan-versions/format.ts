// Formatting helper retained for the reusable catalog-history timeline.

import { formatMessage } from '../../client/i18n/format.js';
import type { SaMessages } from '../../client/i18n/messages.js';

// The resolved slice, not a locale code: only this way do an app-supplied
// language and `i18n.overrides` reach the relative-date wording.
type SaPlanVersionsMessages = SaMessages['planVersions'];

const EMPTY_VALUE = '—';

export function formatRelative(
    iso: string | undefined,
    planVersions: SaPlanVersionsMessages,
    now: Date = new Date(),
): string {
    if (!iso) return EMPTY_VALUE;
    const msg = planVersions.format;
    const d = new Date(iso);
    const diffMs = now.getTime() - d.getTime();
    const days = Math.floor(diffMs / 86_400_000);
    if (days === 0) return msg.today;
    if (days === 1) return msg.yesterday;
    if (days < 7) return formatMessage(msg.daysAgo, { count: days });
    if (days < 30) {
        const w = Math.floor(days / 7);
        return formatMessage(w > 1 ? msg.weeksAgoMany : msg.weeksAgoOne, { count: w });
    }
    if (days < 365) return formatMessage(msg.monthsAgo, { count: Math.floor(days / 30) });
    const y = Math.floor(days / 365);
    return formatMessage(y > 1 ? msg.yearsAgoMany : msg.yearsAgoOne, { count: y });
}
