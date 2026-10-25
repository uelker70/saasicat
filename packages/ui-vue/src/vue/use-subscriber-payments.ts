// A subscriber's invoices with what each still owes, and its cases still open
// to reconcile, as the operator reads them in the subscriber's record.
//
// Asked for only where the manifest announces them: an installation that
// collects no invoices serves no such route.

import { computed, type ComputedRef, type Ref } from 'vue';
import {
    SUBSCRIBER_PAYMENTS_CAPABILITY,
    type AdminManifest,
    type AdminSubscriberPayments,
} from '@saasicat/core';

import type { Bound } from '../client/resources/define-resource.js';
import type { subscribersResource } from '../client/resources/subscribers.resource.js';
import { useAsyncData, type AsyncData } from './use-async-data.js';

/** The subscriber operation the payments call, already bound to the shell's client. */
export type SubscriberPaymentsResource = Pick<
    Bound<(typeof subscribersResource)['ops']>,
    'payments'
>;

export interface SubscriberPayments extends AsyncData<AdminSubscriberPayments | null> {
    /** Whether the platform serves them; nothing is shown without it. */
    available: ComputedRef<boolean>;
}

export function useSubscriberPayments(
    subscriberId: Ref<string>,
    manifest: Ref<AdminManifest | null>,
    subscribers: SubscriberPaymentsResource,
): SubscriberPayments {
    const available = computed(
        () => manifest.value?.capabilities?.[SUBSCRIBER_PAYMENTS_CAPABILITY] === true,
    );
    const payments = useAsyncData(
        async () =>
            available.value && subscriberId.value ? subscribers.payments(subscriberId.value) : null,
        { initial: null, watch: [available], subject: subscriberId },
    );
    return { ...payments, available };
}
