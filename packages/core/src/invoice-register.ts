// The months a view of the invoice register spans, and what its invoices add
// up to (`SC-ADM-042`).
//
// A month is the installation's: an invoice is dated in the zone
// `config/saas.yaml` names, so its month is the first seven characters of its
// issue date and nothing is read in another zone. The sums are taken per
// currency, tax treatment and rate rather than per rate alone, because two
// invoices at 0 % — one exempt, one under the reverse charge — are reported
// apart. A cancellation invoice states its amounts reversed, so it takes off
// in the month it was issued what the invoice it cancels added in its own.

import { INVOICE_ERROR_CODES, type InvoiceErrorCode } from './error-codes.js';
import {
    INVOICE_REGISTER_MAX_MONTHS,
    type AdminInvoiceMonthTotals,
    type AdminInvoiceRegisterTotals,
    type AdminInvoiceTotal,
    type CalendarMonth,
    type InvoiceRegisterQuery,
    type InvoiceRegisterRange,
    type IssuedInvoiceAmounts,
} from './invoice-register.types.js';
import { toCents } from './money.js';
import { TAX_TREATMENT_KINDS, type TaxTreatmentKind } from './tax.types.js';
import type { CalendarDay } from './zoned-day.js';

/** `YYYY-MM`, the year from 1000, the month from 01 to 12: a shape a `date` column can begin. */
export const CALENDAR_MONTH_PATTERN = /^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/;

const MONTHS_PER_YEAR = 12;

/** Whether `text` is a month as the register takes one. */
export function isCalendarMonth(text: string): boolean {
    return CALENDAR_MONTH_PATTERN.test(text);
}

/** The month a day belongs to. */
export function monthOfDay(day: CalendarDay): CalendarMonth {
    return day.slice(0, 7);
}

function yearAndMonth(month: CalendarMonth): { year: number; month: number } {
    if (!isCalendarMonth(month)) throw new RangeError(`${month} is not a month.`);
    return { year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) };
}

function monthNumbered(year: number, month: number): CalendarMonth {
    return `${String(year)}-${String(month).padStart(2, '0')}`;
}

/** The months since the year 0 before `month` begins: what two months are compared and counted by. */
function monthIndexOf(month: CalendarMonth): number {
    const { year, month: number } = yearAndMonth(month);
    return year * MONTHS_PER_YEAR + number - 1;
}

/** How many months `from` to `until` span, both included; 0 or less where `until` comes first. */
function monthsSpanned(from: CalendarMonth, until: CalendarMonth): number {
    return monthIndexOf(until) - monthIndexOf(from) + 1;
}

/** The months from `from` to `until`, both included, the earliest first; none where `until` comes first. */
export function monthsBetween(from: CalendarMonth, until: CalendarMonth): CalendarMonth[] {
    const months: CalendarMonth[] = [];
    for (let index = monthIndexOf(from); index <= monthIndexOf(until); index += 1) {
        months.push(
            monthNumbered(Math.floor(index / MONTHS_PER_YEAR), (index % MONTHS_PER_YEAR) + 1),
        );
    }
    return months;
}

/** The last day of a month, February in a leap year included. */
function lastDayOfMonth(month: CalendarMonth): CalendarDay {
    const { year, month: number } = yearAndMonth(month);
    // Day 0 of the month after is the last day of this one.
    const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
    return `${month}-${String(days).padStart(2, '0')}`;
}

/** Why the register does not answer for the months asked, with the values its message names. */
export interface InvoiceRegisterRangeRefusal {
    code: InvoiceErrorCode;
    params: Record<string, string | number>;
}

/** The months a view spans, and the issue dates a store reads them by. */
export interface InvoiceRegisterSpan {
    from: CalendarMonth;
    until: CalendarMonth;
    months: CalendarMonth[];
    days: InvoiceRegisterRange;
}

/**
 * The months `asked` names, read with `today` in the installation's zone: both
 * left out ask for the current month, one left out for the other alone. Refused
 * where `until` comes before `from`, and where the range spans more than
 * `INVOICE_REGISTER_MAX_MONTHS`, so that one read stays bounded — a longer
 * stretch is read a year at a time. Throws a `RangeError` for a month that is
 * not one; the boundary that takes the months checks their shape first.
 */
export function invoiceRegisterSpanOf(
    asked: InvoiceRegisterQuery,
    today: CalendarDay,
):
    | { span: InvoiceRegisterSpan; refusal: null }
    | { span: null; refusal: InvoiceRegisterRangeRefusal } {
    const from = asked.from ?? asked.until ?? monthOfDay(today);
    const until = asked.until ?? asked.from ?? monthOfDay(today);
    // Counted before the months are listed: a span of centuries is refused
    // without being written out first.
    const spanned = monthsSpanned(from, until);
    if (spanned < 1) {
        return {
            span: null,
            refusal: {
                code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_REGISTER_RANGE_REVERSED,
                params: { from, until },
            },
        };
    }
    if (spanned > INVOICE_REGISTER_MAX_MONTHS) {
        return {
            span: null,
            refusal: {
                code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_REGISTER_RANGE_TOO_LONG,
                params: { from, until, months: spanned, max: INVOICE_REGISTER_MAX_MONTHS },
            },
        };
    }
    return {
        span: {
            from,
            until,
            months: monthsBetween(from, until),
            days: { from: `${from}-01`, until: lastDayOfMonth(until) },
        },
        refusal: null,
    };
}

/** A sum while it is added up, in whole cents. */
interface Sum {
    currency: string;
    kind: TaxTreatmentKind;
    rate: number;
    net: number;
    tax: number;
}

function keyOf(currency: string, kind: TaxTreatmentKind, rate: number): string {
    return JSON.stringify([currency, kind, rate]);
}

function add(sums: Map<string, Sum>, amounts: IssuedInvoiceAmounts): void {
    for (const { rate, net, tax } of amounts.taxes) {
        const key = keyOf(amounts.currency, amounts.kind, rate);
        const sum = sums.get(key) ?? {
            currency: amounts.currency,
            kind: amounts.kind,
            rate,
            net: 0,
            tax: 0,
        };
        sum.net += toCents(net);
        sum.tax += toCents(tax);
        sums.set(key, sum);
    }
}

/** Currency, then treatment in the order `TAX_TREATMENT_KINDS` names them, then the lowest rate first. */
function bySumOrder(a: Sum, b: Sum): number {
    if (a.currency !== b.currency) return a.currency < b.currency ? -1 : 1;
    if (a.kind !== b.kind)
        return TAX_TREATMENT_KINDS.indexOf(a.kind) - TAX_TREATMENT_KINDS.indexOf(b.kind);
    return a.rate - b.rate;
}

function totalsOf(sums: Map<string, Sum>): AdminInvoiceTotal[] {
    return [...sums.values()].sort(bySumOrder).map((sum) => ({
        currency: sum.currency,
        kind: sum.kind,
        rate: sum.rate,
        net: sum.net / 100,
        tax: sum.tax / 100,
        gross: (sum.net + sum.tax) / 100,
    }));
}

/**
 * What the invoices of `span` add up to, per currency, treatment and rate:
 * every month of the span, one without invoices with no sums, and the span as
 * a whole. Added in whole cents, so a thousand invoices add up to what an
 * advisor's sum of them gives. Throws for an invoice dated outside the span,
 * which a store that read the span's days does not answer.
 */
export function invoiceRegisterTotalsOf(
    span: Pick<InvoiceRegisterSpan, 'from' | 'until' | 'months'>,
    issued: readonly IssuedInvoiceAmounts[],
): AdminInvoiceRegisterTotals {
    const perMonth = new Map(span.months.map((month) => [month, new Map<string, Sum>()]));
    const whole = new Map<string, Sum>();
    for (const amounts of issued) {
        const month = perMonth.get(monthOfDay(amounts.issueDate));
        if (!month) {
            throw new RangeError(
                `An invoice issued on ${amounts.issueDate} is outside ${span.from} to ${span.until}.`,
            );
        }
        add(month, amounts);
        add(whole, amounts);
    }
    const months: AdminInvoiceMonthTotals[] = span.months.map((month) => ({
        month,
        totals: totalsOf(perMonth.get(month) ?? new Map()),
    }));
    return { from: span.from, until: span.until, months, range: totalsOf(whole) };
}
