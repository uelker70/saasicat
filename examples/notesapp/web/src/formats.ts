// How the app writes an amount and a day, one way for every page. A day the
// platform names reaches `formatDate` as noon of that day, read here in the
// viewer's zone, so it is written as the day the platform meant.

const currencyFormat = new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR' });
const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

export function formatCurrency(value: number): string {
    return currencyFormat.format(value);
}

export function formatDate(input: string | Date): string {
    return dateFormat.format(typeof input === 'string' ? new Date(input) : input);
}
