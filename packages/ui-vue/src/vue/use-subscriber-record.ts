// The head of a subscriber's record: its standing and every tenant it was
// linked to, read by the subscriber's id (`SC-ADM-021`, `SC-ADM-036`).
//
// Asked for only where the manifest announces subscribers: an installation
// that keeps none serves no such route.

import { computed, type ComputedRef, type Ref } from 'vue';
import {
    SUBSCRIBER_STANDING_CAPABILITY,
    type AdminManifest,
    type AdminSubscriberRecord,
} from '@saasicat/core';

import type { Bound } from '../client/resources/define-resource.js';
import type { subscribersResource } from '../client/resources/subscribers.resource.js';
import { useAsyncData, type AsyncData } from './use-async-data.js';

export interface SubscriberRecordHead extends AsyncData<AdminSubscriberRecord | null> {
    /** Whether the platform serves subscribers; nothing is asked without it. */
    available: ComputedRef<boolean>;
}

export function useSubscriberRecord(
    subscriberId: Ref<string>,
    manifest: Ref<AdminManifest | null>,
    subscribers: Pick<Bound<(typeof subscribersResource)['ops']>, 'record'>,
): SubscriberRecordHead {
    const available = computed(
        () => manifest.value?.capabilities?.[SUBSCRIBER_STANDING_CAPABILITY] === true,
    );
    const record = useAsyncData(
        async () =>
            available.value && subscriberId.value ? subscribers.record(subscriberId.value) : null,
        { initial: null, watch: [available], subject: subscriberId },
    );
    return { ...record, available };
}
