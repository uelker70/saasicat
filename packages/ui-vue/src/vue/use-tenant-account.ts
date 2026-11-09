// useTenantAccount — what the tenant's subscriber owes and is owed, in its
// billing area: `GET /billing/account`, per currency what is open and of that
// overdue, and beside it the credit to be paid out (`SC-PRIC-049`); and paying
// what is open now, `POST /billing/account/pay` (`SC-PRIC-100`).
//
// Behind the billing permission like the invoices, so a refusal that says this
// part is not for the user (`isHiddenFromThisUser`) turns `available` false,
// and anything else is an error the page reports. The server adds it up, from
// the standings the invoice list shows; this only carries it to the page.

import { ref, type Ref } from 'vue';
import type {
    CalendarDay,
    TenantAccount,
    TenantAccountBalance,
    TenantPaymentStarted,
} from '@saasicat/core';

import { httpStatusOf } from '../client/admin-error.js';
import { isHiddenFromThisUser } from '../client/billing-area.js';
import { getJson, postJson, trimTrailingSlashes } from '../client/http-json.js';
import { defaultHttpClient, type HttpClient } from '../client/types.js';

export interface UseTenantAccountOptions {
    http?: HttpClient;
    /** The prefix the billing routes sit under, as for `useTenantBilling`. Default `/billing`. */
    apiPrefix?: string;
    /** Default `true`: loads once on the next tick. */
    autoLoad?: boolean;
}

export interface UseTenantAccountResult {
    /** One balance per currency in which anything is open; empty where nothing is. */
    balances: Ref<TenantAccountBalance[]>;
    /**
     * The day a direct debit announced now is collected on, which paying now
     * by direct debit waits for; `null` until the account is read, or where
     * the server does not say.
     */
    directDebitCollectedOn: Ref<CalendarDay | null>;
    /** Whether this user may see it here at all — false without the route or the permission. */
    available: Ref<boolean>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    /** Reads the account again. */
    reload(): Promise<void>;
    /** Whether paying now is on its way to the server. */
    paying: Ref<boolean>;
    /** What the last payment started now set going; `null` until one was started. */
    started: Ref<TenantPaymentStarted | null>;
    /** Why the last payment could not be started; `null` where it could. */
    payError: Ref<Error | null>;
    /**
     * Pays every invoice still open now, with the payment method in use, then
     * reads the account again (`SC-PRIC-100`).
     */
    payNow(): Promise<void>;
}

function isAccount(value: unknown): value is TenantAccount {
    return (
        typeof value === 'object' &&
        value !== null &&
        'balances' in value &&
        Array.isArray(value.balances)
    );
}

export function useTenantAccount(options: UseTenantAccountOptions = {}): UseTenantAccountResult {
    const prefix = trimTrailingSlashes(options.apiPrefix ?? '/billing');
    const http = options.http ?? defaultHttpClient();

    const balances = ref<TenantAccountBalance[]>([]);
    const directDebitCollectedOn = ref<CalendarDay | null>(null);
    const available = ref(false);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    async function reload(): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            const answer = await getJson<unknown>(http, `${prefix}/account`);
            // Read as nothing open, an answer without balances would tell a
            // subscriber that owes something that it owes nothing.
            if (!isAccount(answer)) {
                throw new Error(`${prefix}/account did not answer with { balances }.`);
            }
            balances.value = answer.balances;
            directDebitCollectedOn.value =
                typeof answer.directDebitCollectedOn === 'string'
                    ? answer.directDebitCollectedOn
                    : null;
            available.value = true;
        } catch (err) {
            available.value = !isHiddenFromThisUser(httpStatusOf(err));
            if (available.value) error.value = err instanceof Error ? err : new Error(String(err));
        } finally {
            loading.value = false;
        }
    }

    const paying = ref(false);
    const started = ref<TenantPaymentStarted | null>(null);
    const payError = ref<Error | null>(null);

    async function payNow(): Promise<void> {
        paying.value = true;
        payError.value = null;
        try {
            started.value = await postJson<TenantPaymentStarted>(http, `${prefix}/account/pay`, {});
            await reload();
        } catch (err) {
            payError.value = err instanceof Error ? err : new Error(String(err));
        } finally {
            paying.value = false;
        }
    }

    if (options.autoLoad !== false) {
        queueMicrotask(() => void reload());
    }

    return {
        balances,
        directDebitCollectedOn,
        available,
        loading,
        error,
        reload,
        paying,
        started,
        payError,
        payNow,
    };
}
