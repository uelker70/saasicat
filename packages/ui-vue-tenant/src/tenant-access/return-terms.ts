// What the dialog that brings a tenant back says (`SC-CANC-034`), as sentences
// built from the server's preview: what one period costs, from which day, how
// it can be cancelled, which deletion it lifts and whether the tenant is open
// again at once — or, where it cannot come back, why, in the words the route
// refuses with. Every day in it is a day the server named, written as the
// application writes days. A day is not assumed: where the preview names no
// deletion day, the sentence says the deletion is lifted without one.

import {
    TENANT_ACCESS_ERROR_CODES,
    resolveErrorMessage,
    type SubscriptionReturnRefusal,
} from '@saasicat/core';
import type {
    BillingCycleStr,
    CatalogPlan,
    PlanChangePreviewIssueShape,
    SubscriptionReturnRefusedShape,
    SubscriptionReturnTermsShape,
} from '@saasicat/ui-vue';

import { writeDay } from '../day-as-instant.js';
import type { TenantPlanSectionI18n } from '../default-i18n.js';
import { messageText } from '../message-parts.js';
import { refusalBlockersOf, refusalMessage, refusalOf } from '../refusal-of.js';

type ReturnTexts = Pick<
    TenantPlanSectionI18n,
    | 'returnPriceGross'
    | 'returnPriceNet'
    | 'returnPeriod'
    | 'returnNotice'
    | 'returnNoNotice'
    | 'returnDeletionLifted'
    | 'returnDeletionLiftedUndated'
    | 'returnOpensAtOnce'
    | 'returnUnpaidStays'
    | 'wizardPriceUnitMonthly'
    | 'wizardPriceUnitYearly'
    | 'issueMessages'
>;

/** How the application writes what the sentences name. */
export interface ReturnFormats {
    formatDate: (iso: string) => string;
    formatCurrency: (amount: number) => string;
    /** The BCP-47 tag a rate is written by. */
    intlLocale: string;
}

/** The sentences the terms of a return are stated in, one per line. */
export interface ReturnTermsLines {
    /** One period's price; `null` where neither the contract nor the catalogue names one. */
    price: string | null;
    period: string;
    notice: string;
    deletion: string;
    /** Whether the tenant is open again at once, or still held by an unpaid invoice. */
    afterwards: string;
}

/** The code each refusal of a preview is told with: the one the route refuses the return with. */
const CODE_OF_REFUSAL: Readonly<Record<SubscriptionReturnRefusal, string>> = {
    'deletion-begun': TENANT_ACCESS_ERROR_CODES.TENANT_BEING_DELETED,
    suspended: TENANT_ACCESS_ERROR_CODES.TENANT_SUSPENDED,
    'not-ended': TENANT_ACCESS_ERROR_CODES.TENANT_RETURN_NOT_ENDED,
    'deletion-day-reached': TENANT_ACCESS_ERROR_CODES.TENANT_RETURN_DELETION_DAY_REACHED,
};

/** Why the tenant cannot come back, as the route would refuse it, its deletion day written as a day. */
export function returnRefusalSentence(
    refused: SubscriptionReturnRefusedShape,
    texts: Pick<ReturnTexts, 'issueMessages'>,
    formatDate: (iso: string) => string,
): string {
    return resolveErrorMessage(
        {
            code: CODE_OF_REFUSAL[refused.refusal],
            params: { deletesOn: writeDay(formatDate, refused.deletesOn) },
        },
        texts.issueMessages,
    );
}

/**
 * The terms of `terms`, one sentence each. The price is the new contract's,
 * gross beside net; where the installation keeps no contract, the catalogue's
 * net price for the rhythm, `catalogueNet`.
 */
export function returnTermsLines(
    terms: SubscriptionReturnTermsShape,
    catalogueNet: number | null,
    unpaidStays: boolean,
    texts: ReturnTexts,
    formats: ReturnFormats,
): ReturnTermsLines {
    const unit = unitOf(terms.billingCycle, texts);
    const { price } = terms;
    const rate = new Intl.NumberFormat(formats.intlLocale);
    return {
        price: price
            ? messageText(texts.returnPriceGross, {
                  net: formats.formatCurrency(price.totalNet),
                  gross: formats.formatCurrency(price.totalGross),
                  vatRate: rate.format(price.vatRate),
                  unit,
              })
            : catalogueNet === null
              ? null
              : messageText(texts.returnPriceNet, {
                    net: formats.formatCurrency(catalogueNet),
                    unit,
                }),
        period: messageText(texts.returnPeriod, {
            start: writeDay(formats.formatDate, terms.periodStartDays.from),
            end: writeDay(formats.formatDate, terms.periodEndDays.until),
        }),
        notice:
            terms.cancellationNoticeDays > 0
                ? messageText(texts.returnNotice, { days: String(terms.cancellationNoticeDays) })
                : texts.returnNoNotice,
        deletion: terms.deletesOn
            ? messageText(texts.returnDeletionLifted, {
                  deletesOn: writeDay(formats.formatDate, terms.deletesOn),
              })
            : texts.returnDeletionLiftedUndated,
        afterwards: unpaidStays ? texts.returnUnpaidStays : texts.returnOpensAtOnce,
    };
}

function unitOf(cycle: BillingCycleStr, texts: ReturnTexts): string {
    return cycle === 'YEARLY' ? texts.wizardPriceUnitYearly : texts.wizardPriceUnitMonthly;
}

/** The catalogue's net price of `plan` in `cycle`; `null` where it is not sold in it. */
export function catalogueNetOf(
    plan: CatalogPlan | undefined,
    cycle: BillingCycleStr,
): number | null {
    if (!plan) return null;
    return cycle === 'YEARLY' ? plan.yearlyNet : plan.monthlyNet;
}

/** That a payment method has to be entered first, as the route refuses a return without one. */
export function paymentMethodFirstSentence(texts: Pick<ReturnTexts, 'issueMessages'>): string {
    return resolveErrorMessage(
        { code: TENANT_ACCESS_ERROR_CODES.TENANT_RETURN_PAYMENT_METHOD_REQUIRED },
        texts.issueMessages,
    );
}

/** Whether `terms` can be confirmed: nothing blocks the plan and no payment method is missing. */
export function mayConfirmReturn(terms: SubscriptionReturnTermsShape | null): boolean {
    return terms !== null && terms.blockers.length === 0 && !terms.paymentMethodRequired;
}

/** The quotas the plans name, in the order they first appear. */
export function quotaKeysOf(plans: readonly CatalogPlan[]): string[] {
    const keys: string[] = [];
    for (const plan of plans) {
        for (const key of Object.keys(plan.quotas)) if (!keys.includes(key)) keys.push(key);
    }
    return keys;
}

/** What a refused return says, and the terms it carries where they changed since they were shown. */
export interface ReturnRefused {
    sentence: string;
    blockers: PlanChangePreviewIssueShape[];
    /** The preview as it stands now, where the refusal carried it (`PLAN_CHANGE_QUOTE_CHANGED`). */
    standing: SubscriptionReturnTermsShape | null;
}

/** `err`, a refused return, in the reader's language, each day it names written as a day. */
export function returnRefused(
    err: unknown,
    texts: Pick<ReturnTexts, 'issueMessages'>,
    formatDate: (iso: string) => string,
): ReturnRefused {
    const carried = refusalOf(err)?.preview;
    return {
        sentence: refusalMessage(err, texts.issueMessages, formatDate),
        blockers: refusalBlockersOf(err),
        standing: isTerms(carried) ? carried : null,
    };
}

/** Whether `value` is a preview's terms, which only a refusal that changed them carries. */
function isTerms(value: unknown): value is SubscriptionReturnTermsShape {
    return (
        typeof value === 'object' &&
        value !== null &&
        'refusal' in value &&
        value.refusal === null &&
        'blockers' in value &&
        Array.isArray(value.blockers) &&
        'periodStartDays' in value &&
        typeof value.periodStartDays === 'object'
    );
}
