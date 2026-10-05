// Whether a subscriber of given details may be created and given a contract,
// asked before the transaction that creates it (`SC-PRIC-039`,
// `SC-PRIC-040`). One answer for a sign-up's step 4 and for an application
// that creates a subscriber itself.

import { ServiceUnavailableException } from '@nestjs/common';
import type { NewSubscriberDetails, SubscriberTaxOrigin } from '@saasicat/core';
import { TAX_ERROR_CODES, taxOriginOf } from '@saasicat/core';

import { codedError } from '../errors/coded-error.js';
import { settleNewSubscriberDetails } from '../subscriber/subscriber-details.js';
import { isTaxNotSupported, type TaxPeriod, type TaxTreatments } from './tax-treatments.js';

/**
 * The tax adapter decides over `period` from the details as given. Where it
 * supports no treatment and a VAT identification number is given, the number
 * is checked with the service the adapter names, and the adapter decides
 * again from the check — so a number is checked only where a treatment
 * depends on it, and which ones do is the adapter's to say. Refused with
 * `TAX_TREATMENT_NOT_SUPPORTED` (`422`, the adapter's sentence) where it still
 * supports none, and with `TAX_VAT_ID_CHECK_NOT_COMPLETED` (`503`) where the
 * check did not complete: nothing is decided in the subscriber's favour on a
 * number not checked.
 *
 * Answers the details with the check attached, which
 * `SubscriberService.createForTenant` records; without a tax adapter, the
 * details as they are. Never inside a transaction: the check reaches an
 * outside service.
 */
export async function assessNewSubscriber(
    taxes: TaxTreatments | null,
    details: NewSubscriberDetails,
    period: TaxPeriod,
): Promise<NewSubscriberDetails> {
    if (!taxes?.adapter) return { ...details, vatIdCheck: null };
    const settled = settleNewSubscriberDetails(details);
    const asGiven = taxOriginOf(settled, null);
    if (settled.vatId === null || supports(taxes, asGiven, period)) {
        // Supported as given, or refused with the adapter's own sentence.
        taxes.decide(asGiven, period);
        return { ...details, vatIdCheck: null };
    }
    const outcome = await taxes.checkVatId(settled.vatId);
    if (!outcome.completed) {
        throw new ServiceUnavailableException(
            codedError(TAX_ERROR_CODES.TAX_VAT_ID_CHECK_NOT_COMPLETED, {
                adapter: taxes.adapter.name,
                reason: outcome.reason,
            }),
        );
    }
    taxes.decide(taxOriginOf(settled, outcome.check), period);
    return { ...details, vatIdCheck: outcome.check };
}

/** Whether the adapter supports the case of `origin` over `period`, without refusing it. */
function supports(taxes: TaxTreatments, origin: SubscriberTaxOrigin, period: TaxPeriod): boolean {
    try {
        taxes.decide(origin, period);
        return true;
    } catch (error) {
        if (isTaxNotSupported(error)) return false;
        throw error;
    }
}
