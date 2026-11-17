// Where a tenant's deletion stands, as the operator reads it on the tenant's
// page (`SC-ADM-058`).
//
// Asked for only where the manifest announces it: an installation that does
// not serve the view has no such route, and a request for it would answer 404
// — shown as an error on a page that has nothing wrong with it. A tenant the
// application does not have is refused with `TENANT_NOT_FOUND`; the page that
// names it says so already, so here it is nothing to show.

import { computed, type ComputedRef, type Ref } from 'vue';
import {
    BILLING_ERROR_CODES,
    TENANT_DELETION_CAPABILITY,
    type AdminManifest,
    type AdminTenantDeletion,
    type TenantDeletionStatus,
} from '@saasicat/core';

import { toAdminError } from '../client/admin-error.js';
import type { Bound } from '../client/resources/define-resource.js';
import type { tenantsResource } from '../client/resources/tenants.resource.js';
import type { PillTone } from './status.js';
import { useAsyncData, type AsyncData } from './use-async-data.js';

/**
 * Tone per state of a deletion. `halted` is `warning`: it waits for the
 * operator's act elsewhere, and on a database not yet marked it is the preview
 * the operator chose. `retrying` is `negative`: a run failed at it, and some
 * failures do not pass by themselves.
 */
export const TENANT_DELETION_STATE_TONE: Readonly<Record<TenantDeletionStatus['kind'], PillTone>> =
    {
        scheduled: 'info',
        due: 'primary',
        halted: 'warning',
        running: 'primary',
        retrying: 'negative',
        deleted: 'muted',
    };

export interface TenantDeletion extends AsyncData<AdminTenantDeletion | null> {
    /** Whether the platform serves the view; nothing is shown without it. */
    available: ComputedRef<boolean>;
}

export function useTenantDeletion(
    slug: Ref<string>,
    manifest: Ref<AdminManifest | null>,
    tenants: Pick<Bound<(typeof tenantsResource)['ops']>, 'deletion'>,
): TenantDeletion {
    const available = computed(
        () => manifest.value?.capabilities?.[TENANT_DELETION_CAPABILITY] === true,
    );
    const deletion = useAsyncData(
        async () => {
            if (!available.value || !slug.value) return null;
            try {
                return await tenants.deletion(slug.value);
            } catch (err) {
                const refusal = toAdminError(err);
                if (refusal.code === BILLING_ERROR_CODES.TENANT_NOT_FOUND) return null;
                throw refusal;
            }
        },
        { initial: null, watch: [available], subject: slug },
    );
    return { ...deletion, available };
}
