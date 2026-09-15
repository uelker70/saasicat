// The billing details a sign-up gives in step 4, settled the way the subscriber
// they become settles its details — one rule for a value, whichever door it
// comes through — and with the address sign-up requires.

import { UnprocessableEntityException } from '@nestjs/common';
import type {
    PendingRegistration,
    RegistrationBillingDetails,
    SubscriberDetails,
} from '@saasicat/core';
import { SUBSCRIBER_ERROR_CODES } from '@saasicat/core';

import { codedError } from '../errors/coded-error.js';
import { settleNewSubscriberDetails } from '../subscriber/subscriber-details.js';

/** What the pending record keeps of step 4, every value settled. */
export type SettledBillingDetails = Pick<
    SubscriberDetails,
    'addressLine1' | 'addressLine2' | 'postalCode' | 'city' | 'country' | 'vatId' | 'taxNumber'
>;

/** An invoice needs an address to be sent to; the tax identifiers wait for the tax adapter. */
const REQUIRED: readonly (keyof SettledBillingDetails)[] = [
    'addressLine1',
    'postalCode',
    'city',
    'country',
];

export function settleBillingDetails(
    pending: Pick<PendingRegistration, 'tenantName' | 'email'>,
    details: RegistrationBillingDetails,
): SettledBillingDetails {
    const settled = settleNewSubscriberDetails({
        legalName: pending.tenantName,
        invoiceEmail: pending.email,
        addressLine1: details.addressLine1,
        addressLine2: details.addressLine2,
        postalCode: details.postalCode,
        city: details.city,
        country: details.country,
        vatId: details.vatId,
        taxNumber: details.taxNumber,
    });
    const missing = REQUIRED.find((field) => settled[field] === null);
    if (missing) {
        throw new UnprocessableEntityException(
            codedError(SUBSCRIBER_ERROR_CODES.SUBSCRIBER_DETAIL_INVALID, { field: missing }),
        );
    }
    return {
        addressLine1: settled.addressLine1,
        addressLine2: settled.addressLine2,
        postalCode: settled.postalCode,
        city: settled.city,
        country: settled.country,
        vatId: settled.vatId,
        taxNumber: settled.taxNumber,
    };
}
