// What one invoice of the charge journal says, put together from what holds on
// its issue date — everything but its number, which the store draws when it
// writes the invoice.
//
// Pure: the invoice run reads the charges, the contract, the parties and the
// tax adapter's decision, and asks this for the invoice they make.

import { addDaysToDay, dayInZone, lastDayInZone, yearOfDay } from './zoned-day.js';
import type { TaxPerRate } from './money.js';
import type { SubscriberChargeRecord } from './subscriber-ledger.types.js';
import type { ContractLineItemRecord } from './subscription-contract.types.js';
import type {
    NewSubscriptionInvoice,
    NewSubscriptionInvoiceLine,
    SubscriptionInvoiceIssuer,
    SubscriptionInvoiceSubscriber,
} from './subscription-invoice.types.js';
import type { InvoiceContentDraft, InvoiceTaxLine, TaxTreatment } from './tax.types.js';

/** The charges one invoice issues: booked at the same moment under the same contract. */
export interface InvoiceGroup {
    contractId: string;
    bookedAt: Date;
    charges: SubscriberChargeRecord[];
}

/**
 * A subscription's charges left to invoice, as the invoices that issue them.
 *
 * The charges a billing period opens with are booked together and issued
 * together; a charge that arises later in the period is booked when it arises
 * and issued on an invoice of its own (`SC-PRIC-022`). A contract is the
 * agreement an invoice asks payment under, so charges of two contracts are
 * never on one invoice. The oldest come first, so numbers follow the charges.
 * A group whose charges are all zero issues no invoice (`SC-PRIC-048`) and is
 * left out; a charge of zero beside one that is not stays on its invoice.
 */
export function invoiceGroupsOf(charges: readonly SubscriberChargeRecord[]): InvoiceGroup[] {
    const groups = new Map<string, InvoiceGroup>();
    for (const charge of charges) {
        const key = `${charge.contractId}|${charge.bookedAt.toISOString()}`;
        const group = groups.get(key);
        if (group) group.charges.push(charge);
        else
            groups.set(key, {
                contractId: charge.contractId,
                bookedAt: charge.bookedAt,
                charges: [charge],
            });
    }
    return [...groups.values()]
        .filter((group) => group.charges.some((charge) => charge.amountNet !== 0))
        .sort(
            (a, b) =>
                a.bookedAt.getTime() - b.bookedAt.getTime() ||
                a.contractId.localeCompare(b.contractId),
        );
}

/** What an invoice is drawn up from. */
export interface InvoiceDraftInput {
    group: InvoiceGroup;
    /** The contract the group's charges belong to: where each line takes its title and place. */
    contractLines: readonly Pick<ContractLineItemRecord, 'id' | 'titleSnapshot'>[];
    tenantId: string;
    subscriberId: string;
    subscriber: SubscriptionInvoiceSubscriber;
    issuer: SubscriptionInvoiceIssuer;
    /** The treatment the tax adapter decides for the subscriber now (`SC-PRIC-043`). */
    treatment: TaxTreatment;
    /** The adapter's rule for the tax of an invoice (`SC-PRIC-041`). */
    tax: (lines: readonly InvoiceTaxLine[]) => TaxPerRate;
    issuedAt: Date;
    /** The installation's time zone, which every day the invoice states is read in (`SC-PRIC-045`). */
    timeZone: string;
    numberPrefix: string;
    /** Days from the issue date to the due date (`SC-PRIC-046`). */
    paymentTermDays: number;
}

/**
 * The invoice `input.group` makes. Its lines follow the contract's lines, so
 * the invoice reads in the order the contract does, each naming its charge and
 * its contract line (`SC-AUD-013`) and taking the contract line's title. Every
 * line carries the treatment's rate, and the tax is the adapter's, computed
 * once per rate over the lines' net amounts.
 *
 * Throws where the charges contradict each other — a currency or a contract
 * line the group cannot have — which no invoice can be drawn up from.
 */
export function draftSubscriptionInvoice(input: InvoiceDraftInput): NewSubscriptionInvoice {
    const { group, treatment, timeZone } = input;
    const lines = linesOf(input);
    const issueDate = dayInZone(input.issuedAt, timeZone);
    const tax = input.tax(lines.map((line) => ({ net: line.amountNet, rate: line.taxRate })));
    return {
        numberPrefix: input.numberPrefix,
        numberYear: yearOfDay(issueDate),
        tenantId: input.tenantId,
        subscriberId: input.subscriberId,
        subscriptionId: group.charges[0]!.subscriptionId,
        contractId: group.contractId,
        issuedAt: input.issuedAt,
        issueDate,
        dueDate: addDaysToDay(issueDate, input.paymentTermDays),
        servicePeriodFrom: lines.map((line) => line.periodFrom).sort()[0]!,
        servicePeriodUntil: lines
            .map((line) => line.periodUntil)
            .sort()
            .at(-1)!,
        currency: currencyOf(group),
        issuer: input.issuer,
        subscriber: input.subscriber,
        taxTreatment: treatment,
        taxes: tax.rates,
        totalNet: tax.net,
        totalTax: tax.tax,
        totalGross: tax.gross,
        lines,
    };
}

/** What the tax adapter checks of an invoice before its number is drawn (`SC-PRIC-027`). */
export function invoiceContentDraftOf(invoice: NewSubscriptionInvoice): InvoiceContentDraft {
    return {
        issuer: invoice.issuer,
        subscriber: invoice.subscriber,
        treatment: invoice.taxTreatment,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        servicePeriod: { from: invoice.servicePeriodFrom, until: invoice.servicePeriodUntil },
        lines: invoice.lines.map((line) => ({
            title: line.title,
            net: line.amountNet,
            rate: line.taxRate,
        })),
    };
}

function linesOf(input: InvoiceDraftInput): NewSubscriptionInvoiceLine[] {
    const placeOf = new Map(input.contractLines.map((line, index) => [line.id, index]));
    const place = (charge: SubscriberChargeRecord): number => {
        const index = placeOf.get(charge.contractLineItemId);
        if (index === undefined) {
            throw new Error(
                `Charge ${charge.id} names contract line ${charge.contractLineItemId}, which contract ` +
                    `${input.group.contractId} does not have.`,
            );
        }
        return index;
    };
    return [...input.group.charges]
        .sort(
            (a, b) =>
                place(a) - place(b) ||
                a.periodStart.getTime() - b.periodStart.getTime() ||
                a.origin.localeCompare(b.origin),
        )
        .map((charge, index) => ({
            position: index + 1,
            chargeId: charge.id,
            contractLineItemId: charge.contractLineItemId,
            title: input.contractLines[place(charge)]!.titleSnapshot,
            origin: charge.origin,
            source: charge.source,
            periodFrom: dayInZone(charge.periodStart, input.timeZone),
            periodUntil: lastDayInZone(
                { from: charge.periodStart, until: charge.periodEnd },
                input.timeZone,
            ),
            amountNet: charge.amountNet,
            taxRate: input.treatment.rate,
        }));
}

function currencyOf(group: InvoiceGroup): string {
    const currencies = new Set(group.charges.map((charge) => charge.currency));
    if (currencies.size !== 1) {
        throw new Error(
            `The charges of contract ${group.contractId} booked at ${group.bookedAt.toISOString()} ` +
                `are in ${[...currencies].join(' and ')}; an invoice is in one currency.`,
        );
    }
    return [...currencies][0]!;
}
