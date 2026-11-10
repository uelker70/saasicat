// What a tenant reads before and after paying now (`SC-PRIC-100`). Before, when
// the account opens again; after, one sentence for what was set going, the one
// that asks something of them first — no payment method, a refusal, a payment
// method not ready — before the ones that only report.

import type { CalendarDay, TenantPaymentStarted } from '@saasicat/core';
import { formatMessage } from '@saasicat/ui-vue';

import { writeDay } from '../day-as-instant.js';
import type { TenantPlanSectionI18n } from '../default-i18n.js';

/**
 * What a tenant reads before paying now: when the account opens again by card
 * and by direct debit, `directDebitCollectedOn` written as the application
 * writes days.
 */
export function payNowHint(
    i18n: Pick<TenantPlanSectionI18n, 'accountPayNowHint'>,
    formatDate: (iso: string) => string,
    directDebitCollectedOn: CalendarDay | null,
): string {
    return formatMessage(i18n.accountPayNowHint, {
        date: writeDay(formatDate, directDebitCollectedOn),
    });
}

/** The sentence a page shows for `started`. */
export function paymentStartedMessage(
    started: TenantPaymentStarted,
    i18n: Pick<
        TenantPlanSectionI18n,
        | 'accountPayNoMethod'
        | 'accountPayRefused'
        | 'accountPayWaiting'
        | 'accountPayAnnounced'
        | 'accountPayPending'
        | 'accountPaidNow'
        | 'accountPayOnItsWay'
        | 'accountPayNotSentYet'
        | 'accountNothingOpen'
    >,
): string {
    if (!started.paymentMethod) return i18n.accountPayNoMethod;
    if (started.failed > 0 || started.refused > 0) return i18n.accountPayRefused;
    if (started.waiting > 0) return i18n.accountPayWaiting;
    if (started.announced > 0) return i18n.accountPayAnnounced;
    if (started.pending > 0) return i18n.accountPayPending;
    // Before a payment that went through: the balance beside it still shows
    // the invoice not sent yet, and this is the sentence that explains it.
    if (started.notSentYet > 0) return i18n.accountPayNotSentYet;
    if (started.collected > 0) return i18n.accountPaidNow;
    if (started.onTheirWay > 0) return i18n.accountPayOnItsWay;
    return i18n.accountNothingOpen;
}
