// A tenant's invoices with what each still owes, and its cases still open to
// reconcile, as the operator reads them beside the tenant.
//
// Asked for only where the manifest announces them: an installation that
// collects no invoices serves no such route.

import { computed, type ComputedRef, type Ref } from 'vue';
import {
    SUBSCRIBER_PAYMENTS_CAPABILITY,
    type AdminManifest,
    type AdminTenantPayments,
} from '@saasicat/core';

import type { Bound } from '../client/resources/define-resource.js';
import type { tenantsResource } from '../client/resources/tenants.resource.js';
import { useAsyncData, type AsyncData } from './use-async-data.js';

/** The tenant operation the payments call, already bound to the shell's client. */
export type TenantPaymentsResource = Pick<Bound<(typeof tenantsResource)['ops']>, 'payments'>;

export interface TenantPayments extends AsyncData<AdminTenantPayments | null> {
    /** Whether the platform serves them; nothing is shown without it. */
    available: ComputedRef<boolean>;
}

export function useTenantPayments(
    slug: Ref<string>,
    manifest: Ref<AdminManifest | null>,
    tenants: TenantPaymentsResource,
): TenantPayments {
    const available = computed(
        () => manifest.value?.capabilities?.[SUBSCRIBER_PAYMENTS_CAPABILITY] === true,
    );
    const payments = useAsyncData(
        async () => (available.value && slug.value ? tenants.payments(slug.value) : null),
        { initial: null, watch: [available], subject: slug },
    );
    return { ...payments, available };
}
