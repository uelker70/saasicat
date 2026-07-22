// Formatting helpers for the plan-versions views.
//
// Phase 2c: Ported from a consumer admin.
// The time reference point for `formatRelative` is the moment of the call,
// not a hard-coded demo date (the ported template had `2026-05-04` —
// the platform must work in production).

import { formatCurrency } from '../../client/i18n/currency.js';
import { formatMessage } from '../../client/i18n/format.js';
import { DEFAULT_SA_LOCALE, SA_INTL_LOCALES, type SaLocale } from '../../client/i18n/locale.js';
import { planVersionsMessages } from '../../client/i18n/messages/plan-versions.js';

const EMPTY_VALUE = '—';

function texts(locale: SaLocale) {
    return planVersionsMessages[locale].format;
}

export function fmtEuro(n: number, locale: SaLocale = DEFAULT_SA_LOCALE): string {
    if (n === 0) return texts(locale).priceIndividual;
    return formatCurrency(n, locale);
}

export function fmtStorage(gb: number): string {
    if (gb === 0) return '500 MB';
    if (gb >= 1000 && gb % 1000 === 0) return `${gb / 1000} TB`;
    return `${gb} GB`;
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

export function formatDate(iso: string | undefined, locale: SaLocale = DEFAULT_SA_LOCALE): string {
    if (!iso) return EMPTY_VALUE;
    return new Date(iso).toLocaleDateString(SA_INTL_LOCALES[locale], {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

export function formatTimestamp(iso: string, locale: SaLocale = DEFAULT_SA_LOCALE): string {
    return new Date(iso).toLocaleString(SA_INTL_LOCALES[locale], {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}
