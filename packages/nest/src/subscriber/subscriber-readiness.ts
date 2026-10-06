// Whether a subscriber can be given its next contract where a tax adapter
// decides (`SC-PRIC-032`, `SC-PRIC-039`): the empty fields of the address an
// invoice names, and the adapter's sentence where it supports no treatment for
// the subscriber as it stands. Computed when it is read, so it follows a change
// of the record and an update of the adapter alike.

import type { SubscriberReadiness, SubscriberRecord, VatIdCheck } from '@saasicat/core';
import { taxOriginOf } from '@saasicat/core';

import {
    contractTaxPeriod,
    taxRefusalOf,
    type TaxPeriod,
    type TaxTreatments,
} from '../tax/tax-treatments.js';
import { invoiceAddressGapsOf } from './subscriber-details.js';

export function readinessOf(
    subscriber: SubscriberRecord,
    currentCheck: VatIdCheck | null,
    taxes: TaxTreatments,
    period: TaxPeriod,
): SubscriberReadiness {
    const missing = invoiceAddressGapsOf(subscriber);
    const taxRefusal = taxRefusalOf(taxes, taxOriginOf(subscriber, currentCheck), period);
    return { ready: missing.length === 0 && taxRefusal === null, missing, taxRefusal };
}

/** A month from `asOf`: the period a subscriber's standing is asked over. */
export function standingPeriod(asOf: Date): TaxPeriod {
    return contractTaxPeriod({ effectiveFrom: asOf, billingCycle: 'MONTHLY' });
}
