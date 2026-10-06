// The subscriber of a tenant, as the operator reads it beside the tenant.
//
// Asked for only where the manifest announces it: an installation that keeps
// no subscribers serves no such route, and a request for it would answer 404 —
// shown as an error on a page that has nothing wrong with it.

import { computed, type ComputedRef, type Ref } from 'vue';
import {
    SUBSCRIBER_STANDING_CAPABILITY,
    type AdminManifest,
    type AdminTenantSubscriber,
} from '@saasicat/core';

import type { Bound } from '../client/resources/define-resource.js';
import type { tenantsResource } from '../client/resources/tenants.resource.js';
import { useAsyncData, type AsyncData } from './use-async-data.js';

export interface TenantSubscriber extends AsyncData<AdminTenantSubscriber | null> {
    /** Whether the platform serves the subscriber; nothing is shown without it. */
    available: ComputedRef<boolean>;
}

export function useTenantSubscriber(
    slug: Ref<string>,
    manifest: Ref<AdminManifest | null>,
    tenants: Pick<Bound<(typeof tenantsResource)['ops']>, 'subscriber'>,
): TenantSubscriber {
    const available = computed(
        () => manifest.value?.capabilities?.[SUBSCRIBER_STANDING_CAPABILITY] === true,
    );
    const subscriber = useAsyncData(
        async () => (available.value && slug.value ? tenants.subscriber(slug.value) : null),
        { initial: null, watch: [available], subject: slug },
    );
    return { ...subscriber, available };
}
