// Currency formatting for the admin UI. Amounts are net euro values; the
// grouping and decimal separator follow the active UI locale
// (de → `12.345,60 €`, en → `€12,345.60`).

import { DEFAULT_SA_LOCALE, SA_INTL_LOCALES, type SaLocale } from './locale.js';

const DEFAULT_CURRENCY = 'EUR';

const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(locale: SaLocale, currency: string, decimals: number): Intl.NumberFormat {
    const key = `${locale}:${currency}:${decimals}`;
    let formatter = formatters.get(key);
    if (!formatter) {
        formatter = new Intl.NumberFormat(SA_INTL_LOCALES[locale], {
            style: 'currency',
            currency,
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        });
        formatters.set(key, formatter);
    }
    return formatter;
}

/**
 * Formats a net amount for display. Whole amounts drop the decimals (`29 €`
 * rather than `29,00 €`) — the plan and bundle prices the admin UI shows are
 * mostly round numbers, and the zeros are noise in dense tables.
 *
 * Returns an em dash for null/undefined and for values that are not finite
 * numbers, so callers can pass raw API fields straight through.
 */
export function formatCurrency(
    amount: number | string | null | undefined,
    locale: SaLocale = DEFAULT_SA_LOCALE,
    currency: string = DEFAULT_CURRENCY,
): string {
    const value = typeof amount === 'string' ? Number(amount) : amount;
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    return formatterFor(locale, currency, Number.isInteger(value) ? 0 : 2).format(value);
}
