// How a payment method in use is described in one sentence, in the reader's
// language. Framework-free, so the sentence can be checked without mounting.

import type { TenantPaymentMethodShape } from '@saasicat/ui-vue';

import type { TenantPlanSectionI18n } from '../default-i18n.js';
import { messageParts } from '../message-parts.js';

type SummaryMessages = Pick<
    TenantPlanSectionI18n,
    'paymentMethodCard' | 'paymentMethodCardFallback' | 'paymentMethodSepa'
>;

/** `Visa ending in 4242, valid until 12/2030`, or the direct debit's equivalent. */
export function paymentMethodSummary(
    method: TenantPaymentMethodShape,
    i18n: SummaryMessages,
): string {
    if (method.type === 'sepa_debit') {
        return textOf(i18n.paymentMethodSepa, { last4: method.last4 });
    }
    return textOf(i18n.paymentMethodCard, {
        brand: method.brand ? capitalised(method.brand) : i18n.paymentMethodCardFallback,
        last4: method.last4,
        expiry: expiryOf(method),
    });
}

function textOf(template: string, values: Record<string, string>): string {
    return messageParts(template, values, [])
        .map((part) => part.text)
        .join('');
}

/** Card networks are names, not words: `visa` is Visa in every language. */
function capitalised(brand: string): string {
    return brand.charAt(0).toUpperCase() + brand.slice(1);
}

function expiryOf(method: TenantPaymentMethodShape): string {
    if (method.expiryMonth === null || method.expiryYear === null) return '—';
    return `${String(method.expiryMonth).padStart(2, '0')}/${method.expiryYear}`;
}
