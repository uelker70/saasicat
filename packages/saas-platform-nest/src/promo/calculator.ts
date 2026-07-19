// Promo-Code-Calculator — pure functions. Keine DB, keine Seiteneffekte.
//
// Aus autohauspro/backend/src/promo-codes/promo-codes.calculator.ts extrahiert
// (P1 Promo-Slice, UMSETZUNGSPLAN.md §3.2).
//
// Statt Prisma-Typen nutzt der Calculator die generischen Wire-Format-
// Types aus @saasicat/types. Damit ist er für AutohausPro,
// vereinsfux und perspektivisch Dagitto (via Wire-Format) gleichermaßen
// nutzbar.

import type {
    BillingCycle,
    PromoCodeDurationType,
    PromoCodeValueType,
} from '@saasicat/types';
import { round2 } from './math.js';

/** Strukturelle Sicht auf einen PromoCode für die Calculator-Funktionen.
 *
 * `value` akzeptiert bewusst `number | string | { toString(): string }`, damit
 * Prisma `Decimal` (eigene Klasse mit `toString()`) ohne Cast übergeben werden
 * kann. Innen wird `Number(...)` aufgerufen.
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
 * Nächstes Datum, an dem wieder der Listenpreis gilt (= Ende der
 * Rabatt-Laufzeit). Bei ONCE: erste Rechnung ist rabattiert, alle weiteren
 * regulär — also direkt die zweite Periode.
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

export function buildLabel(
    code: Pick<PromoCodeForCalc, 'valueType' | 'value' | 'durationType' | 'durationValue'>,
    cycle: BillingCycle,
): string {
    const value = Number(code.value);
    const valueStr =
        code.valueType === 'PERCENT'
            ? `${value.toLocaleString('de-DE')} %`
            : `${value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

    if (code.durationType === 'ONCE') {
        return `${valueStr} einmalig`;
    }
    if (code.durationType === 'MONTHS') {
        const m = code.durationValue ?? 0;
        return m === 1 ? `${valueStr} im ersten Monat` : `${valueStr} für ${m} Monate`;
    }
    // BILLING_CYCLES (oder undefined)
    const n = code.durationValue ?? 0;
    if (n === 1)
        return cycle === 'YEARLY' ? `${valueStr} im ersten Jahr` : `${valueStr} im ersten Monat`;
    return cycle === 'YEARLY'
        ? `${valueStr} in den ersten ${n} Jahren`
        : `${valueStr} in den ersten ${n} Monaten`;
}
