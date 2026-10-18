// translation-catalogue — the sentences below are German on purpose, with
// English beside them.
//
// What an invoice says about how it is paid, in German and in English, as the
// page shows it and the XML states it as its payment terms.
//
// For a direct debit it is the announcement the SEPA rules ask for before the
// debit is collected: the amount, the day it is collected from and the mandate
// it is collected under (`SC-PRIC-028`). The day is the earliest one: the debit
// is submitted to the bank on it, and the bank takes it from the account then
// or a few business days after.

import type { SubscriptionInvoiceRecord } from '@saasicat/core';

import { cancellationPaymentNoteOf } from './correction.js';
import { pageAmount, pageDay } from './format.js';
import type { Label } from './labels.js';

/**
 * How the invoice is paid, in both languages: that nothing is, on a
 * cancellation invoice; `null` where an invoice is not collected.
 */
export function paymentNoteOf(invoice: SubscriptionInvoiceRecord): Label | null {
    const cancellation = cancellationPaymentNoteOf(invoice);
    if (cancellation) return cancellation;
    const { payment, collectionDate } = invoice;
    if (!payment) return null;
    if (payment.type === 'card') {
        return {
            de: `Der Betrag wird von Ihrer Karte mit der Endung ${payment.last4} eingezogen.`,
            en: `The amount is charged to your card ending in ${payment.last4}.`,
        };
    }
    if (collectionDate === null || payment.mandateReference === null) {
        throw new Error(
            `Invoice ${invoice.number} is collected by direct debit without the day or the ` +
                'mandate its announcement names.',
        );
    }
    const amount = `${pageAmount(invoice.totalGross)} ${invoice.currency}`;
    const day = pageDay(collectionDate);
    const mandate = payment.mandateReference;
    return {
        de:
            `Der Betrag von ${amount} wird frühestens am ${day} per SEPA-Lastschrift von Ihrem ` +
            `Konto mit der Endung ${payment.last4} eingezogen, Mandatsreferenz ${mandate}.`,
        en:
            `The amount of ${amount} is collected by SEPA direct debit from your account ending ` +
            `in ${payment.last4} on or after ${day}, mandate reference ${mandate}.`,
    };
}
