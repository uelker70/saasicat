// How the tenant's page and the subscriber's record write the days, moments,
// sizes and counts of a deletion: in the operator's language, a moment with
// its zone named. One place, so the two pages write the same deletion alike.

import { computed, type ComputedRef } from 'vue';

import { formatDay, formatFileSize, formatMoment } from '../client/i18n/format.js';
import type { TenantDeletionRecordWriters } from '../client/tenant-deletion-lines.js';
import { useSuperAdminI18n } from './use-super-admin-i18n.js';

export interface TenantDeletionPageWriters extends TenantDeletionRecordWriters {
    /** A number of things, such as what a store counted. */
    count: (value: number) => string;
}

export function useTenantDeletionWriters(): ComputedRef<TenantDeletionPageWriters> {
    const { intlLocale } = useSuperAdminI18n();
    return computed(() => {
        const locale = intlLocale.value;
        const counts = new Intl.NumberFormat(locale);
        return {
            day: (day) => formatDay(day, locale),
            moment: (iso) => formatMoment(iso, locale),
            size: (bytes) => formatFileSize(bytes, locale),
            count: (value) => counts.format(value),
        };
    });
}
