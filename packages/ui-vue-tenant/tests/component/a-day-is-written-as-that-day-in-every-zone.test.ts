// @requirement SC-UI-028 — Every day a tenant is shown is the installation's day, named by the server

import { afterEach, describe, expect, test } from 'vitest';

import { dayAsInstant, writeDay } from '../../src/day-as-instant.js';

// A day the server named reaches the application's date formatter as an
// instant, and that formatter reads it in the viewer's zone. Whatever zone that
// is — fourteen hours ahead of UTC or eleven behind — the formatter writes the
// day the server named.

const ZONES = [
    'Pacific/Kiritimati',
    'Pacific/Auckland',
    'Europe/Berlin',
    'UTC',
    'America/New_York',
    'Pacific/Pago_Pago',
];
const DAY = '2026-12-01';
const previousZone = process.env.TZ;

afterEach(() => {
    process.env.TZ = previousZone;
});

/** The day an instant falls on where the viewer is, as a browser's formatter reads it. */
const viewersDay = (iso: string) => {
    const at = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
};

describe('a day handed to the application’s formatter', () => {
    for (const zone of ZONES) {
        test(`is that day for a viewer in ${zone}`, () => {
            process.env.TZ = zone;
            expect(viewersDay(dayAsInstant(DAY))).toBe(DAY);
        });
    }

    test('is written by the application’s formatter, and a dash stands for none', () => {
        const formatter = (iso: string) => `day ${viewersDay(iso)}`;
        expect(writeDay(formatter, DAY)).toBe(`day ${DAY}`);
        expect(writeDay(formatter, null)).toBe('—');
        expect(writeDay(formatter, undefined)).toBe('—');
    });
});
