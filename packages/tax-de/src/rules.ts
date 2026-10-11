// What German law makes of a charge, decided from the request alone.
//
// Nothing here reaches outside the process: the decision is a pure function of
// the issuer, the subscriber's tax origin, the period and the calendar it is
// read in, so every case can be tested by its inputs (`SC-PRIC-064`).

import {
    lastDayInZone,
    type TaxDecision,
    type TaxDecisionRequest,
    type TaxTreatment,
} from '@saasicat/core';
import { NOT_TAXABLE_NOTE, REVERSE_CHARGE_NOTE, SMALL_BUSINESS_NOTE } from './notes.js';
import { isMemberStateVatId } from './vat-numbers.js';

/** Who decided, recorded beside every treatment. */
export interface DecidingAdapter {
    name: string;
    version: string;
}

/** How the issuer is taxed, as the operator declares it to the adapter. */
export interface IssuerScheme {
    /** The issuer uses the small business exemption of § 19 UStG. */
    smallBusiness: boolean;
}

/** The member states of the European Union, by the ISO 3166-1 code of a billing address. */
const EU_MEMBER_STATES: ReadonlySet<string> = new Set([
    'AT',
    'BE',
    'BG',
    'CY',
    'CZ',
    'DE',
    'DK',
    'EE',
    'ES',
    'FI',
    'FR',
    'GR',
    'HR',
    'HU',
    'IE',
    'IT',
    'LT',
    'LU',
    'LV',
    'MT',
    'NL',
    'PL',
    'PT',
    'RO',
    'SE',
    'SI',
    'SK',
]);

/**
 * The prefix a VAT identification number of a member state carries: its
 * country code, except Greece's, which VIES and the numbers themselves write
 * `EL`.
 */
function vatPrefixOf(country: string): string {
    return country === 'GR' ? 'EL' : country;
}

/**
 * Countries whose address is outside the Union while their businesses are in
 * a member state's VAT territory. Treating one by its address would name the
 * wrong treatment on the invoice, so it is refused instead.
 */
const IN_ANOTHER_VAT_TERRITORY: ReadonlyMap<string, string> = new Map([
    ['MC', 'Monaco belongs to the French VAT territory'],
]);

/**
 * The German standard rate by the first day it applies, the latest first.
 * The second half of 2020 is the temporary reduction; a period whose last day
 * falls before the first entry has no rate here.
 */
const GERMAN_STANDARD_RATES: readonly { from: string; rate: number }[] = [
    { from: '2021-01-01', rate: 19 },
    { from: '2020-07-01', rate: 16 },
    { from: '2007-01-01', rate: 19 },
];

/** The German standard rate on `day`, or `null` before the first rate the adapter knows. */
export function germanStandardRateOn(day: string): number | null {
    return GERMAN_STANDARD_RATES.find((entry) => entry.from <= day)?.rate ?? null;
}

function unsupported(reason: string): TaxDecision {
    return { supported: false, reason };
}

function treated(
    kind: TaxTreatment['kind'],
    rate: number,
    note: string | null,
    adapter: DecidingAdapter,
): TaxDecision {
    return { supported: true, treatment: { kind, rate, note, adapter: { ...adapter } } };
}

/** Why a subscriber who is not a stated business is refused outside Germany. */
function notAStatedBusiness(business: boolean | null): TaxDecision {
    return business === false
        ? unsupported('A consumer outside Germany is not supported.')
        : unsupported('Whether the subscriber is a business is not stated.');
}

/**
 * The treatment of a charge for an issuer in Germany, or why the case is not
 * supported. Never guesses: every case outside the ones decided is refused.
 */
export function decideGermanTax(
    request: TaxDecisionRequest,
    scheme: IssuerScheme,
    adapter: DecidingAdapter,
): TaxDecision {
    const { issuer, origin } = request;
    // Read first, so a malformed period or zone is an error on every path, not
    // only on the one that looks up a rate.
    const lastDay = lastDayInZone(request.period, request.timeZone);
    if (issuer.country !== 'DE') {
        return unsupported(
            `The German tax adapter decides for an issuer in Germany; the issuer's country is ${issuer.country ?? 'not configured'}.`,
        );
    }
    const country = origin.country;
    if (country === null) return unsupported("The subscriber's country is not known.");
    const otherTerritory = IN_ANOTHER_VAT_TERRITORY.get(country);
    if (otherTerritory !== undefined) {
        return unsupported(`${otherTerritory}, which this adapter does not decide for.`);
    }

    if (country === 'DE') {
        if (scheme.smallBusiness) return treated('small-business', 0, SMALL_BUSINESS_NOTE, adapter);
        const rate = germanStandardRateOn(lastDay);
        if (rate === null) return unsupported(`No German rate is known for ${lastDay}.`);
        return treated('standard', rate, null, adapter);
    }

    if (origin.business !== true) return notAStatedBusiness(origin.business);

    if (EU_MEMBER_STATES.has(country)) {
        if (origin.validatedVatId === null) {
            return unsupported(
                'A business elsewhere in the European Union without a validated VAT identification number is not supported.',
            );
        }
        // A number of another state, Germany's included, names an establishment
        // there: the service is supplied to that one, not to the address.
        const prefix = origin.validatedVatId.slice(0, 2);
        if (prefix !== vatPrefixOf(country)) {
            return unsupported(
                `The VAT identification number is one of ${prefix}, the billing address is in ${country}: which establishment the service is supplied to is not clear.`,
            );
        }
        if (issuer.vatId === null) {
            return unsupported(
                "An invoice under the reverse charge names the issuer's VAT identification number, and the issuer has none.",
            );
        }
        return treated('reverse-charge', 0, REVERSE_CHARGE_NOTE, adapter);
    }

    // Entered, validated or not: a number of a member state names an establishment
    // inside the Union, which the address outside it does not settle.
    if (origin.vatId !== null && isMemberStateVatId(origin.vatId)) {
        return unsupported(
            `The VAT identification number is one of ${origin.vatId.slice(0, 2)}, a member state, the billing address is in ${country}, outside the European Union: which establishment the service is supplied to is not clear.`,
        );
    }
    return treated('not-taxable', 0, NOT_TAXABLE_NOTE, adapter);
}
