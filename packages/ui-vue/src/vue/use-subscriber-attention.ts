// Which tenants of a list hold their subscriber back from its next contract.
//
// Asked for only where the manifest announces it, which the platform does only
// where a tax adapter decides: without one nothing holds a contract back, and
// a list should not pay a request to be told so.

import { computed, type ComputedRef, type Ref } from 'vue';
import {
    SUBSCRIBER_ATTENTION_CAPABILITY,
    type AdminManifest,
    type SubscriberReadiness,
} from '@saasicat/core';

import type { Bound } from '../client/resources/define-resource.js';
import type { tenantsResource } from '../client/resources/tenants.resource.js';
import { useAsyncData, type AsyncData } from './use-async-data.js';

export interface SubscriberAttention extends AsyncData<ReadonlyMap<string, SubscriberReadiness>> {
    /** Whether the platform marks held-back subscribers at all. */
    available: ComputedRef<boolean>;
    /** What holds the tenant's subscriber back, or `null` where nothing does. */
    of(tenantId: string | undefined): SubscriberReadiness | null;
}

const NONE: ReadonlyMap<string, SubscriberReadiness> = new Map();

export function useSubscriberAttention(
    tenantIds: Ref<readonly string[]>,
    manifest: Ref<AdminManifest | null>,
    tenants: Pick<Bound<(typeof tenantsResource)['ops']>, 'subscriberAttention'>,
): SubscriberAttention {
    const available = computed(
        () => manifest.value?.capabilities?.[SUBSCRIBER_ATTENTION_CAPABILITY] === true,
    );
    const attention = useAsyncData<ReadonlyMap<string, SubscriberReadiness>>(
        async () => {
            if (!available.value || tenantIds.value.length === 0) return NONE;
            const held = await tenants.subscriberAttention(tenantIds.value);
            return new Map(held.map(({ tenantId, readiness }) => [tenantId, readiness]));
        },
        { initial: NONE, watch: [tenantIds, available] },
    );
    return {
        ...attention,
        available,
        of: (tenantId) => (tenantId ? (attention.data.value.get(tenantId) ?? null) : null),
    };
}
