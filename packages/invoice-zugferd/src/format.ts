// How the document writes a figure for a person and for a program. Pure, and
// independent of the locale data of the Node build that runs it: the same
// invoice renders into the same bytes everywhere (`SC-AUD-019`).

import type { CalendarDay } from '@saasicat/core';

/** An amount in whole cents: the unit every figure is compared and written in. */
export function centsOf(amount: number): number {
    return Math.round(amount * 100);
}

/** An amount as the XML writes it: `-1234.50`. */
export function xmlAmount(amount: number): string {
    const cents = centsOf(amount);
    const sign = cents < 0 ? '-' : '';
    const whole = Math.trunc(Math.abs(cents) / 100);
    return `${sign}${whole}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
}

/** An amount as the page shows it, in German: `-1.234,50`. */
export function pageAmount(amount: number): string {
    const cents = centsOf(amount);
    const sign = cents < 0 ? '-' : '';
    const whole = String(Math.trunc(Math.abs(cents) / 100));
    return `${sign}${thousands(whole)},${String(Math.abs(cents) % 100).padStart(2, '0')}`;
}

/** Digits in groups of three from the right, joined by a point: `1234567` is `1.234.567`. */
function thousands(digits: string): string {
    const groups: string[] = [];
    for (let end = digits.length; end > 0; end -= 3) {
        groups.unshift(digits.slice(Math.max(0, end - 3), end));
    }
    return groups.join('.');
}

/** A rate as the XML writes it: `19`, `7.5`. */
export function xmlRate(rate: number): string {
    return String(Math.round(rate * 100) / 100);
}

/** A rate as the page shows it: `19 %`, `7,5 %`. */
export function pageRate(rate: number): string {
    return `${xmlRate(rate).replace('.', ',')} %`;
}

/** A day as the XML writes it, in format 102: `20260201`. */
export function xmlDay(day: CalendarDay): string {
    return day.replaceAll('-', '');
}

/** A day as the page shows it: `01.02.2026`. */
export function pageDay(day: CalendarDay): string {
    const [year, month, date] = day.split('-');
    return `${date}.${month}.${year}`;
}

/** Text as it may stand in XML content or an attribute. */
export function xmlText(text: string): string {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}
