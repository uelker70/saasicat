// What a tenant reads after paying now (`SC-PRIC-100`): one sentence for what
// was set going, the one that asks something of them first — no payment
// method, a refusal, a payment method not ready — before the ones that only
// report.

import type { TenantPaymentStarted } from '@saasicat/core';

import type { TenantPlanSectionI18n } from '../default-i18n.js';

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
        | 'accountNothingOpen'
    >,
): string {
    if (!started.paymentMethod) return i18n.accountPayNoMethod;
    if (started.failed > 0 || started.refused > 0) return i18n.accountPayRefused;
    if (started.waiting > 0) return i18n.accountPayWaiting;
    if (started.announced > 0) return i18n.accountPayAnnounced;
    if (started.pending > 0) return i18n.accountPayPending;
    if (started.collected > 0) return i18n.accountPaidNow;
    if (started.onTheirWay > 0) return i18n.accountPayOnItsWay;
    return i18n.accountNothingOpen;
}
