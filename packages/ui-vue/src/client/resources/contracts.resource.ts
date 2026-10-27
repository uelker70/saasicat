// The contract register of the installation (`SC-ADM-045`): a page of every
// contract, a former subscriber's and a deleted tenant's included, narrowed to
// where the contracts stand on a day. A contract opens in its subscriber's
// record. Served where the manifest announces `contracts.read`; elsewhere the
// route answers 404.

import type { AdminContractRegisterPage, CalendarDay, ContractRegisterState } from '@saasicat/core';

import { defineResource } from './define-resource.js';
import { requestJsonBody } from './resource-request.js';

/** What one page of the register is asked for. */
export interface ContractRegisterRequest {
    /** The standing to list; the platform lists those in force where none is named. */
    state?: ContractRegisterState;
    /** The day every standing is read on; the platform reads today where none is named. */
    day?: CalendarDay;
    /** The contract the page before ended with. */
    after?: string;
}

export const contractsResource = defineResource('contracts', {
    /** One page of the register, the latest start first. */
    page: (
        http,
        ctx,
        request: ContractRegisterRequest = {},
    ): Promise<AdminContractRegisterPage> => {
        const query = new URLSearchParams();
        if (request.state) query.set('state', request.state);
        if (request.day) query.set('day', request.day);
        if (request.after) query.set('after', request.after);
        const search = query.toString();
        return requestJsonBody<AdminContractRegisterPage>(
            http,
            `${ctx.apiBase}/contracts${search === '' ? '' : `?${search}`}`,
            'The contract register returned no body',
        );
    },
});
