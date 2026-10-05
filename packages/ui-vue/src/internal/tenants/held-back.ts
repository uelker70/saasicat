// What holds a tenant's subscriber back from its next contract, in words.
//
// One reading for the three places that show it — the detail page's banner,
// and the pill on the tenant and subscription lists — so that a list and the
// page it leads to never name the same subscriber differently.

import {
    SUBSCRIBER_INVOICE_ADDRESS_FIELDS,
    type SubscriberInvoiceAddressField,
    type SubscriberReadiness,
} from '@saasicat/core';

import { formatMessage } from '../../client/i18n/format.js';
import type { PillTone } from '../../vue/status.js';

export interface HeldBackMessages {
    missing: string;
    taxRefusal: string;
    pillAddress: string;
    pillTax: string;
    field: Record<SubscriberInvoiceAddressField, string>;
}

export interface HeldBackPill {
    label: string;
    tone: PillTone;
    icon: string;
}

/** One sentence per reason: the empty address fields first, then the adapter's. */
export function heldBackReasons(
    readiness: SubscriberReadiness,
    messages: HeldBackMessages,
): string[] {
    const reasons: string[] = [];
    if (readiness.missing.length > 0) {
        const fields = SUBSCRIBER_INVOICE_ADDRESS_FIELDS.filter((field) =>
            readiness.missing.includes(field),
        ).map((field) => messages.field[field]);
        reasons.push(formatMessage(messages.missing, { fields: fields.join(', ') }));
    }
    if (readiness.taxRefusal !== null) {
        reasons.push(formatMessage(messages.taxRefusal, { reason: readiness.taxRefusal }));
    }
    return reasons;
}

/**
 * The pill a list shows, or `null` where nothing holds the subscriber back.
 * Where both hold it back the address is named: the tenant puts it right
 * itself, and an empty country is often why the adapter refuses as well.
 */
export function heldBackPill(
    readiness: SubscriberReadiness | null,
    messages: HeldBackMessages,
): HeldBackPill | null {
    if (!readiness || readiness.ready) return null;
    return {
        label: readiness.missing.length > 0 ? messages.pillAddress : messages.pillTax,
        tone: 'warning',
        icon: 'warning',
    };
}
