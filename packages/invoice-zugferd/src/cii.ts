// The invoice as UN/CEFACT Cross Industry Invoice (D16B) in the EN 16931
// profile: the XML a program reads, embedded in the PDF as `factur-x.xml`.
//
// Pure: everything it writes comes from the invoice as it was issued. The
// elements stand in the order the schema prescribes, which a validator checks
// before any business rule.

import type {
    SubscriptionInvoiceIssuer,
    SubscriptionInvoiceLineRecord,
    SubscriptionInvoiceRecord,
    SubscriptionInvoiceSubscriber,
} from '@saasicat/core';

import { vatCategoryOf, type VatCategoryOf } from './categories.js';
import { xmlAmount, xmlDay, xmlRate, xmlText } from './format.js';

/** The guideline id of the EN 16931 profile. */
export const EN_16931_GUIDELINE = 'urn:cen.eu:en16931:2017';

/** UNTDID 1001: a commercial invoice. */
const COMMERCIAL_INVOICE = '380';

/** UN/ECE Recommendation 20: one unit. */
const ONE = 'C62';

const NAMESPACES = [
    'xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"',
    'xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"',
    'xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"',
].join(' ');

/** An element with text content, or nothing where the value is missing. */
function element(name: string, value: string | null | undefined, attributes = ''): string {
    if (value === null || value === undefined || value === '') return '';
    return `<${name}${attributes}>${xmlText(value)}</${name}>`;
}

function day(name: string, value: string): string {
    return `<${name}><udt:DateTimeString format="102">${xmlDay(value)}</udt:DateTimeString></${name}>`;
}

function period(start: string, end: string): string {
    return `<ram:BillingSpecifiedPeriod>${day('ram:StartDateTime', start)}${day('ram:EndDateTime', end)}</ram:BillingSpecifiedPeriod>`;
}

function address(party: SubscriptionInvoiceIssuer | SubscriptionInvoiceSubscriber): string {
    return (
        '<ram:PostalTradeAddress>' +
        element('ram:PostcodeCode', party.postalCode) +
        element('ram:LineOne', party.addressLine1) +
        element('ram:LineTwo', party.addressLine2) +
        element('ram:CityName', party.city) +
        element('ram:CountryID', party.country) +
        '</ram:PostalTradeAddress>'
    );
}

function registration(scheme: 'VA' | 'FC', id: string | null): string {
    if (!id) return '';
    return `<ram:SpecifiedTaxRegistration>${element('ram:ID', id, ` schemeID="${scheme}"`)}</ram:SpecifiedTaxRegistration>`;
}

function seller(issuer: SubscriptionInvoiceIssuer, tax: VatCategoryOf): string {
    const vatId = tax.namesVatIds ? issuer.vatId : null;
    // EN 16931 asks for an identifier of the seller (BR-CO-26), which a tax
    // number is not. Where no VAT id stands as one — outside the scope of VAT
    // it may not (BR-O-02), and a small business may have none — the seller is
    // identified by its VAT id or its tax number as its own identifier.
    const ownId = vatId ? null : (issuer.vatId ?? issuer.taxNumber);
    return (
        '<ram:SellerTradeParty>' +
        element('ram:ID', ownId) +
        element('ram:Name', issuer.legalName) +
        address(issuer) +
        registration('VA', vatId) +
        registration('FC', issuer.taxNumber) +
        '</ram:SellerTradeParty>'
    );
}

function buyer(subscriber: SubscriptionInvoiceSubscriber, tax: VatCategoryOf): string {
    return (
        '<ram:BuyerTradeParty>' +
        element('ram:ID', subscriber.customerNumber) +
        element('ram:Name', subscriber.legalName) +
        address(subscriber) +
        registration('VA', tax.namesVatIds ? subscriber.vatId : null) +
        '</ram:BuyerTradeParty>'
    );
}

function lineTax(tax: VatCategoryOf, rate: number): string {
    return (
        '<ram:ApplicableTradeTax>' +
        '<ram:TypeCode>VAT</ram:TypeCode>' +
        `<ram:CategoryCode>${tax.category}</ram:CategoryCode>` +
        (tax.statesRate ? element('ram:RateApplicablePercent', xmlRate(rate)) : '') +
        '</ram:ApplicableTradeTax>'
    );
}

function line(entry: SubscriptionInvoiceLineRecord, tax: VatCategoryOf): string {
    // A price is never negative (BR-27): a line that takes something off, such
    // as a discount, is one unit taken back at its price.
    const quantity = entry.amountNet < 0 ? '-1' : '1';
    return (
        '<ram:IncludedSupplyChainTradeLineItem>' +
        `<ram:AssociatedDocumentLineDocument>${element('ram:LineID', String(entry.position))}</ram:AssociatedDocumentLineDocument>` +
        `<ram:SpecifiedTradeProduct>${element('ram:Name', entry.title)}</ram:SpecifiedTradeProduct>` +
        '<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice>' +
        element('ram:ChargeAmount', xmlAmount(Math.abs(entry.amountNet))) +
        '</ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>' +
        `<ram:SpecifiedLineTradeDelivery>${element('ram:BilledQuantity', quantity, ` unitCode="${ONE}"`)}</ram:SpecifiedLineTradeDelivery>` +
        '<ram:SpecifiedLineTradeSettlement>' +
        lineTax(tax, entry.taxRate) +
        period(entry.periodFrom, entry.periodUntil) +
        '<ram:SpecifiedTradeSettlementLineMonetarySummation>' +
        element('ram:LineTotalAmount', xmlAmount(entry.amountNet)) +
        '</ram:SpecifiedTradeSettlementLineMonetarySummation>' +
        '</ram:SpecifiedLineTradeSettlement>' +
        '</ram:IncludedSupplyChainTradeLineItem>'
    );
}

function headerTaxes(invoice: SubscriptionInvoiceRecord, tax: VatCategoryOf): string {
    return invoice.taxes
        .map(
            (entry) =>
                '<ram:ApplicableTradeTax>' +
                element('ram:CalculatedAmount', xmlAmount(entry.tax)) +
                '<ram:TypeCode>VAT</ram:TypeCode>' +
                element('ram:ExemptionReason', tax.exemptionReason) +
                element('ram:BasisAmount', xmlAmount(entry.net)) +
                `<ram:CategoryCode>${tax.category}</ram:CategoryCode>` +
                (tax.statesRate ? element('ram:RateApplicablePercent', xmlRate(entry.rate)) : '') +
                '</ram:ApplicableTradeTax>',
        )
        .join('');
}

function sum(values: readonly number[]): number {
    return values.reduce((total, value) => total + Math.round(value * 100), 0) / 100;
}

/** The CII XML of `invoice`, in the EN 16931 profile. */
export function ciiOf(invoice: SubscriptionInvoiceRecord): string {
    const tax = vatCategoryOf(invoice.taxTreatment);
    const lineTotal = sum(invoice.lines.map((entry) => entry.amountNet));
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        `<rsm:CrossIndustryInvoice ${NAMESPACES}>` +
        '<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter>' +
        element('ram:ID', EN_16931_GUIDELINE) +
        '</ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>' +
        '<rsm:ExchangedDocument>' +
        element('ram:ID', invoice.number) +
        `<ram:TypeCode>${COMMERCIAL_INVOICE}</ram:TypeCode>` +
        day('ram:IssueDateTime', invoice.issueDate) +
        (invoice.taxTreatment.note
            ? `<ram:IncludedNote>${element('ram:Content', invoice.taxTreatment.note)}</ram:IncludedNote>`
            : '') +
        '</rsm:ExchangedDocument>' +
        '<rsm:SupplyChainTradeTransaction>' +
        invoice.lines.map((entry) => line(entry, tax)).join('') +
        '<ram:ApplicableHeaderTradeAgreement>' +
        seller(invoice.issuer, tax) +
        buyer(invoice.subscriber, tax) +
        '</ram:ApplicableHeaderTradeAgreement>' +
        '<ram:ApplicableHeaderTradeDelivery><ram:ActualDeliverySupplyChainEvent>' +
        day('ram:OccurrenceDateTime', invoice.servicePeriodUntil) +
        '</ram:ActualDeliverySupplyChainEvent></ram:ApplicableHeaderTradeDelivery>' +
        '<ram:ApplicableHeaderTradeSettlement>' +
        element('ram:InvoiceCurrencyCode', invoice.currency) +
        headerTaxes(invoice, tax) +
        period(invoice.servicePeriodFrom, invoice.servicePeriodUntil) +
        `<ram:SpecifiedTradePaymentTerms>${day('ram:DueDateDateTime', invoice.dueDate)}</ram:SpecifiedTradePaymentTerms>` +
        '<ram:SpecifiedTradeSettlementHeaderMonetarySummation>' +
        element('ram:LineTotalAmount', xmlAmount(lineTotal)) +
        element('ram:TaxBasisTotalAmount', xmlAmount(invoice.totalNet)) +
        element(
            'ram:TaxTotalAmount',
            xmlAmount(invoice.totalTax),
            ` currencyID="${xmlText(invoice.currency)}"`,
        ) +
        element('ram:GrandTotalAmount', xmlAmount(invoice.totalGross)) +
        element('ram:DuePayableAmount', xmlAmount(invoice.totalGross)) +
        '</ram:SpecifiedTradeSettlementHeaderMonetarySummation>' +
        '</ram:ApplicableHeaderTradeSettlement>' +
        '</rsm:SupplyChainTradeTransaction>' +
        '</rsm:CrossIndustryInvoice>\n'
    );
}
