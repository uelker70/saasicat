// What an e-invoice in the XML of EN 16931 can say, as the renderer that
// writes it, the tax adapter that checks it and the API that takes a
// subscriber's details all read it: one rule in one place, so that what one
// writes the other does not refuse.

import type { TaxTreatmentKind } from './tax.types.js';

/** The VAT category of EN 16931 (UNTDID 5305) a line and a breakdown name. */
export type VatCategory = 'S' | 'E' | 'AE' | 'O';

const CATEGORY: Readonly<Record<TaxTreatmentKind, VatCategory>> = {
    standard: 'S',
    reduced: 'S',
    exempt: 'E',
    'small-business': 'E',
    'reverse-charge': 'AE',
    'not-taxable': 'O',
};

/** The category EN 16931 names for a treatment an adapter decides. */
export function vatCategoryOf(kind: TaxTreatmentKind): VatCategory {
    return CATEGORY[kind];
}

/**
 * Every character XML 1.0 cannot hold, not even as a reference: the control
 * characters other than tab, line feed and carriage return, U+FFFE, U+FFFF and
 * a lone surrogate. One class and no quantifier, so it runs in one pass on any
 * text; read with `search` and `replace`, which ignore the flag's position.
 */
const NOT_XML = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

/** Whether `text` can stand in an XML document as it is. */
export function holdsOnlyXmlCharacters(text: string): boolean {
    return text.search(NOT_XML) === -1;
}

/** A carriage return, alone or before a line feed. One optional character after a fixed one. */
const CARRIAGE_RETURN = /\r\n?/g;

/**
 * `text` as an e-invoice's XML states it, which is what every XML parser reads
 * back from it: a character XML cannot hold becomes `?`, as the page shows a
 * character its font has no glyph for (`SC-PRIC-078`), and a carriage return
 * is the line feed XML 1.0 hands over in its place (§ 2.11). The renderer
 * writes this, and the adapter's check compares the record through it.
 */
export function asXmlReadsIt(text: string): string {
    return text.replace(NOT_XML, '?').replace(CARRIAGE_RETURN, '\n');
}
