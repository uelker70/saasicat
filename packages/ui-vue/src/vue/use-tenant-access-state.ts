// useTenantAccessState — the tenant's state as its own users read it
// (`SC-ADM-054`): `GET /billing/account/access` for a user who holds the
// billing permission, which names the invoices by number and says whether
// they can be paid here, and `GET /billing/access` for everyone else. Both
// answer in every state, suspended and being deleted included.
//
// Asked in that order. The permission's route refuses a user without it, and
// is not mounted where invoices are not; a refusal that says a part is not for
// this user (`isHiddenFromThisUser`) is answered by the route every user
// reads. Where that one is not there either, there is nothing to show, which
// is not an error; anything else is.

import { ref, type Ref } from 'vue';
import type { TenantAccessState, TenantAccessView } from '@saasicat/core';

import { httpStatusOf } from '../client/admin-error.js';
import { isHiddenFromThisUser } from '../client/billing-area.js';
import { getJson, trimTrailingSlashes } from '../client/http-json.js';
import { defaultHttpClient, type HttpClient } from '../client/types.js';

export interface UseTenantAccessStateOptions {
    http?: HttpClient;
    /** The prefix the billing routes sit under, as for `useTenantBilling`. Default `/billing`. */
    apiPrefix?: string;
    /** Default `true`: loads once on the next tick. */
    autoLoad?: boolean;
}

export interface UseTenantAccessStateResult {
    /** The state as the server last answered it; `null` until then, or where no route answers. */
    view: Ref<TenantAccessView | null>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    /** Reads the state again. */
    reload(): Promise<void>;
}

const STATES: ReadonlySet<string> = new Set<TenantAccessState>([
    'open',
    'read-only',
    'suspended',
    'deleting',
]);

function isAccessView(value: unknown): value is TenantAccessView {
    return (
        typeof value === 'object' &&
        value !== null &&
        'state' in value &&
        typeof value.state === 'string' &&
        STATES.has(value.state) &&
        'reasons' in value &&
        Array.isArray(value.reasons) &&
        'holdsBillingPermission' in value &&
        typeof value.holdsBillingPermission === 'boolean' &&
        'mayPay' in value &&
        typeof value.mayPay === 'boolean'
    );
}

export function useTenantAccessState(
    options: UseTenantAccessStateOptions = {},
): UseTenantAccessStateResult {
    const prefix = trimTrailingSlashes(options.apiPrefix ?? '/billing');
    const http = options.http ?? defaultHttpClient();

    const view = ref<TenantAccessView | null>(null);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    /** The answer of `path`, or `null` where it says it is not for this user. */
    async function answerOf(path: string): Promise<TenantAccessView | null> {
        try {
            const answer = await getJson<unknown>(http, `${prefix}/${path}`);
            // Read as open, an answer without a state would hide from a
            // held-back tenant why it is held back.
            if (!isAccessView(answer)) {
                throw new Error(`${prefix}/${path} did not answer with a tenant access view.`);
            }
            return answer;
        } catch (err) {
            if (isHiddenFromThisUser(httpStatusOf(err))) return null;
            throw err;
        }
    }

    async function reload(): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            view.value = (await answerOf('account/access')) ?? (await answerOf('access'));
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
        } finally {
            loading.value = false;
        }
    }

    if (options.autoLoad !== false) {
        queueMicrotask(() => void reload());
    }

    return { view, loading, error, reload };
}
