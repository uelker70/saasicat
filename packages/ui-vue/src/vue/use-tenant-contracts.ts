// A tenant's contracts with where each confirmation stands, as the operator
// reads them beside the tenant (`SC-AUD-016`).
//
// Asked for only where the manifest announces them: an installation that
// issues no invoices confirms no contracts, and serves no such route.

import { computed, type ComputedRef, type Ref } from 'vue';
import {
    CONTRACT_CONFIRMATIONS_CAPABILITY,
    type AdminContractConfirmationState,
    type AdminManifest,
    type AdminTenantContracts,
} from '@saasicat/core';

import type { Bound } from '../client/resources/define-resource.js';
import type { tenantsResource } from '../client/resources/tenants.resource.js';
import type { PillTone } from './status.js';
import { useAsyncData, type AsyncData } from './use-async-data.js';

/**
 * Tone per state of a contract's confirmation. `being-made` is `warning`: it
 * is where a held confirmation waits, which the operator may have to act on;
 * `not-due` is `muted`, a contract written before confirmations that never
 * gets one.
 */
export const CONFIRMATION_STATE_TONE: Readonly<Record<AdminContractConfirmationState, PillTone>> = {
    'not-due': 'muted',
    'being-made': 'warning',
    'awaiting-mail': 'info',
    sent: 'positive',
};

/** The tenant operation the contracts call, already bound to the shell's client. */
export type TenantContractsResource = Pick<Bound<(typeof tenantsResource)['ops']>, 'contracts'>;

export interface TenantContracts extends AsyncData<AdminTenantContracts | null> {
    /** Whether the platform serves them; nothing is shown without it. */
    available: ComputedRef<boolean>;
}

export function useTenantContracts(
    slug: Ref<string>,
    manifest: Ref<AdminManifest | null>,
    tenants: TenantContractsResource,
): TenantContracts {
    const available = computed(
        () => manifest.value?.capabilities?.[CONTRACT_CONFIRMATIONS_CAPABILITY] === true,
    );
    const contracts = useAsyncData(
        async () => (available.value && slug.value ? tenants.contracts(slug.value) : null),
        { initial: null, watch: [available], subject: slug },
    );
    return { ...contracts, available };
}
