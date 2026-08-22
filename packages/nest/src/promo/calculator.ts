// Promo code calculator — pure functions. No DB, no side effects.
//
// Instead of Prisma types, the calculator uses the generic wire-format
// types from @saasicat/core. This makes it equally usable for all
// consuming apps (including those working purely via the wire format).

import type { BillingCycle, PromoCodeDurationType, PromoCodeValueType } from '@saasicat/core';
import { round2 } from './math.js';

/** Structural view of a PromoCode for the calculator functions.
 *
 * `value` deliberately accepts `number | string | { toString(): string }`, so
 * that a Prisma `Decimal` (its own class with `toString()`) can be passed
 * without a cast. Internally `Number(...)` is called.
 */
export interface PromoCodeForCalc {
    valueType: PromoCodeValueType | string;
    value: number | string | { toString(): string };
    durationType?: PromoCodeDurationType | string;
    durationValue?: number | null;
}

export function computeDiscountGross(
    plan: { gross: number },
    code: Pick<PromoCodeForCalc, 'valueType' | 'value'>,
): number {
    const v = Number(code.value);
    if (code.valueType === 'PERCENT') {
        return round2((plan.gross * v) / 100);
    }
    return round2(v);
}

export function computeDiscountedGross(planGross: number, discountGross: number): number {
    return round2(planGross - discountGross);
}

/**
 * Next date on which the list price applies again (= end of the discount
 * period). For ONCE: the first invoice is discounted, all others are
 * regular — so directly the second period.
 */
export function computeRegularStartsAt(
    startsAt: Date,
    cycle: BillingCycle,
    durationType: PromoCodeDurationType,
    durationValue: number | null,
): Date {
    const result = new Date(startsAt);
    if (durationType === 'ONCE') {
        return addCycles(result, cycle, 1);
    }
    if (durationType === 'MONTHS') {
        result.setMonth(result.getMonth() + (durationValue ?? 0));
        return result;
    }
    return addCycles(result, cycle, durationValue ?? 0);
}

export function addCycles(date: Date, cycle: BillingCycle, n: number): Date {
    const r = new Date(date);
    if (cycle === 'YEARLY') {
        r.setFullYear(r.getFullYear() + n);
    } else {
        r.setMonth(r.getMonth() + n);
    }
    return r;
}

/** Number locale and currency for {@link buildLabel}. */
export interface PromoLabelOptions {
    /**
     * BCP-47 tag deciding grouping, decimal separator, and where the currency
     * symbol sits: `'de-DE'` produces `1.234,56 €`, `'en-US'` produces
     * `€1,234.56`.
     *
     * A tag whose LANGUAGE the runtime cannot serve is a configuration error
     * and throws. `Intl` alone does not give that: it rejects a malformed tag,
     * but a well-formed one it does not know — `'zz-ZZ'` — silently resolves to
     * the runtime default, which on this one is `en-US`. An amount then reaches
     * the customer formatted in a language nobody chose.
     *
     * The check reaches exactly that far, and it is worth knowing where it
     * stops: `supportedLocalesOf` accepts an unknown REGION on a known language,
     * so `'de-ED'` passes and formats as `de`. Measured, not assumed. That
     * fallback stays inside the language the caller asked for, which is the
     * difference between a typo costing a separator and costing a language.
     */
    locale?: string;
    /**
     * ISO-4217 code for `ABSOLUTE` values, e.g. `'EUR'`, `'CHF'`, `'JPY'`.
     * The code also decides the number of decimals — two for EUR, none for
     * JPY — because the minor-unit count is a property of the currency, not a
     * formatting preference. Percentages ignore this.
     *
     * Not checked against a list, unlike the locale. `Intl` rejects a code that
     * is not three letters and renders a three-letter one it does not know as
     * itself — `1.234,56 XBT` is wrong but visible, where a wrong locale is
     * silent. And no enumeration available here separates a made-up code from a
     * real one it omits: `Intl.supportedValuesOf('currency')` leaves out `XAU`,
     * `XAG` and `XPT`, which are assigned. See `requireSupportedLocale`.
     */
    currency?: string;
}

/**
 * The words below are English; the numbers used to be German, unconditionally.
 * These defaults keep that output byte for byte, so a consumer that never
 * chose a locale does not see its checkout text move. They are legacy, not a
 * recommendation: pass the locale and currency your audience reads in.
 */
const LEGACY_LABEL_LOCALE = 'de-DE';
const LEGACY_LABEL_CURRENCY = 'EUR';

/**
 * ICU spaces a number from its unit — and in some locales its thousands from
 * each other — with a non-breaking space (U+00A0), and since ICU 72 with a
 * narrow one (U+202F) in a growing set of locales. Every such space in the
 * formatted number is folded to a plain one: the label goes over the wire and
 * into consumer assertions, where an invisible character that shifts with the
 * runtime's ICU version is a liability. It renders the same, and `1.234,56 €`
 * stays the byte string it has always been.
 */
const ICU_NON_BREAKING_SPACES = /[\u00A0\u202F]/g;

/**
 * Rejects a locale the runtime would quietly replace.
 *
 * `Intl` throws for a malformed tag and falls back for a well-formed one it does
 * not know, which is the wrong way round for a configuration value: a typo is
 * usually well formed. `'zz-ZZ'` resolves to the runtime default and formats an
 * amount in a language nobody chose.
 *
 * The currency is deliberately NOT checked the same way, and the asymmetry is
 * measured rather than assumed. `Intl` renders a three-letter code it does not
 * know as itself — `30,00 XBT` — which is wrong but visible, where a wrong
 * locale is silent. And the only enumeration available cannot tell a made-up
 * code from a real one it happens not to list:
 *
 *     Intl.supportedValuesOf('currency').includes('XAU')  → false
 *     new Intl.NumberFormat('de-DE', …'XAU').format(30)   → '30,00 XAU'
 *
 * `XAU`, `XAG` and `XPT` are assigned ISO-4217 codes for gold, silver and
 * platinum. Checking against that list would reject them to catch a typo the
 * operator can already see, and the alternative — a hand-written ISO-4217 table
 * — is the same defect one level up.
 */
function requireSupportedLocale(locale: string): void {
    if (Intl.NumberFormat.supportedLocalesOf([locale]).length === 0) {
        throw new RangeError(
            `buildLabel: locale "${locale}" names a language this runtime cannot serve. It ` +
                `would be formatted as "${new Intl.NumberFormat(locale).resolvedOptions().locale}" ` +
                'instead — a language nobody chose. Pass a tag the runtime serves.',
        );
    }
}

function formatPromoValue(
    value: number,
    valueType: PromoCodeValueType | string,
    { locale = LEGACY_LABEL_LOCALE, currency = LEGACY_LABEL_CURRENCY }: PromoLabelOptions,
): string {
    requireSupportedLocale(locale);
    const numberFormat: Intl.NumberFormatOptions =
        valueType === 'PERCENT'
            ? { style: 'unit', unit: 'percent' }
            : { style: 'currency', currency };
    return new Intl.NumberFormat(locale, numberFormat)
        .format(value)
        .replace(ICU_NON_BREAKING_SPACES, ' ');
}

/**
 * Human-readable summary of a promo code, e.g. `25 % once` or
 * `1.234,56 € for the first month`.
 *
 * The words are English and cannot be swapped here — translating them needs
 * the parts (`valueType`, `value`, `durationType`, `durationValue`), which the
 * promo preview response already carries next to this string. Composing the
 * sentence in the consumer's own i18n layer is the better answer and the one
 * planned for the next breaking release; until then `options` at least stops
 * the function from deciding number locale and currency for everyone.
 */
export function buildLabel(
    code: Pick<PromoCodeForCalc, 'valueType' | 'value' | 'durationType' | 'durationValue'>,
    cycle: BillingCycle,
    options: PromoLabelOptions = {},
): string {
    const value = Number(code.value);
    const valueStr = formatPromoValue(value, code.valueType, options);

    if (code.durationType === 'ONCE') {
        return `${valueStr} once`;
    }
    if (code.durationType === 'MONTHS') {
        const m = code.durationValue ?? 0;
        return m === 1 ? `${valueStr} for the first month` : `${valueStr} for ${m} months`;
    }
    // BILLING_CYCLES (or undefined)
    const n = code.durationValue ?? 0;
    if (n === 1)
        return cycle === 'YEARLY'
            ? `${valueStr} for the first year`
            : `${valueStr} for the first month`;
    return cycle === 'YEARLY'
        ? `${valueStr} for the first ${n} years`
        : `${valueStr} for the first ${n} months`;
}
