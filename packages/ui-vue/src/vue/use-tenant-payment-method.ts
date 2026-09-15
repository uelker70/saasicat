// useTenantPaymentMethod — what the tenant's subscriber pays with, on its plan
// page: `GET /billing/payment-method` and `POST /billing/payment-method/setup`.
//
// Both routes sit behind the billing permission, and an installation that takes
// no payment methods does not mount them. A 403 and a 404 are therefore answers
// about what this user may see, not failures, and `available` turns false so
// the page shows no card. Anything else is an error the card reports.

import { ref, type Ref } from 'vue';

import { httpStatusOf } from '../client/admin-error.js';
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

function isPaymentMethodAnswer(
    value: unknown,
): value is { paymentMethod: TenantPaymentMethodShape | null } {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.prototype.hasOwnProperty.call(value, 'paymentMethod')
    );
}

/** The statuses that say the card is not for this user, rather than that loading it failed. */
const NOT_SHOWN = new Set([403, 404, 501]);

export function useTenantPaymentMethod(
    options: UseTenantPaymentMethodOptions = {},
): UseTenantPaymentMethodResult {
    const route = `${trimTrailingSlashes(options.apiPrefix ?? '/billing')}/payment-method`;
    const http = options.http ?? defaultHttpClient();

    const paymentMethod = ref<TenantPaymentMethodShape | null>(null);
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
            available.value = true;
        } catch (err) {
            paymentMethod.value = null;
            const status = httpStatusOf(err);
            available.value = status === undefined || !NOT_SHOWN.has(status);
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
        Promise.resolve().then(() => void reload());
    }

    return { paymentMethod, available, loading, error, reload, startChange };
}
