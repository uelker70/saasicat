// The days the administration shows, read in the installation's time zone as
// the shell's manifest names it (`client/installation-day.ts`, `SC-ADM-048`):
// one composable a page or section asks for each kind of day, so the decision
// which day a value is stands at the field and nowhere else.

import type { CalendarDay } from '@saasicat/core';

import {
    dayOfMoment,
    installationZoneOf,
    lastDayBefore,
    storedDayOf,
    todayIn,
} from '../client/installation-day.js';
import { useSuperAdminManifest } from './use-super-admin-context.js';

/** What stands for a day that is not there. */
const NO_DAY = '—';

export interface InstallationDays {
    /** The installation's time zone, UTC where the manifest names none. */
    timeZone: string;
    /** The day the moment `iso` falls on there, `YYYY-MM-DD`; a dash for none. */
    ofMoment(iso: string | null | undefined): string;
    /** The last day an end at `iso` still covers there, `YYYY-MM-DD`; a dash for none. */
    lastBefore(iso: string | null | undefined): string;
    /** The day somebody picked, stored as its UTC midnight, `YYYY-MM-DD`; a dash for none. */
    stored(iso: string | null | undefined): string;
    /** Today there. */
    today(): CalendarDay;
}

export function useInstallationDays(): InstallationDays {
    const timeZone = installationZoneOf(useSuperAdminManifest());
    return {
        timeZone,
        ofMoment: (iso) => (iso ? dayOfMoment(iso, timeZone) : NO_DAY),
        lastBefore: (iso) => (iso ? lastDayBefore(iso, timeZone) : NO_DAY),
        stored: (iso) => (iso ? storedDayOf(iso) : NO_DAY),
        today: () => todayIn(timeZone),
    };
}
