/**
 * A quota's value as the tenant pages show it when the application passes no
 * formatter of its own: `-1` is unlimited, a storage quota is in GB, and a
 * count is written in the reader's locale. A value a plan does not carry
 * shows as a dash rather than failing.
 */
export function defaultQuotaValue(
    key: string,
    value: number | null | undefined,
    locale: string,
): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '–';
    if (value < 0) return '∞';
    if (key.toLowerCase().includes('storage')) return `${value} GB`;
    return value.toLocaleString(locale);
}
