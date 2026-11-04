// How the app writes an amount and a day, one way for every page. A day the
// platform names reaches `formatDate` as noon of that day, read here in the
// viewer's zone, so it is written as the day the platform meant.

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

/** An amount in `currency` (ISO 4217), which the billing section hands over with each one. */
export function formatCurrency(value: number, currency = 'EUR'): string {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(value);
}

export function formatDate(input: string | Date): string {
    return dateFormat.format(typeof input === 'string' ? new Date(input) : input);
}
