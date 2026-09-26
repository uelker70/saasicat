// The account of a tenant's subscriber, as the operator reads it beside the
// tenant.
//
// Asked for only where the manifest announces it: an installation without a
// charge journal serves no such route, and a request for it would answer 404 —
// shown as an error on a page that has nothing wrong with it.

import { computed, type ComputedRef, type Ref } from 'vue';
import {
    SUBSCRIBER_ACCOUNT_CAPABILITY,
    type AdminManifest,
    type AdminSubscriberAccount,
} from '@saasicat/core';

import type { Bound } from '../client/resources/define-resource.js';
import type { tenantsResource } from '../client/resources/tenants.resource.js';
import { useAsyncData, type AsyncData } from './use-async-data.js';

export interface TenantAccount extends AsyncData<AdminSubscriberAccount | null> {
    /** Whether the platform serves the account; nothing is shown without it. */
    available: ComputedRef<boolean>;
}

export function useTenantAccount(
    slug: Ref<string>,
    manifest: Ref<AdminManifest | null>,
    tenants: Pick<Bound<(typeof tenantsResource)['ops']>, 'charges'>,
): TenantAccount {
    const available = computed(
        () => manifest.value?.capabilities?.[SUBSCRIBER_ACCOUNT_CAPABILITY] === true,
    );
    const account = useAsyncData(
        async () => (available.value && slug.value ? tenants.charges(slug.value) : null),
        { initial: null, watch: [slug, available] },
    );
    return { ...account, available };
}
