// The contract the operator opened in a subscriber's record, read as it was
// frozen (`SC-ADM-041`): one at a time, the way the record's timeline opens
// them, and read for each contract opened.
//
// The open contract belongs to the subscriber it was opened for, so turning to
// another subscriber's record finds nothing open and asks nothing about a
// contract of the one before.

import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { AdminSubscriberContractDossier } from '@saasicat/core';

import type { Bound } from '../client/resources/define-resource.js';
import type { subscribersResource } from '../client/resources/subscribers.resource.js';
import { useAsyncData, type AsyncData } from './use-async-data.js';

/** The subscriber operation the dossier calls, already bound to the shell's client. */
export type ContractDossierResource = Pick<Bound<(typeof subscribersResource)['ops']>, 'contract'>;

export interface ContractDossier extends AsyncData<AdminSubscriberContractDossier | null> {
    /** The contract open in the timeline; `null` while none is. */
    openId: ComputedRef<string | null>;
    /** Opens `contractId`, or closes it where it is the one open. */
    toggle(contractId: string): void;
    /** Opens `contractId`, the one a link into the record names. */
    open(contractId: string): void;
}

/** The element a contract's entry in the record's timeline is found by. */
export function contractAnchorOf(contractId: string): string {
    return `sa-contract-${contractId}`;
}

export function useContractDossier(
    subscriberId: Ref<string>,
    subscribers: ContractDossierResource,
): ContractDossier {
    const opened = ref<{ subscriberId: string; contractId: string } | null>(null);
    const openId = computed(() =>
        opened.value && opened.value.subscriberId === subscriberId.value
            ? opened.value.contractId
            : null,
    );
    const dossier = useAsyncData(
        async () => {
            const contractId = openId.value;
            return contractId ? subscribers.contract(subscriberId.value, contractId) : null;
        },
        { initial: null, subject: openId },
    );
    return {
        ...dossier,
        openId,
        toggle(contractId) {
            opened.value =
                openId.value === contractId
                    ? null
                    : { subscriberId: subscriberId.value, contractId };
        },
        open(contractId) {
            opened.value = { subscriberId: subscriberId.value, contractId };
        },
    };
}
