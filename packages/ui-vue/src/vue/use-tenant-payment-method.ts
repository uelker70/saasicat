// useTenantPaymentMethod — what the tenant's subscriber pays with, on its plan
// page: `GET /billing/payment-method` and `POST /billing/payment-method/setup`.
//
// Both routes sit behind the billing permission, and a refusal that says the
// card is not for this user (`isHiddenFromThisUser`) turns `available` false so
// the page shows no card. Anything else is an error the card reports.

import { ref, type Ref } from 'vue';
import type { CalendarDay } from '@saasicat/core';

import { httpStatusOf } from '../client/admin-error.js';
import { isHiddenFromThisUser } from '../client/billing-area.js';
import { getJson, postJson, trimTrailingSlashes } from '../client/http-json.js';
import { defaultHttpClient, type HttpClient } from '../client/types.js';

export type PaymentMethodTypeStr = 'card' | 'sepa_debit';

/** A payment method in use: what tells it apart, never enough to pay with it. */
export interface TenantPaymentMethodShape {
    type: PaymentMethodTypeStr;
    /** The card network, such as `visa`; `null` for a direct debit. */
    brand: string | null;
    last4: string;
    expiryMonth: number | null;
    expiryYear: number | null;
    country: string | null;
    /** The mandate a direct debit is collected under. */
    mandateReference: string | null;
    /** ISO timestamp of the gateway's confirmation. */
    confirmedAt: string;
}

export interface UseTenantPaymentMethodOptions {
    http?: HttpClient;
    /** The prefix the billing routes sit under, as for `useTenantBilling`. Default `/billing`. */
    apiPrefix?: string;
    /** Default `true`: loads once on the next tick. */
    autoLoad?: boolean;
}

export interface UseTenantPaymentMethodResult {
    paymentMethod: Ref<TenantPaymentMethodShape | null>;
    /**
     * The day a direct debit entered now is collected on at the earliest;
     * `null` until it is read, or where the server does not say.
     */
    directDebitCollectedOn: Ref<CalendarDay | null>;
    /** Whether this user may see it here at all — false without the routes or the permission. */
    available: Ref<boolean>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    reload(): Promise<void>;
    /**
     * Opens the gateway's form for a new payment method and answers the URL to
     * send the person to. The payment method in use stays until the gateway
     * confirms the new one.
     */
    startChange(urls: { successUrl: string; cancelUrl: string }): Promise<string>;
}

function isPaymentMethodAnswer(value: unknown): value is {
    paymentMethod: TenantPaymentMethodShape | null;
    directDebitCollectedOn?: unknown;
} {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.prototype.hasOwnProperty.call(value, 'paymentMethod')
    );
}

export function useTenantPaymentMethod(
    options: UseTenantPaymentMethodOptions = {},
): UseTenantPaymentMethodResult {
    const route = `${trimTrailingSlashes(options.apiPrefix ?? '/billing')}/payment-method`;
    const http = options.http ?? defaultHttpClient();

    const paymentMethod = ref<TenantPaymentMethodShape | null>(null);
    const directDebitCollectedOn = ref<CalendarDay | null>(null);
    const available = ref(false);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    async function reload(): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            const answer = await getJson<unknown>(http, route);
            if (!isPaymentMethodAnswer(answer)) {
                // An empty card would say "no payment method yet" about a subscriber
                // the page knows nothing about.
                throw new Error(`${route} did not answer with { paymentMethod }.`);
            }
            paymentMethod.value = answer.paymentMethod;
            directDebitCollectedOn.value =
                typeof answer.directDebitCollectedOn === 'string'
                    ? answer.directDebitCollectedOn
                    : null;
            available.value = true;
        } catch (err) {
            paymentMethod.value = null;
            available.value = !isHiddenFromThisUser(httpStatusOf(err));
            if (available.value) error.value = err instanceof Error ? err : new Error(String(err));
        } finally {
            loading.value = false;
        }
    }

    async function startChange(urls: { successUrl: string; cancelUrl: string }): Promise<string> {
        const { redirectUrl } = await postJson<{ redirectUrl: string }>(
            http,
            `${route}/setup`,
            urls,
        );
        return redirectUrl;
    }

    if (options.autoLoad !== false) {
        queueMicrotask(() => void reload());
    }

    return {
        paymentMethod,
        directDebitCollectedOn,
        available,
        loading,
        error,
        reload,
        startChange,
    };
}
