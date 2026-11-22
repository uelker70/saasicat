// useTenantBillingDetails — whom the tenant's subscription is billed to, in its
// billing area: `GET /billing/details` and `PATCH /billing/details`.
//
// Behind the billing permission like the payment method, so a refusal that
// says this part is not for the user (`isHiddenFromThisUser`) turns `available`
// false, and anything else is an error the page reports. A change names only
// the contact details: the legal name and the tax identifiers are the party the
// contract was concluded with, shown here and corrected by the operator. Of the
// contact details, the answer names the ones the tenant changes here; the
// application keeps the others on a page of its own.

import { ref, type Ref } from 'vue';
import type { SubscriberContactField, SubscriberReadiness } from '@saasicat/core';

import { httpStatusOf } from '../client/admin-error.js';
import { isHiddenFromThisUser } from '../client/billing-area.js';
import { getJson, patchJson, trimTrailingSlashes } from '../client/http-json.js';
import { defaultHttpClient, type HttpClient } from '../client/types.js';

/** The subscriber as its tenant sees it. */
export interface TenantBillingDetailsShape {
    customerNumber: string;
    legalName: string;
    vatId: string | null;
    taxNumber: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    postalCode: string | null;
    city: string | null;
    /** ISO 3166-1 alpha-2, upper case. */
    country: string | null;
    invoiceEmail: string | null;
    /** Whether it acts as a business; set at sign-up and corrected by the operator. */
    business: boolean | null;
    /**
     * Where a tax adapter decides, what holds its next contract back; `null`
     * where none decides.
     */
    readiness: SubscriberReadiness | null;
    /**
     * The contact details the tenant changes here, in the order of
     * `SUBSCRIBER_CONTACT_FIELDS`; the application changes the others on a
     * page of its own (`tenantBilling.billingDetails`), and a change naming
     * one is refused.
     */
    tenantEditable: TenantBillingContactField[];
}

/** The details a tenant may change in its billing area: how it is reached. */
export type TenantBillingContactField = SubscriberContactField;

/** A change of the contact details; a field left out keeps its value. */
export type TenantBillingContactChange = Partial<
    Pick<TenantBillingDetailsShape, TenantBillingContactField>
>;

export interface UseTenantBillingDetailsOptions {
    http?: HttpClient;
    /** The prefix the billing routes sit under, as for `useTenantBilling`. Default `/billing`. */
    apiPrefix?: string;
    /** Default `true`: loads once on the next tick. */
    autoLoad?: boolean;
}

export interface UseTenantBillingDetailsResult {
    details: Ref<TenantBillingDetailsShape | null>;
    /** Whether this user may see them here at all — false without the routes or the permission. */
    available: Ref<boolean>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    reload(): Promise<void>;
    /**
     * Writes a change and answers the details as they now stand. A refusal
     * reaches the caller with its code — `SUBSCRIBER_DETAIL_INVALID` names the
     * field in its params — and the details shown stay as they were.
     */
    save(change: TenantBillingContactChange): Promise<TenantBillingDetailsShape>;
}

function isDetailsAnswer(value: unknown): value is { details: TenantBillingDetailsShape } {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    if (!('details' in value)) return false;
    const details = value.details;
    // Without the list, a page could only guess which details are offered as
    // fields, and offering every one would invite changes the server refuses.
    return (
        details !== null &&
        typeof details === 'object' &&
        'customerNumber' in details &&
        typeof details.customerNumber === 'string' &&
        'legalName' in details &&
        typeof details.legalName === 'string' &&
        'tenantEditable' in details &&
        Array.isArray(details.tenantEditable)
    );
}

export function useTenantBillingDetails(
    options: UseTenantBillingDetailsOptions = {},
): UseTenantBillingDetailsResult {
    const route = `${trimTrailingSlashes(options.apiPrefix ?? '/billing')}/details`;
    const http = options.http ?? defaultHttpClient();

    const details = ref<TenantBillingDetailsShape | null>(null);
    const available = ref(false);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    function answered(answer: unknown): TenantBillingDetailsShape {
        // Empty fields would read as a subscriber nobody has told anything,
        // about one the page simply could not read.
        if (!isDetailsAnswer(answer)) throw new Error(`${route} did not answer with { details }.`);
        return answer.details;
    }

    async function reload(): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            details.value = answered(await getJson<unknown>(http, route));
            available.value = true;
        } catch (err) {
            details.value = null;
            available.value = !isHiddenFromThisUser(httpStatusOf(err));
            if (available.value) error.value = err instanceof Error ? err : new Error(String(err));
        } finally {
            loading.value = false;
        }
    }

    async function save(change: TenantBillingContactChange): Promise<TenantBillingDetailsShape> {
        const saved = answered(await patchJson<unknown>(http, route, change));
        details.value = saved;
        return saved;
    }

    if (options.autoLoad !== false) {
        queueMicrotask(() => void reload());
    }

    return { details, available, loading, error, reload, save };
}
