// What a search of subscribers matches, read from the text the operator typed.
//
// One box takes a customer number, a legal name or a VAT identification
// number, because an operator on the phone has whichever of the three the
// caller gives. Reading the text is decided here, once, so that every store
// matches the same text the same way and only translates the terms into its
// own query.

import { canonicalVatId } from './tax-origin.js';
import type { SubscriberSearchTerms } from './subscriber.types.js';

/** More digits than this cannot be a customer number the database counted to. */
const MAX_SEQUENCE_DIGITS = 15;

/**
 * The terms the text `query` matches, or `null` for every subscriber where it
 * holds nothing but blanks.
 *
 * - The legal name is matched by the whole text, trimmed.
 * - A text ending in digits names a customer number: the digits are its
 *   number, and whatever stands before them its prefix — `AHP-10023` asks for
 *   the number 10023 assigned behind `AHP-`, `10023` for 10023 behind any
 *   prefix.
 * - The VAT number is the text in its canonical form, as a subscriber's is
 *   kept: without blanks, dots and hyphens, in capitals.
 */
export function subscriberSearchTermsOf(query: string): SubscriberSearchTerms | null {
    const text = query.trim();
    if (text === '') return null;
    return {
        legalName: text,
        customerNumber: customerNumberIn(text),
        vatId: canonicalVatId(text),
    };
}

function customerNumberIn(text: string): SubscriberSearchTerms['customerNumber'] {
    let start = text.length;
    while (start > 0 && isDigit(text.charAt(start - 1))) start -= 1;
    const digits = text.slice(start);
    if (digits === '' || digits.length > MAX_SEQUENCE_DIGITS) return null;
    const sequence = Number(digits);
    if (sequence === 0) return null;
    const prefix = text.slice(0, start);
    return { prefix: prefix === '' ? null : prefix, sequence };
}

/** An ASCII digit — not any character Unicode calls one, which no customer number holds. */
function isDigit(char: string): boolean {
    return char >= '0' && char <= '9';
}
