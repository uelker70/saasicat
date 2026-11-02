// @requirement SC-UI-028 — Every day a tenant is shown is the installation's day, named by the server

import { describe, expect, test } from 'vitest';
import { ERROR_MESSAGES_DE, ERROR_MESSAGES_EN } from '@saasicat/core';

import { issueSentence, refusalMessage } from '../../src/refusal-of.js';

// A refusal that names a day names the day the server read in the
// installation's zone, and says which of its values are days; the page writes
// exactly those with the application's formatter, as it writes every other day.
// Where a sentence means two days — the last one an add-on still runs and the
// first one without it — it names both, so it agrees with the add-on's card.

/** The day an instant falls on where the viewer is, written the way a German page writes it. */
function formatDate(value: string | Date): string {
    const at = new Date(value);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()}`;
}

const refused = (body: unknown) => Object.assign(new Error('422'), { body });

/** An add-on a plan change cannot carry, whose earliest end is midnight before 1 December. */
const IN_THE_WAY = {
    code: 'BUNDLE_BOOKING_DOES_NOT_FIT_TARGET_PLAN',
    message: 'Export cannot run on Basic and runs until 2026-11-30 at the earliest. …',
    params: { bundleName: 'Export', planName: 'Basic', until: '2026-12-01', lastDay: '2026-11-30' },
    dayParams: ['until', 'lastDay'],
};

describe('a refusal that names a day', () => {
    test('writes it as the application writes days', () => {
        expect(refusalMessage(refused(IN_THE_WAY), ERROR_MESSAGES_DE, formatDate)).toBe(
            'Export kann im Paket Basic nicht laufen und läuft frühestens bis 30.11.2026. Ist es ' +
                'gekündigt, geht ein Wechsel durch, der am 01.12.2026 oder später wirksam wird — ' +
                'oder wählen Sie ein anderes Paket.',
        );
    });

    test('names the last day it runs and the first day without it, in English as well', () => {
        expect(refusalMessage(refused(IN_THE_WAY), ERROR_MESSAGES_EN, formatDate)).toBe(
            'Export cannot run on Basic and runs until 30.11.2026 at the earliest. Once it is ' +
                'cancelled, a change that takes effect on or after 01.12.2026 goes through — or ' +
                'choose another plan.',
        );
    });

    test('writes only the values it names as days', () => {
        const unnamed = { ...IN_THE_WAY, params: { ...IN_THE_WAY.params, planName: '2026-12-24' } };
        expect(refusalMessage(refused(unnamed), ERROR_MESSAGES_EN, formatDate)).toContain(
            'cannot run on 2026-12-24',
        );
    });

    test('from a server that names none, leaves the values as they came', () => {
        const older = {
            code: IN_THE_WAY.code,
            message: IN_THE_WAY.message,
            params: IN_THE_WAY.params,
        };
        expect(refusalMessage(refused(older), ERROR_MESSAGES_EN, formatDate)).toContain(
            'runs until 2026-11-30 at the earliest',
        );
    });

    test('a blocker of a preview writes its days the same way', () => {
        expect(issueSentence(IN_THE_WAY, ERROR_MESSAGES_DE, formatDate)).toContain(
            'läuft frühestens bis 30.11.2026',
        );
    });

    test('ending at once, refused for a cancellation on record, names the last day it runs', () => {
        const recorded = {
            code: 'FEATURE_WITHDRAWAL_END_NOW_UNSUPPORTED',
            message: 'Your cancellation is recorded …',
            params: { date: '2026-12-01', lastDay: '2026-11-30' },
            dayParams: ['date', 'lastDay'],
        };
        expect(refusalMessage(refused(recorded), ERROR_MESSAGES_DE, formatDate)).toBe(
            'Ihre Kündigung ist erfasst und kann hier nicht vorgezogen werden: Es läuft bis ' +
                '30.11.2026, und bis dahin gilt die Minderung.',
        );
    });
});
