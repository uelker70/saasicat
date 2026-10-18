// A ZUGFeRD-shaped file built from an invoice, for the format check to read:
// a PDF declared PDF/A-3 and Factur-X EN 16931 in its XMP metadata, carrying
// `factur-x.xml` as its alternative. Not a renderer — it writes what the check
// reads and no more — and each part can be left out or changed, so a test
// changes one thing and sees the check name it.

import { AFRelationship, PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';

/** An invoice as the store hands it back: 19 % on one plan line and a discount. */
export const INVOICE = {
    id: 'invoice-1',
    number: 'AHP-2026-000123',
    numberPrefix: 'AHP',
    numberYear: 2026,
    numberSequence: 123,
    tenantId: 'tenant-1',
    subscriberId: 'subscriber-1',
    subscriptionId: 'sub-1',
    contractId: 'contract-1',
    issuedAt: new Date('2026-02-01T05:15:00.000Z'),
    issueDate: '2026-02-01',
    dueDate: '2026-02-15',
    servicePeriodFrom: '2026-02-01',
    servicePeriodUntil: '2026-02-28',
    currency: 'EUR',
    issuer: {
        legalName: 'AutohausPro.de GbR',
        vatId: 'DE123456789',
        taxNumber: '12/345/67890',
        addressLine1: 'Hauptstraße 1',
        addressLine2: null,
        postalCode: '10115',
        city: 'Berlin',
        country: 'DE',
    },
    subscriber: {
        customerNumber: 'K-10001',
        legalName: 'Autohaus Müller GmbH',
        vatId: null,
        taxNumber: null,
        addressLine1: 'Ringstraße 1',
        addressLine2: null,
        postalCode: '20095',
        city: 'Hamburg',
        country: 'DE',
    },
    taxTreatment: {
        kind: 'standard',
        rate: 19,
        note: null,
        adapter: { name: '@saasicat/tax-de', version: '1.0.0' },
    },
    taxes: [{ rate: 19, net: 49, tax: 9.31 }],
    totalNet: 49,
    totalTax: 9.31,
    totalGross: 58.31,
    lines: [
        {
            position: 1,
            chargeId: 'c-1',
            contractLineItemId: 'l-1',
            title: 'Standard',
            origin: 'renewal',
            source: 'plan',
            periodFrom: '2026-02-01',
            periodUntil: '2026-02-28',
            amountNet: 53.9,
            taxRate: 19,
            correctedPosition: null,
            id: 'il-1',
            invoiceId: 'invoice-1',
        },
        {
            position: 2,
            chargeId: 'c-2',
            contractLineItemId: 'l-2',
            title: 'Welcome discount',
            origin: 'renewal',
            source: 'discount',
            periodFrom: '2026-02-01',
            periodUntil: '2026-02-28',
            amountNet: -4.9,
            taxRate: 19,
            correctedPosition: null,
            id: 'il-2',
            invoiceId: 'invoice-1',
        },
    ],
    correction: null,
    createdAt: new Date('2026-02-01T05:15:00.000Z'),
};

const day = (calendarDay) => calendarDay.replaceAll('-', '');
/** How the file is written: plain objects, so the check reads what a simple writer writes. */
const SAVE = { useObjectStreams: false, updateFieldAppearances: false };

/** An amount as CII writes it; a text an override gives is written as it is. */
const amount = (value) => (typeof value === 'number' ? value.toFixed(2) : value);

/** A party's VAT ids: none for `null`, one for a text, each of a list. */
const vatIds = (ids) =>
    [ids ?? []]
        .flat()
        .map(
            (id) =>
                `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${id}</ram:ID></ram:SpecifiedTaxRegistration>`,
        )
        .join('');

/** A line's VAT breakdowns in `category`: one stating `rate`, one stating none for `null`, one each of a list. */
const lineTaxes = (rates, category) =>
    (Array.isArray(rates) ? rates : [rates])
        .map(
            (rate) =>
                `<ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${category}</ram:CategoryCode>${rate === null ? '' : `<ram:RateApplicablePercent>${amount(rate)}</ram:RateApplicablePercent>`}</ram:ApplicableTradeTax>`,
        )
        .join('');

/** The CII XML of `invoice`, each field as `overrides` says where it says one. */
export function ciiOf(invoice = INVOICE, overrides = {}) {
    const field = (name, value) => (name in overrides ? overrides[name] : value);
    const registrations = [
        vatIds(field('sellerVatId', invoice.issuer.vatId)),
        invoice.issuer.taxNumber &&
            `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${field('sellerTaxNumber', invoice.issuer.taxNumber)}</ram:ID></ram:SpecifiedTaxRegistration>`,
    ]
        .filter(Boolean)
        .join('');
    // The category the invoice's treatment takes, `S` unless a test names another.
    const category = field('category', 'S');
    const lineRates = field(
        'lineRates',
        invoice.lines.map((line) => line.taxRate),
    );
    const lines = field(
        'lines',
        invoice.lines.map((line) => line.amountNet),
    )
        .map(
            (net, index) => `<ram:IncludedSupplyChainTradeLineItem>
            <ram:AssociatedDocumentLineDocument><ram:LineID>${index + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
            <ram:SpecifiedLineTradeSettlement>
                ${lineTaxes(lineRates[index], field('lineCategory', category))}
                <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amount(net)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
            </ram:SpecifiedLineTradeSettlement>
        </ram:IncludedSupplyChainTradeLineItem>`,
        )
        .join('');
    // A due date `null` leaves out; the invoice a correction corrects, as its
    // number and its day, unless a test names another or none (`null`).
    const dueDate = field('dueDate', day(invoice.dueDate));
    const corrected = field(
        'corrected',
        invoice.correction && {
            number: invoice.correction.of.number,
            issueDate: day(invoice.correction.of.issueDate),
        },
    );
    const referenced = corrected
        ? `<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${corrected.number}</ram:IssuerAssignedID><ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${corrected.issueDate}</qdt:DateTimeString></ram:FormattedIssueDateTime></ram:InvoiceReferencedDocument>`
        : '';
    const taxes = field('taxes', invoice.taxes)
        .map(
            (tax) => `<ram:ApplicableTradeTax>
            <ram:CalculatedAmount>${amount(tax.tax)}</ram:CalculatedAmount>
            <ram:TypeCode>VAT</ram:TypeCode>
            <ram:BasisAmount>${amount(tax.net)}</ram:BasisAmount>
            <ram:CategoryCode>${category}</ram:CategoryCode>
            ${tax.rate === null ? '' : `<ram:RateApplicablePercent>${amount(tax.rate)}</ram:RateApplicablePercent>`}
        </ram:ApplicableTradeTax>`,
        )
        .join('');
    return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
    xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
    xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"
    xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${field('profile', 'urn:cen.eu:en16931:2017')}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${field('number', invoice.number)}</ram:ID>
    <ram:TypeCode>${field('typeCode', '380')}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${field('issueDate', day(invoice.issueDate))}</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    ${lines}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty><ram:Name>${field('sellerName', invoice.issuer.legalName)}</ram:Name>${registrations}</ram:SellerTradeParty>
      <ram:BuyerTradeParty><ram:Name>${field('buyerName', invoice.subscriber.legalName)}</ram:Name>${vatIds(field('buyerVatId', invoice.subscriber.vatId))}</ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery/>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${field('currency', invoice.currency)}</ram:InvoiceCurrencyCode>
      ${taxes}
      <ram:BillingSpecifiedPeriod>
        <ram:StartDateTime><udt:DateTimeString format="102">${field('periodFrom', day(invoice.servicePeriodFrom))}</udt:DateTimeString></ram:StartDateTime>
        <ram:EndDateTime><udt:DateTimeString format="102">${field('periodUntil', day(invoice.servicePeriodUntil))}</udt:DateTimeString></ram:EndDateTime>
      </ram:BillingSpecifiedPeriod>
      <ram:SpecifiedTradePaymentTerms>
        ${dueDate === null ? '' : `<ram:DueDateDateTime><udt:DateTimeString format="102">${dueDate}</udt:DateTimeString></ram:DueDateDateTime>`}
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${amount(field('lineTotal', invoice.totalNet))}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${amount(field('totalNet', invoice.totalNet))}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${invoice.currency}">${amount(field('totalTax', invoice.totalTax))}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${amount(field('totalGross', invoice.totalGross))}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${amount(field('duePayable', invoice.totalGross))}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
      ${referenced}
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
}

/** XMP metadata declaring PDF/A-3 part `part` and Factur-X at `level`; either left out where `null`. */
export function xmpOf({ part = '3', level = 'EN 16931', fileName = 'factur-x.xml' } = {}) {
    return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    ${part === null ? '' : `<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>${part}</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description>`}
    ${level === null ? '' : `<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"><fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>${fileName}</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>${level}</fx:ConformanceLevel></rdf:Description>`}
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * Moves the entries of the embedded files' name tree into a kid of it, their
 * names as literal strings — the shape a writer with many attachments uses.
 */
export function fileUnderAKid(pdf) {
    const names = pdf.catalog.lookup(PDFName.of('Names'), PDFDict);
    const tree = names.lookup(PDFName.of('EmbeddedFiles'), PDFDict);
    const entries = tree.lookup(PDFName.of('Names'), PDFArray);
    const literal = pdf.context.obj([]);
    for (let index = 0; index < entries.size(); index += 2) {
        literal.push(PDFString.of(entries.lookup(index).decodeText()));
        literal.push(entries.get(index + 1));
    }
    const kid = pdf.context.obj({ Names: literal });
    tree.delete(PDFName.of('Names'));
    tree.set(PDFName.of('Kids'), pdf.context.obj([pdf.context.register(kid)]));
}

/**
 * The file, as the renderer hands it over. `xml` is the embedded XML or
 * `null` for none, `xmp` the metadata or `null` for none, `relationship` the
 * one the XML is attached under or `null` for none declared, and `reshape`
 * changes the file as written, read back, before it is handed over.
 */
export async function facturXOf({
    xml = ciiOf(),
    xmp = xmpOf(),
    attachedAs = 'factur-x.xml',
    relationship = AFRelationship.Alternative,
    reshape = null,
} = {}) {
    const pdf = await PDFDocument.create();
    pdf.setCreationDate(new Date('2026-02-01T05:15:00.000Z'));
    pdf.setModificationDate(new Date('2026-02-01T05:15:00.000Z'));
    pdf.addPage([595, 842]);
    if (xmp !== null) {
        const stream = pdf.context.stream(xmp, { Type: 'Metadata', Subtype: 'XML' });
        pdf.catalog.set(PDFName.of('Metadata'), pdf.context.register(stream));
    }
    if (xml !== null) {
        await pdf.attach(new TextEncoder().encode(xml), attachedAs, {
            mimeType: 'text/xml',
            description: 'Factur-X invoice',
            ...(relationship === null ? {} : { afRelationship: relationship }),
        });
    }
    const file = (content) => ({
        content,
        mediaType: 'application/pdf',
        fileName: `${INVOICE.number}.pdf`,
    });
    // The name tree is written when the file is saved, so it is reshaped in a copy read back.
    const content = await pdf.save(SAVE);
    if (!reshape) return file(content);
    const reread = await PDFDocument.load(content);
    reshape(reread);
    return file(await reread.save(SAVE));
}
