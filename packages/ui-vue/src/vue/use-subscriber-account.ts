// A subscriber's account, as the operator reads it in the subscriber's record.
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
import type { subscribersResource } from '../client/resources/subscribers.resource.js';
import { useAsyncData, type AsyncData } from './use-async-data.js';

export interface SubscriberAccount extends AsyncData<AdminSubscriberAccount | null> {
    /** Whether the platform serves the account; nothing is shown without it. */
    available: ComputedRef<boolean>;
}

export function useSubscriberAccount(
    subscriberId: Ref<string>,
    manifest: Ref<AdminManifest | null>,
    subscribers: Pick<Bound<(typeof subscribersResource)['ops']>, 'charges'>,
): SubscriberAccount {
    const available = computed(
        () => manifest.value?.capabilities?.[SUBSCRIBER_ACCOUNT_CAPABILITY] === true,
    );
    const account = useAsyncData(
        async () =>
            available.value && subscriberId.value ? subscribers.charges(subscriberId.value) : null,
        { initial: null, watch: [available], subject: subscriberId },
    );
    return { ...account, available };
}
