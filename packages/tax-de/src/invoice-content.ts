// What an invoice of an issuer in Germany has to carry (§ 14 (4) UStG), checked
// before its number is drawn (`SC-PRIC-027`).
//
// The draft already holds what SaaSiCat computes itself — the dates, the
// service period, the net per rate, the rate, the tax and the gross — so what
// can be missing is what an operator or a subscriber supplies: a party's
// address, the issuer's tax identifier, and for the reverse charge both VAT
// identification numbers. A gap is named as the field it is, so the operator is
// told what to fill in rather than that something is wrong.

import type {
    InvoiceContentDraft,
    LegalIdentity,
    PartyAddress,
    TaxTreatmentKind,
} from '@saasicat/core';

/** The address fields an invoice names each party with; the second line is optional. */
const ADDRESS_FIELDS = ['addressLine1', 'postalCode', 'city', 'country'] as const;

/** The treatments whose invoice says why it carries no German VAT. */
const NEEDS_A_NOTE: ReadonlySet<TaxTreatmentKind> = new Set([
    'reverse-charge',
    'not-taxable',
    'small-business',
]);

function blank(value: string | null | undefined): boolean {
    return value === null || value === undefined || value.trim() === '';
}

function addressGaps(party: LegalIdentity & PartyAddress, side: 'issuer' | 'subscriber'): string[] {
    const gaps = blank(party.legalName) ? [`${side}.legalName`] : [];
    for (const field of ADDRESS_FIELDS) {
        if (blank(party[field])) gaps.push(`${side}.${field}`);
    }
    return gaps;
}

/**
 * The fields the draft misses of the content German law requires, in the order
 * an invoice reads: the issuer, the subscriber, the treatment, the lines.
 */
export function germanInvoiceContentGaps(draft: InvoiceContentDraft): string[] {
    const gaps = addressGaps(draft.issuer, 'issuer');
    // The issuer's tax number or its VAT identification number (§ 14 (4) no. 2 UStG).
    if (blank(draft.issuer.taxNumber) && blank(draft.issuer.vatId)) {
        gaps.push('issuer.taxIdentifier');
    }
    gaps.push(...addressGaps(draft.subscriber, 'subscriber'));
    const kind = draft.treatment.kind;
    if (kind === 'reverse-charge') {
        // Both parties' VAT identification numbers (§ 14a (1) UStG).
        if (blank(draft.issuer.vatId)) gaps.push('issuer.vatId');
        if (blank(draft.subscriber.vatId)) gaps.push('subscriber.vatId');
    }
    if (NEEDS_A_NOTE.has(kind) && blank(draft.treatment.note)) {
        gaps.push('treatment.note');
    }
    if (draft.lines.length === 0) {
        gaps.push('lines');
    } else if (draft.lines.some((line) => blank(line.title))) {
        gaps.push('lines.title');
    }
    return gaps;
}
