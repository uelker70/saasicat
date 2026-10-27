// The contract register of the installation (`SC-ADM-045`): every contract, a
// former subscriber's and a deleted tenant's included, the latest start first,
// a page at a time, narrowed to where the contracts stand on a day — today
// unless the operator picks another. Changing either reads the register anew
// from its first page.
//
// A composable rather than page script, so the sequence — the standing changed
// while a page is on its way — can be checked with `node --test` against
// `dist/`.

import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import {
    CALENDAR_DAY_PATTERN,
    type AdminContractRegisterPage,
    type AdminRegisterContract,
    type CalendarDay,
    type ContractRegisterState,
    type ContractStanding,
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
    // The day asked for: none for a cleared field, the last whole day while a
    // date field still shows a year being typed.
    const asked = ref<CalendarDay | null>(null);
    watch(day, (value) => {
        if (!value) asked.value = null;
        else if (CALENDAR_DAY_PATTERN.test(value)) asked.value = value;
    });
    const list = usePagedList<AdminContractRegisterPage, AdminRegisterContract>(
        (after, first) => {
            const request: ContractRegisterRequest = { state: state.value };
            // A later page is read on the day the first one was, so a list read
            // across midnight does not join two days.
            const on = after === undefined ? asked.value : (first?.day ?? asked.value);
            if (on) request.day = on;
            if (after !== undefined) request.after = after;
            return contracts.page(request);
        },
        (page) => page.contracts,
        [state, asked],
    );
    return {
        state,
        day,
        contracts: list,
        today: computed(() => list.first.data.value?.today ?? null),
        readOn: computed(() => list.first.data.value?.day ?? null),
    };
}
