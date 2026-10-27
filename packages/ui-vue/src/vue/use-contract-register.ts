// The contract register of the installation (`SC-ADM-045`): every contract, a
// former subscriber's and a deleted tenant's included, the latest start first,
// a page at a time, narrowed to where the contracts stand on a day — today
// unless the operator picks another. Changing either reads the register anew
// from its first page.
//
// A composable rather than page script, so the sequence — the standing changed
// while a page is on its way — can be checked with `node --test` against
// `dist/`.

import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type {
    AdminContractRegisterPage,
    AdminRegisterContract,
    CalendarDay,
    ContractRegisterState,
    ContractStanding,
} from '@saasicat/core';

import type { Bound } from '../client/resources/define-resource.js';
import type {
    ContractRegisterRequest,
    contractsResource,
} from '../client/resources/contracts.resource.js';
import type { PillTone } from './status.js';
import { usePagedList, type PagedList } from './use-paged-list.js';

/** How each standing is marked: in force as current, ended as past, the others as what to look at. */
export const CONTRACT_STANDING_TONE: Readonly<Record<ContractStanding, PillTone>> = {
    'in-force': 'positive',
    scheduled: 'info',
    ended: 'muted',
    'never-in-force': 'warning',
};

/** The register's operation, already bound to the shell's client. */
export type ContractRegisterResource = Pick<Bound<(typeof contractsResource)['ops']>, 'page'>;

export interface ContractRegister {
    /** The standing listed; those in force at first. */
    state: Ref<ContractRegisterState>;
    /** The day every standing is read on; `null` or `''`, as a cleared date field leaves it, for today. */
    day: Ref<CalendarDay | null>;
    contracts: PagedList<AdminRegisterContract>;
    /** Today and the day read on, as the platform answered them; `null` before it has. */
    today: ComputedRef<CalendarDay | null>;
    readOn: ComputedRef<CalendarDay | null>;
}

export function useContractRegister(contracts: ContractRegisterResource): ContractRegister {
    const state = ref<ContractRegisterState>('in-force');
    const day = ref<CalendarDay | null>(null);
    const list = usePagedList<AdminContractRegisterPage, AdminRegisterContract>(
        (after) => {
            const request: ContractRegisterRequest = { state: state.value };
            if (day.value) request.day = day.value;
            if (after !== undefined) request.after = after;
            return contracts.page(request);
        },
        (page) => page.contracts,
        [state, day],
    );
    return {
        state,
        day,
        contracts: list,
        today: computed(() => list.first.data.value?.today ?? null),
        readOn: computed(() => list.first.data.value?.day ?? null),
    };
}
