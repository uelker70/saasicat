// Formatting helper retained for the reusable catalog-history timeline.

import { formatMessage } from '../../client/i18n/format.js';
import { DEFAULT_SA_LOCALE, type SaLocale } from '../../client/i18n/locale.js';
import { planVersionsMessages } from '../../client/i18n/messages/plan-versions.js';

const EMPTY_VALUE = '—';

function texts(locale: SaLocale) {
    return planVersionsMessages[locale].format;
}

export function formatRelative(
    iso: string | undefined,
    locale: SaLocale = DEFAULT_SA_LOCALE,
    now: Date = new Date(),
): string {
    if (!iso) return EMPTY_VALUE;
    const msg = texts(locale);
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
