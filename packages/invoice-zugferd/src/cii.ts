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

import { taxStatementOf, type TaxStatement } from './categories.js';
import {
    correctionNoteOf,
    isCancellation,
    lineCorrectionOf,
    namedPaymentOf,
    xmlSignOf,
} from './correction.js';
import { xmlAmount, xmlDay, xmlRate, xmlText } from './format.js';
import type { Label } from './labels.js';
import { paymentNoteOf } from './payment-note.js';

/** The guideline id of the EN 16931 profile. */
export const EN_16931_GUIDELINE = 'urn:cen.eu:en16931:2017';

/** UNTDID 1001: a commercial invoice. */
const COMMERCIAL_INVOICE = '380';

/**
 * UNTDID 1001: a credit note, which a cancellation invoice is in EN 16931 —
 * titled "Stornorechnung" on the page, never "Gutschrift" (`SC-PRIC-089`).
 */
const CREDIT_NOTE = '381';

/** UN/ECE Recommendation 20: one unit. */
const ONE = 'C62';

/** UNTDID 4461, the payment means an invoice is collected by (BT-81). */
const PAYMENT_MEANS = { card: '48', sepa_debit: '59' } as const;

const NAMESPACES = [
    'xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"',
    'xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"',
    'xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"',
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

/** A note in both languages, German first, as one text. */
function note(label: Label | null): string {
    return label
        ? `<ram:IncludedNote>${element('ram:Content', `${label.de} / ${label.en}`)}</ram:IncludedNote>`
        : '';
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

function seller(issuer: SubscriptionInvoiceIssuer, tax: TaxStatement): string {
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

function buyer(subscriber: SubscriptionInvoiceSubscriber, tax: TaxStatement): string {
    return (
        '<ram:BuyerTradeParty>' +
        element('ram:ID', subscriber.customerNumber) +
        element('ram:Name', subscriber.legalName) +
        address(subscriber) +
        registration('VA', tax.namesVatIds ? subscriber.vatId : null) +
        '</ram:BuyerTradeParty>'
    );
}

function lineTax(tax: TaxStatement, rate: number): string {
    return (
        '<ram:ApplicableTradeTax>' +
        '<ram:TypeCode>VAT</ram:TypeCode>' +
        `<ram:CategoryCode>${tax.category}</ram:CategoryCode>` +
        (tax.statesRate ? element('ram:RateApplicablePercent', xmlRate(rate)) : '') +
        '</ram:ApplicableTradeTax>'
    );
}

function line(
    invoice: SubscriptionInvoiceRecord,
    entry: SubscriptionInvoiceLineRecord,
    tax: TaxStatement,
): string {
    const amount = xmlSignOf(invoice) * entry.amountNet;
    // A price is never negative (BR-27): a line that takes something off, such
    // as a discount, is one unit taken back at its price.
    const quantity = amount < 0 ? '-1' : '1';
    return (
        '<ram:IncludedSupplyChainTradeLineItem>' +
        '<ram:AssociatedDocumentLineDocument>' +
        element('ram:LineID', String(entry.position)) +
        // BT-127: which line of the corrected invoice this one cancels or replaces.
        note(lineCorrectionOf(invoice, entry)) +
        '</ram:AssociatedDocumentLineDocument>' +
        `<ram:SpecifiedTradeProduct>${element('ram:Name', entry.title)}</ram:SpecifiedTradeProduct>` +
        '<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice>' +
        element('ram:ChargeAmount', xmlAmount(Math.abs(amount))) +
        '</ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>' +
        `<ram:SpecifiedLineTradeDelivery>${element('ram:BilledQuantity', quantity, ` unitCode="${ONE}"`)}</ram:SpecifiedLineTradeDelivery>` +
        '<ram:SpecifiedLineTradeSettlement>' +
        lineTax(tax, entry.taxRate) +
        period(entry.periodFrom, entry.periodUntil) +
        '<ram:SpecifiedTradeSettlementLineMonetarySummation>' +
        element('ram:LineTotalAmount', xmlAmount(amount)) +
        '</ram:SpecifiedTradeSettlementLineMonetarySummation>' +
        '</ram:SpecifiedLineTradeSettlement>' +
        '</ram:IncludedSupplyChainTradeLineItem>'
    );
}

/**
 * How the invoice is paid (BG-16): a SEPA direct debit, or a bank card named
 * by the last four digits of its number (BT-87), never more. Nothing where
 * the invoice is not collected — EN 16931 asks for no payment means — and
 * nothing on a cancellation invoice, which asks for nothing.
 */
function paymentMeans(invoice: SubscriptionInvoiceRecord): string {
    const payment = namedPaymentOf(invoice);
    if (!payment) return '';
    const card =
        payment.type === 'card'
            ? `<ram:ApplicableTradeSettlementFinancialCard>${element('ram:ID', payment.last4)}</ram:ApplicableTradeSettlementFinancialCard>`
            : '';
    return (
        '<ram:SpecifiedTradeSettlementPaymentMeans>' +
        `<ram:TypeCode>${PAYMENT_MEANS[payment.type]}</ram:TypeCode>` +
        card +
        '</ram:SpecifiedTradeSettlementPaymentMeans>'
    );
}

/**
 * The payment terms: what the page says about how the invoice is paid
 * (BT-20), the day it is due (BT-9) and the mandate a direct debit is
 * collected under (BT-89). A cancellation invoice asks for nothing and is due
 * on no day; its description says so, which is what BR-CO-25 asks of a
 * document whose amount due is positive.
 */
function paymentTerms(invoice: SubscriptionInvoiceRecord): string {
    const paymentNote = paymentNoteOf(invoice);
    return (
        '<ram:SpecifiedTradePaymentTerms>' +
        element('ram:Description', paymentNote && `${paymentNote.de} / ${paymentNote.en}`) +
        (isCancellation(invoice) ? '' : day('ram:DueDateDateTime', invoice.dueDate)) +
        element('ram:DirectDebitMandateID', namedPaymentOf(invoice)?.mandateReference) +
        '</ram:SpecifiedTradePaymentTerms>'
    );
}

function headerTaxes(invoice: SubscriptionInvoiceRecord, tax: TaxStatement): string {
    const sign = xmlSignOf(invoice);
    return invoice.taxes
        .map(
            (entry) =>
                '<ram:ApplicableTradeTax>' +
                element('ram:CalculatedAmount', xmlAmount(sign * entry.tax)) +
                '<ram:TypeCode>VAT</ram:TypeCode>' +
                element('ram:ExemptionReason', tax.exemptionReason) +
                element('ram:BasisAmount', xmlAmount(sign * entry.net)) +
                `<ram:CategoryCode>${tax.category}</ram:CategoryCode>` +
                (tax.statesRate ? element('ram:RateApplicablePercent', xmlRate(entry.rate)) : '') +
                '</ram:ApplicableTradeTax>',
        )
        .join('');
}

function sum(values: readonly number[]): number {
    return values.reduce((total, value) => total + Math.round(value * 100), 0) / 100;
}

/**
 * The invoice a cancellation invoice cancels or a replacement replaces, by its
 * number and issue date (BT-25, BT-26); nothing on an invoice that corrects
 * none.
 */
function correctedInvoice(invoice: SubscriptionInvoiceRecord): string {
    const { correction } = invoice;
    if (!correction) return '';
    return (
        '<ram:InvoiceReferencedDocument>' +
        element('ram:IssuerAssignedID', correction.of.number) +
        '<ram:FormattedIssueDateTime>' +
        `<qdt:DateTimeString format="102">${xmlDay(correction.of.issueDate)}</qdt:DateTimeString>` +
        '</ram:FormattedIssueDateTime>' +
        '</ram:InvoiceReferencedDocument>'
    );
}

/** The CII XML of `invoice`, in the EN 16931 profile. */
export function ciiOf(invoice: SubscriptionInvoiceRecord): string {
    const tax = taxStatementOf(invoice.taxTreatment);
    const sign = xmlSignOf(invoice);
    const lineTotal = sum(invoice.lines.map((entry) => sign * entry.amountNet));
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        `<rsm:CrossIndustryInvoice ${NAMESPACES}>` +
        '<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter>' +
        element('ram:ID', EN_16931_GUIDELINE) +
        '</ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>' +
        '<rsm:ExchangedDocument>' +
        element('ram:ID', invoice.number) +
        `<ram:TypeCode>${isCancellation(invoice) ? CREDIT_NOTE : COMMERCIAL_INVOICE}</ram:TypeCode>` +
        day('ram:IssueDateTime', invoice.issueDate) +
        note(correctionNoteOf(invoice)) +
        (invoice.taxTreatment.note
            ? `<ram:IncludedNote>${element('ram:Content', invoice.taxTreatment.note)}</ram:IncludedNote>`
            : '') +
        '</rsm:ExchangedDocument>' +
        '<rsm:SupplyChainTradeTransaction>' +
        invoice.lines.map((entry) => line(invoice, entry, tax)).join('') +
        '<ram:ApplicableHeaderTradeAgreement>' +
        seller(invoice.issuer, tax) +
        buyer(invoice.subscriber, tax) +
        '</ram:ApplicableHeaderTradeAgreement>' +
        '<ram:ApplicableHeaderTradeDelivery><ram:ActualDeliverySupplyChainEvent>' +
        day('ram:OccurrenceDateTime', invoice.servicePeriodUntil) +
        '</ram:ActualDeliverySupplyChainEvent></ram:ApplicableHeaderTradeDelivery>' +
        '<ram:ApplicableHeaderTradeSettlement>' +
        element('ram:InvoiceCurrencyCode', invoice.currency) +
        paymentMeans(invoice) +
        headerTaxes(invoice, tax) +
        period(invoice.servicePeriodFrom, invoice.servicePeriodUntil) +
        paymentTerms(invoice) +
        '<ram:SpecifiedTradeSettlementHeaderMonetarySummation>' +
        element('ram:LineTotalAmount', xmlAmount(lineTotal)) +
        element('ram:TaxBasisTotalAmount', xmlAmount(sign * invoice.totalNet)) +
        element(
            'ram:TaxTotalAmount',
            xmlAmount(sign * invoice.totalTax),
            ` currencyID="${xmlText(invoice.currency)}"`,
        ) +
        element('ram:GrandTotalAmount', xmlAmount(sign * invoice.totalGross)) +
        element('ram:DuePayableAmount', xmlAmount(sign * invoice.totalGross)) +
        '</ram:SpecifiedTradeSettlementHeaderMonetarySummation>' +
        correctedInvoice(invoice) +
        '</ram:ApplicableHeaderTradeSettlement>' +
        '</rsm:SupplyChainTradeTransaction>' +
        '</rsm:CrossIndustryInvoice>\n'
    );
}
