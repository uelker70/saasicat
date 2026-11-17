// useTenantKeep — what the tenant keeps for obligations of its own while its
// subscription's end holds it to reading (`SC-PRIV-022`), from
// `GET /billing/access/keep`, which every user of the tenant reads.
//
// Each read asks the application on the server, so a page reads it once, the
// first time the tenant's state says an end holds it to reading — not with
// every read of the state, which a page repeats while it is open. The lines
// are shown only while the state still says so: a tenant suspended or being
// deleted meanwhile is refused the route, and shows none. Where the route is
// not there, or the application gave nothing to show, there is nothing to
// show, which is not an error; anything else is.

import { computed, ref, shallowRef, watch, type Ref } from 'vue';
import {
    keepLinesProblem,
    type TenantAccessView,
    type TenantKeepLine,
    type TenantKeepView,
} from '@saasicat/core';

import { httpStatusOf } from '../client/admin-error.js';
import { isHiddenFromThisUser } from '../client/billing-area.js';
import { getJson, trimTrailingSlashes } from '../client/http-json.js';
import { defaultHttpClient, type HttpClient } from '../client/types.js';

export interface UseTenantKeepOptions {
    /** The tenant's state, as `useTenantAccessState` reads it. */
    view: Readonly<Ref<TenantAccessView | null>>;
    http?: HttpClient;
    /** The prefix the billing routes sit under, as for `useTenantBilling`. Default `/billing`. */
    apiPrefix?: string;
}

export interface UseTenantKeepResult {
    /**
     * The lines, while an end holds the tenant to reading and once read; none
     * may be among them. `null` otherwise, and where the route is not there or
     * the application gave nothing to show.
     */
    lines: Readonly<Ref<readonly TenantKeepLine[] | null>>;
    /** Why the read failed, where it did. */
    error: Readonly<Ref<Error | null>>;
}

/** Whether `view` says a subscription's end holds the tenant to reading. */
function endHoldsItToReading(view: TenantAccessView | null): boolean {
    return (
        view !== null &&
        view.state === 'read-only' &&
        view.reasons.some((reason) => reason.kind === 'ended')
    );
}

function isKeepView(value: unknown): value is TenantKeepView {
    return (
        typeof value === 'object' &&
        value !== null &&
        'keep' in value &&
        (value.keep === null || keepLinesProblem(value.keep) === null)
    );
}

export function useTenantKeep(options: UseTenantKeepOptions): UseTenantKeepResult {
    const path = `${trimTrailingSlashes(options.apiPrefix ?? '/billing')}/access/keep`;
    const http = options.http ?? defaultHttpClient();
    const read = shallowRef<readonly TenantKeepLine[] | null>(null);
    const error = ref<Error | null>(null);
    let asked = false;

    async function load(): Promise<void> {
        try {
            const answered = await getJson<unknown>(http, path);
            if (!isKeepView(answered)) {
                throw new Error(`${path} did not answer with what the tenant keeps.`);
            }
            read.value = answered.keep;
        } catch (err) {
            if (isHiddenFromThisUser(httpStatusOf(err))) return;
            error.value = err instanceof Error ? err : new Error(String(err));
        }
    }

    watch(
        () => endHoldsItToReading(options.view.value),
        (holds) => {
            if (!holds || asked) return;
            asked = true;
            void load();
        },
        { immediate: true },
    );

    const lines = computed(() => (endHoldsItToReading(options.view.value) ? read.value : null));
    return { lines, error };
}
