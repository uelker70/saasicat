// The deletions of a subscriber's tenants, as the operator reads them in the
// subscriber's record (`SC-ADM-058`) — also of a tenant the application no
// longer has (`SC-ADM-021`).
//
// Asked for only where the manifest announces it, as on the tenant's page. A
// subscriber the platform does not have is refused with
// `SUBSCRIBER_NOT_FOUND`; the record that names it says so already, so here
// it is nothing to show.

import { computed, type ComputedRef, type Ref } from 'vue';
import {
    SUBSCRIBER_ERROR_CODES,
    TENANT_DELETION_CAPABILITY,
    type AdminManifest,
    type AdminTenantDeletion,
} from '@saasicat/core';

import { toAdminError } from '../client/admin-error.js';
import type { Bound } from '../client/resources/define-resource.js';
import type { subscribersResource } from '../client/resources/subscribers.resource.js';
import { useAsyncData, type AsyncData } from './use-async-data.js';

export interface SubscriberDeletions extends AsyncData<AdminTenantDeletion[]> {
    /** Whether the platform serves the view; nothing is shown without it. */
    available: ComputedRef<boolean>;
}

export function useSubscriberDeletions(
    subscriberId: Ref<string>,
    manifest: Ref<AdminManifest | null>,
    subscribers: Pick<Bound<(typeof subscribersResource)['ops']>, 'deletions'>,
): SubscriberDeletions {
    const available = computed(
        () => manifest.value?.capabilities?.[TENANT_DELETION_CAPABILITY] === true,
    );
    const deletions = useAsyncData(
        async (): Promise<AdminTenantDeletion[]> => {
            if (!available.value || !subscriberId.value) return [];
            try {
                return await subscribers.deletions(subscriberId.value);
            } catch (err) {
                const refusal = toAdminError(err);
                if (refusal.code === SUBSCRIBER_ERROR_CODES.SUBSCRIBER_NOT_FOUND) return [];
                throw refusal;
            }
        },
        { initial: [], watch: [available], subject: subscriberId },
    );
    return { ...deletions, available };
}
