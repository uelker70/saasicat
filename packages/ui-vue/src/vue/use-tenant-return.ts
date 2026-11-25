// useTenantReturn — a tenant whose subscription ended comes back before its
// deletion day (`SC-CANC-034`): `POST /billing/subscription/return/preview`
// says what it would come back on and pay, or why it cannot, and
// `POST /billing/subscription/return` takes the new subscription out. Whether
// the return is offered to this user is the access state's to say
// (`TenantAccessView.mayReturn`).
//
// The shapes mirror what the platform's `TenantSubscriptionReturnController`
// answers; they are declared here rather than imported, so that the frontend
// bundle does not pull in the server's code. A return lifts the end and the
// read-only state it put the tenant in, and a refusal of one usually says the
// state moved under the page, so every reader of the tenant's state on the
// page is told to read it again once the server has answered.

import type {
    CalendarDay,
    SubscriptionContractPriceSnapshot,
    SubscriptionReturnRefusal,
    WithDays,
} from '@saasicat/core';

import { postJson, trimTrailingSlashes } from '../client/http-json.js';
import { announceTenantAccessChanged } from '../client/tenant-access-changed.js';
import { defaultHttpClient, type HttpClient } from '../client/types.js';
import type { BillingCycleStr, PlanChangePreviewIssueShape } from './use-tenant-billing.js';

/** The plan and the rhythm a tenant would come back on. */
export interface TenantReturnChoice {
    plan: string;
    billingCycle: BillingCycleStr;
}

/** What taking the return out sends: the choice, and the version and day its preview showed. */
export interface TenantReturnTakeOut extends TenantReturnChoice {
    /** The preview's `planVersionId`; `null` where the installation binds no version. */
    planVersionId: string | null;
    /** The deletion day the preview named, which the server checks is still the one that applies. */
    expectedDeletesOn: CalendarDay;
}

/** The subscription a tenant comes back on, with the days of its first period. */
export type SubscriptionReturnedShape = WithDays<
    {
        plan: string;
        billingCycle: BillingCycleStr;
        /** The version on sale it is bound to; `null` where the installation binds none. */
        planVersionId: string | null;
        /** Its first period, from the moment of the return. */
        periodStart: string;
        periodEnd: string;
    },
    'periodStart' | 'periodEnd'
>;

/** What a tenant that can come back is shown before it does. */
export type SubscriptionReturnTermsShape = SubscriptionReturnedShape & {
    refusal: null;
    /** The deletion day the return lifts. */
    deletesOn: CalendarDay;
    /** What stands in the way of the plan chosen, as a plan change to it is told; none to confirm. */
    blockers: PlanChangePreviewIssueShape[];
    /**
     * One period of the new contract; `null` where the installation keeps no
     * contracts, and while a blocker stands in the way.
     */
    price: SubscriptionContractPriceSnapshot | null;
    /** The days of notice a cancellation of the new subscription is owed. */
    cancellationNoticeDays: number;
    /** Whether a payment method has to be entered before the return is taken out. */
    paymentMethodRequired: boolean;
};

/** Why the tenant cannot come back, and the deletion day of the end that stands, where one does. */
export interface SubscriptionReturnRefusedShape {
    refusal: SubscriptionReturnRefusal;
    deletesOn: CalendarDay | null;
}

export type SubscriptionReturnPreviewShape =
    SubscriptionReturnTermsShape | SubscriptionReturnRefusedShape;

export interface UseTenantReturnOptions {
    http?: HttpClient;
    /** The prefix the billing routes sit under, as for `useTenantBilling`. Default `/billing`. */
    apiPrefix?: string;
}

export interface UseTenantReturnResult {
    /** What the tenant would come back on and pay for `choice`, or why it cannot; a refusal of the request reaches the caller. */
    preview(choice: TenantReturnChoice): Promise<SubscriptionReturnPreviewShape>;
    /**
     * Takes the new subscription out. Whatever the server answers, every
     * reader of the tenant's state on the page is told to read it again. A
     * refusal reaches the caller with its code — `PLAN_CHANGE_QUOTE_CHANGED`
     * carrying the preview as it now stands.
     */
    takeOut(choice: TenantReturnTakeOut): Promise<SubscriptionReturnedShape>;
}

/** Whether `value` names a subscription with the days of its first period. */
function isReturned(value: unknown): value is SubscriptionReturnedShape {
    return (
        typeof value === 'object' &&
        value !== null &&
        'plan' in value &&
        typeof value.plan === 'string' &&
        'periodStart' in value &&
        typeof value.periodStart === 'string' &&
        'periodStartDays' in value &&
        typeof value.periodStartDays === 'object' &&
        value.periodStartDays !== null &&
        'periodEndDays' in value &&
        typeof value.periodEndDays === 'object' &&
        value.periodEndDays !== null
    );
}

function isPreview(value: unknown): value is SubscriptionReturnPreviewShape {
    if (typeof value !== 'object' || value === null || !('refusal' in value)) return false;
    if (typeof value.refusal === 'string') return true;
    return (
        value.refusal === null &&
        'blockers' in value &&
        Array.isArray(value.blockers) &&
        isReturned(value)
    );
}

export function useTenantReturn(options: UseTenantReturnOptions = {}): UseTenantReturnResult {
    const route = `${trimTrailingSlashes(options.apiPrefix ?? '/billing')}/subscription/return`;
    const http = options.http ?? defaultHttpClient();

    async function preview(choice: TenantReturnChoice): Promise<SubscriptionReturnPreviewShape> {
        const answered = await postJson<unknown>(http, `${route}/preview`, {
            plan: choice.plan,
            billingCycle: choice.billingCycle,
        });
        // An answer that is neither would be shown as terms nobody stated.
        if (!isPreview(answered)) {
            throw new Error(`${route}/preview did not answer with what a return would be.`);
        }
        return answered;
    }

    async function takeOut(choice: TenantReturnTakeOut): Promise<SubscriptionReturnedShape> {
        const body: TenantReturnChoice & {
            expectedDeletesOn: CalendarDay;
            planVersionId?: string;
        } = {
            plan: choice.plan,
            billingCycle: choice.billingCycle,
            expectedDeletesOn: choice.expectedDeletesOn,
        };
        // Left out where the installation binds no version, as a plan change does.
        if (choice.planVersionId !== null) body.planVersionId = choice.planVersionId;
        let answered: unknown;
        try {
            answered = await postJson<unknown>(http, route, body);
        } finally {
            // Taken out, the state moved; refused, it is usually why — a
            // deletion day that has come, an end being recorded.
            announceTenantAccessChanged();
        }
        if (!isReturned(answered)) {
            throw new Error(`${route} did not answer with the subscription taken out.`);
        }
        return answered;
    }

    return { preview, takeOut };
}
