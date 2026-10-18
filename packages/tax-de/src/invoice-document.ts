// Whether a rendered invoice is the file German law asks for: ZUGFeRD in the
// EN 16931 profile — a PDF/A-3 a person reads, carrying `factur-x.xml` a
// program reads — and whether that file says what the invoice records.
//
// The check reads the file itself and needs no other runtime: the container
// (a PDF, declared PDF/A-3 and Factur-X EN 16931 in its metadata, with the
// XML embedded as its alternative), the XML's profile, and the figures it
// carries — the number, the dates, the parties, the tax per rate, the totals
// and the lines — against the invoice. A renderer that writes 58.31 into the
// PDF and 58.30 into the XML, or carries a total the invoice does not state,
// is refused. Full Schematron validation of EN 16931 is not done here.

import { XMLParser } from 'fast-xml-parser';
import {
    PDFArray,
    PDFDict,
    PDFDocument,
    PDFName,
    PDFRawStream,
    PDFString,
    PDFHexString,
    decodePDFRawStream,
} from 'pdf-lib';
import { asXmlReadsIt, holdsOnlyXmlCharacters, vatCategoryOf } from '@saasicat/core';
import type { InvoiceDocument, SubscriptionInvoiceRecord } from '@saasicat/core';

/** The name the Factur-X standard gives the embedded XML. */
const FACTUR_X_XML = 'factur-x.xml';

/** The guideline id of the EN 16931 profile, as the XML names it. */
const EN_16931_PROFILE = 'urn:cen.eu:en16931:2017';

/** The XMP conformance level of the same profile. */
const EN_16931_LEVEL = 'EN 16931';

/** UNTDID 1001: a commercial invoice. */
const COMMERCIAL_INVOICE = '380';

/** UNTDID 1001: a credit note, which a cancellation invoice is (`SC-PRIC-089`). */
const CREDIT_NOTE = '381';

/**
 * What the check reads where the XML does not say a thing exactly once that
 * EN 16931 has it say once: a second VAT id of a party, or a line with no VAT
 * breakdown or a second one. A second could say what the first leaves out, so
 * no recorded value equals this. An element the format gives once, stated
 * twice, is read as missing for the same reason (`single`).
 */
const NOT_ONCE = 'not stated exactly once';

/** The elements that repeat, read as lists whether one is there or many. */
const REPEATED = new Set([
    'ApplicableTradeTax',
    'IncludedSupplyChainTradeLineItem',
    'SpecifiedTaxRegistration',
    'Description',
]);

const parser = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    parseAttributeValue: false,
    isArray: (name) => REPEATED.has(name),
});

/** A parsed XML element: its children by local name, `@_`-prefixed attributes, `#text`. */
type Element = Record<string, unknown>;

/**
 * What the rendered document lacks of the German format, or disagrees with
 * in the invoice — none where it is the file to issue.
 */
export async function germanInvoiceDocumentGaps(
    document: InvoiceDocument,
    invoice: SubscriptionInvoiceRecord,
): Promise<string[]> {
    if (document.mediaType !== 'application/pdf') return ['format.mediaType'];
    let pdf: PDFDocument;
    try {
        pdf = await PDFDocument.load(document.content, { updateMetadata: false });
    } catch {
        // Not a PDF pdf-lib can read: there is nothing further to check.
        return ['format.pdf'];
    }
    const gaps: string[] = [];
    const xmp = parse(metadataOf(pdf));
    if (!xmp || !anyValue(xmp, 'part').includes('3')) gaps.push('format.pdfa3');
    if (
        !xmp ||
        !anyValue(xmp, 'ConformanceLevel').includes(EN_16931_LEVEL) ||
        !anyValue(xmp, 'DocumentFileName').includes(FACTUR_X_XML)
    ) {
        gaps.push('format.facturX');
    }
    const embedded = embeddedFile(pdf, FACTUR_X_XML);
    if (!embedded) return [...gaps, 'format.embeddedXml'];
    if (embedded.relationship !== 'Alternative') gaps.push('format.relationship');
    const xml = parse(embedded.text);
    const root = xml ? child(xml, 'CrossIndustryInvoice') : undefined;
    if (root === undefined) return [...gaps, 'xml.wellFormed'];
    // An empty root element is read as one that states nothing.
    const stated = root !== null && typeof root === 'object' ? (root as Element) : {};
    return [...gaps, ...xmlGaps(stated, invoice)];
}

/** Where the XML says something other than the invoice records. */
function xmlGaps(root: Element, invoice: SubscriptionInvoiceRecord): string[] {
    const gaps: string[] = [];
    const header = path(root, 'ExchangedDocument');
    const transaction = path(root, 'SupplyChainTradeTransaction');
    const agreement = path(transaction, 'ApplicableHeaderTradeAgreement');
    const settlement = path(transaction, 'ApplicableHeaderTradeSettlement');
    const summation = path(settlement, 'SpecifiedTradeSettlementHeaderMonetarySummation');
    const seller = path(agreement, 'SellerTradeParty');
    const registrations = list(seller, 'SpecifiedTaxRegistration');

    const check = (gap: string, holds: boolean) => {
        if (!holds) gaps.push(gap);
    };
    // A cancellation invoice records the amounts of the invoice it cancels
    // reversed, and its XML states them as a credit note does, positive.
    const cancellation = invoice.correction?.kind === 'cancellation';
    const sign = cancellation ? -1 : 1;
    check(
        'xml.profile',
        text(
            path(root, 'ExchangedDocumentContext', 'GuidelineSpecifiedDocumentContextParameter'),
            'ID',
        ) === EN_16931_PROFILE,
    );
    check(
        'xml.typeCode',
        text(header, 'TypeCode') === (cancellation ? CREDIT_NOTE : COMMERCIAL_INVOICE),
    );
    check('xml.number', text(header, 'ID') === written(invoice.number));
    check('xml.issueDate', dayOf(path(header, 'IssueDateTime')) === invoice.issueDate);
    // A cancellation invoice asks for nothing, so it names no day it is due.
    check(
        'xml.dueDate',
        dayOf(path(settlement, 'SpecifiedTradePaymentTerms', 'DueDateDateTime')) ===
            (cancellation ? null : invoice.dueDate),
    );
    // The invoice a correction corrects, by number and issue date (BT-25,
    // BT-26), which German law asks a correction to name; none on an invoice.
    const referenced = path(settlement, 'InvoiceReferencedDocument');
    check(
        'xml.correctedInvoice',
        text(referenced, 'IssuerAssignedID') === written(invoice.correction?.of.number ?? null) &&
            dayOf(path(referenced, 'FormattedIssueDateTime')) ===
                (invoice.correction?.of.issueDate ?? null),
    );
    check(
        'xml.servicePeriod',
        dayOf(path(settlement, 'BillingSpecifiedPeriod', 'StartDateTime')) ===
            invoice.servicePeriodFrom &&
            dayOf(path(settlement, 'BillingSpecifiedPeriod', 'EndDateTime')) ===
                invoice.servicePeriodUntil,
    );
    check('xml.currency', text(settlement, 'InvoiceCurrencyCode') === invoice.currency);
    check('xml.seller.name', text(seller, 'Name') === written(invoice.issuer.legalName));
    // Outside the scope of VAT, EN 16931 forbids the VAT ids of both parties
    // (BR-O-02) and any rate, in the breakdown or on a line (BR-O-05), that
    // every other treatment states.
    const outsideVat = invoice.taxTreatment.kind === 'not-taxable';
    const category = vatCategoryOf(invoice.taxTreatment.kind);
    check(
        'xml.seller.vatId',
        registered(registrations, 'VA') === (outsideVat ? null : written(invoice.issuer.vatId)),
    );
    check(
        'xml.seller.taxNumber',
        registered(registrations, 'FC') === written(invoice.issuer.taxNumber),
    );
    const buyer = path(agreement, 'BuyerTradeParty');
    check('xml.buyer.name', text(buyer, 'Name') === written(invoice.subscriber.legalName));
    check(
        'xml.buyer.vatId',
        buyerVatIdHolds(
            registered(list(buyer, 'SpecifiedTaxRegistration'), 'VA'),
            invoice,
            outsideVat,
        ),
    );
    check(
        'xml.taxes',
        sameTaxes(list(settlement, 'ApplicableTradeTax'), invoice, category, outsideVat, sign),
    );
    // The sum of the lines (BT-106) is not a total the invoice records, but
    // the sum of what it records line by line, so it cannot drift alone.
    const lineTotal = invoice.lines.reduce(
        (total, line) => total + cents(sign * line.amountNet),
        0,
    );
    check(
        'xml.totals',
        centsOf(text(summation, 'LineTotalAmount')) === lineTotal &&
            centsOf(text(summation, 'TaxBasisTotalAmount')) === cents(sign * invoice.totalNet) &&
            centsOf(text(summation, 'TaxTotalAmount')) === cents(sign * invoice.totalTax) &&
            centsOf(text(summation, 'GrandTotalAmount')) === cents(sign * invoice.totalGross) &&
            centsOf(text(summation, 'DuePayableAmount')) === cents(sign * invoice.totalGross),
    );
    check(
        'xml.lines',
        sameAmounts(
            list(transaction, 'IncludedSupplyChainTradeLineItem').map((item) => {
                const line = path(item, 'SpecifiedLineTradeSettlement');
                // One VAT breakdown per line, with its category (EN 16931,
                // BG-30, BR-CO-04).
                const taxes = list(line, 'ApplicableTradeTax');
                if (taxes.length !== 1) return NOT_ONCE;
                return keyOf(
                    text(taxes[0], 'CategoryCode'),
                    centsOf(text(taxes[0], 'RateApplicablePercent')),
                    centsOf(
                        text(
                            path(line, 'SpecifiedTradeSettlementLineMonetarySummation'),
                            'LineTotalAmount',
                        ),
                    ),
                );
            }),
            invoice.lines.map((line) =>
                keyOf(
                    category,
                    outsideVat ? null : cents(line.taxRate),
                    cents(sign * line.amountNet),
                ),
            ),
        ),
    );
    return gaps;
}

/**
 * Whether the buyer's VAT id the XML states is the subscriber's the invoice
 * records: required under the reverse charge, where the buyer owes the tax
 * (§ 14a UStG, BR-AE-02), forbidden outside the scope of VAT (BR-O-02), and
 * otherwise the subscriber's wherever it is stated.
 */
function buyerVatIdHolds(
    stated: string | null,
    invoice: SubscriptionInvoiceRecord,
    outsideVat: boolean,
): boolean {
    const recorded = written(invoice.subscriber.vatId);
    if (outsideVat) return stated === null;
    if (invoice.taxTreatment.kind === 'reverse-charge') return stated === recorded;
    return stated === null || stated === recorded;
}

/** Values that belong together, as one value to compare: `null` stays apart from `0`. */
function keyOf(...values: (string | number | null)[]): string {
    return values.map(String).join('|');
}

/**
 * A text the invoice records as its XML states it and any parser reads it
 * back: with `?` for a character XML cannot hold, as SC-PRIC-078 has every
 * renderer write it, and a carriage return as a line feed.
 */
function written<T extends string | null>(text: T): T {
    return (text === null ? null : asXmlReadsIt(text)) as T;
}

/** The tax the XML states per rate, with its category, against the invoice's, rate by rate. */
function sameTaxes(
    stated: Element[],
    invoice: SubscriptionInvoiceRecord,
    category: string,
    outsideVat: boolean,
    sign: 1 | -1,
): boolean {
    return sameAmounts(
        stated.map((entry) =>
            keyOf(
                text(entry, 'CategoryCode'),
                centsOf(text(entry, 'RateApplicablePercent')),
                centsOf(text(entry, 'BasisAmount')),
                centsOf(text(entry, 'CalculatedAmount')),
            ),
        ),
        invoice.taxes.map((entry) =>
            keyOf(
                category,
                outsideVat ? null : cents(entry.rate),
                cents(sign * entry.net),
                cents(sign * entry.tax),
            ),
        ),
    );
}

/** Whether two lists hold the same values, each as often, in any order. */
function sameAmounts<T>(stated: readonly T[], recorded: readonly T[]): boolean {
    if (stated.length !== recorded.length) return false;
    const left = [...stated].map(String).sort();
    const right = [...recorded].map(String).sort();
    return left.every((value, index) => value === right[index]);
}

/**
 * The id registered under `scheme` (`VA` for a VAT id, `FC` for a tax number),
 * `null` where there is none, and `NOT_ONCE` where there are several.
 */
function registered(registrations: Element[], scheme: string): string | null {
    const ids = registrations
        .filter((registration) => {
            const id = registration.ID;
            return id && typeof id === 'object' && (id as Element)['@_schemeID'] === scheme;
        })
        .map((registration) => text(registration, 'ID'));
    return ids.length > 1 ? NOT_ONCE : (ids[0] ?? null);
}

/** A `udt:DateTimeString` of format 102 (`YYYYMMDD`) as a calendar day, or `null`. */
function dayOf(dateTime: Element | undefined): string | null {
    const value = text(dateTime, 'DateTimeString');
    if (value === null || value.length !== 8 || !/^\d{8}$/.test(value)) return null;
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

/** An amount in whole cents, as the invoice records it. */
function cents(amount: number): number {
    return Math.round(amount * 100);
}

/** A decimal the XML states, in whole cents; `null` where it states none that reads as one. */
function centsOf(value: string | null): number | null {
    if (value === null || value.trim() === '') return null;
    const amount = Number(value);
    return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

/** The element at `names`, one level after another; `undefined` where one is missing. */
function path(element: Element | undefined, ...names: string[]): Element | undefined {
    let current = element;
    for (const name of names) {
        current = single(current && child(current, name)) as Element | undefined;
        if (!current || typeof current !== 'object') return undefined;
    }
    return current;
}

/** The one element `value` holds; none where the XML states it more than once. */
function single(value: unknown): unknown {
    if (!Array.isArray(value)) return value;
    return value.length === 1 ? value[0] : undefined;
}

function child(element: Element, name: string): unknown {
    return element[name];
}

/** The repeated children `name` of an element, none where there are none. */
function list(element: Element | undefined, name: string): Element[] {
    const value = element && child(element, name);
    return Array.isArray(value) ? (value as Element[]) : [];
}

/** The text of the child `name`, with or without attributes; `null` where there is none. */
function text(element: Element | undefined, name: string): string | null {
    const node = single(element && child(element, name));
    if (typeof node === 'string') return node.trim();
    if (node && typeof node === 'object' && typeof (node as Element)['#text'] === 'string') {
        return ((node as Element)['#text'] as string).trim();
    }
    return null;
}

/** Every value named `name` anywhere in a tree, as element text or as attribute. */
function anyValue(tree: unknown, name: string): string[] {
    const found: string[] = [];
    const visit = (node: unknown) => {
        if (Array.isArray(node)) {
            node.forEach(visit);
            return;
        }
        if (!node || typeof node !== 'object') return;
        for (const [key, value] of Object.entries(node)) {
            if (key === name || key === `@_${name}`) {
                const read = text({ [key]: value }, key);
                if (read !== null) found.push(read);
            }
            visit(value);
        }
    };
    visit(tree);
    return found;
}

/** XML text parsed, or `null` where it is not well-formed. */
function parse(xml: string | null): Element | null {
    // The parser reads past a character XML 1.0 cannot hold; a recipient's
    // parser does not.
    if (xml === null || !holdsOnlyXmlCharacters(xml)) return null;
    try {
        return parser.parse(xml, true) as Element;
    } catch {
        return null;
    }
}

// Each key is read as the type the format gives it, and a key that holds
// another type is read as missing rather than thrown on: a renderer that
// writes `/AFRelationship` as a string is refused for its relationship, not
// counted as a run that failed.

const dictOf = (value: unknown): PDFDict | null => (value instanceof PDFDict ? value : null);
const arrayOf = (value: unknown): PDFArray | null => (value instanceof PDFArray ? value : null);
const streamOf = (value: unknown): PDFRawStream | null =>
    value instanceof PDFRawStream ? value : null;

/** The XMP metadata of the document, as text; `null` where it has none it can read. */
function metadataOf(pdf: PDFDocument): string | null {
    const stream = streamOf(pdf.catalog.lookup(PDFName.of('Metadata')));
    return stream ? textOf(stream) : null;
}

/**
 * The embedded file `name`, its text and the relationship it declares; `null`
 * where it is not embedded.
 */
function embeddedFile(
    pdf: PDFDocument,
    name: string,
): { text: string | null; relationship: string | null } | null {
    const names = dictOf(pdf.catalog.lookup(PDFName.of('Names')));
    const tree = dictOf(names?.lookup(PDFName.of('EmbeddedFiles')));
    const spec = tree ? findInNameTree(tree, name, new Set()) : null;
    const files = dictOf(spec?.lookup(PDFName.of('EF')));
    const stream = streamOf(files?.lookup(PDFName.of('F')));
    if (!spec || !stream) return null;
    const relationship = spec.lookup(PDFName.of('AFRelationship'));
    return {
        text: textOf(stream),
        relationship: relationship instanceof PDFName ? relationship.decodeText() : null,
    };
}

/**
 * The file specification filed under `name` in a name tree, through its kids.
 * `visited` holds the nodes already read, so kids that lead back up end the
 * search instead of recursing until the stack overflows.
 */
function findInNameTree(node: PDFDict, name: string, visited: Set<PDFDict>): PDFDict | null {
    if (visited.has(node)) return null;
    visited.add(node);
    const entries = arrayOf(node.lookup(PDFName.of('Names')));
    for (let index = 0; entries && index + 1 < entries.size(); index += 2) {
        const key = entries.lookup(index);
        const label =
            key instanceof PDFString || key instanceof PDFHexString ? key.decodeText() : null;
        if (label === name) return dictOf(entries.lookup(index + 1));
    }
    const kids = arrayOf(node.lookup(PDFName.of('Kids')));
    for (let index = 0; kids && index < kids.size(); index += 1) {
        const kid = dictOf(kids.lookup(index));
        const found = kid ? findInNameTree(kid, name, visited) : null;
        if (found) return found;
    }
    return null;
}

/** A stream's content as text; `null` where it is encoded by a filter pdf-lib cannot undo. */
function textOf(stream: PDFRawStream): string | null {
    try {
        return new TextDecoder().decode(decodePDFRawStream(stream).decode());
    } catch {
        return null;
    }
}
