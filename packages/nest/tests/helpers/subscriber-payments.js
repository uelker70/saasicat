// What the collections brought, in memory, as the persistence contract holds
// both adapters to keep it: a payment once by its gateway account and
// reference, settling what its invoice owes and crediting the rest, a refund
// divided across the credits — the one its payment left first, then the
// oldest — and given back once when it fails, a payout never beyond what a
// credit owes, a reversal that takes back the credit first and opens the
// invoice with the rest, given back part for part, and the cases nothing
// matched. Each method decides in one synchronous step, as the turn does.

import {
    CASE_CLOSED_REFUND_ENDED,
    CASE_CLOSED_REVERSAL_GIVEN_BACK,
    REOPENING_SETTLEMENT_KINDS,
    casesCovered,
    isEndedRefund,
    netByInvoice,
    openOfCredit,
    owedOn,
    paidOutByCredit,
    paymentSettlement,
    refundParts,
    reinstatementParts,
    toCents,
    withdrawalParts,
} from '@saasicat/core';

/** What a settlement takes off what its invoice owes: a reversal adds to it. */
const signed = (each) =>
    REOPENING_SETTLEMENT_KINDS.includes(each.kind) ? -each.amount : each.amount;

export class MemorySubscriberPayments {
    /** `invoices` is the invoice store's list, which every payment is settled against. */
    constructor(invoices) {
        this.invoices = invoices;
        this.payments = [];
        this.settlements = [];
        this.credits = [];
        this.entries = [];
        this.refunds = [];
        this.reversals = [];
        this.cases = [];
        this.counter = 0;
    }

    snapshot() {
        const { payments, settlements, credits, entries, refunds, reversals, cases } = this;
        return structuredClone({
            payments,
            settlements,
            credits,
            entries,
            refunds,
            reversals,
            cases,
        });
    }

    restore(saved) {
        Object.assign(this, saved);
    }

    #id(prefix) {
        this.counter += 1;
        return `${prefix}-${this.counter}`;
    }

    #invoice(invoiceId) {
        const invoice = this.invoices.find((each) => each.id === invoiceId);
        if (!invoice) throw new Error(`no invoice ${invoiceId}`);
        return invoice;
    }

    #owed(invoice) {
        return owedOn(
            invoice.totalGross,
            this.settlements.filter((each) => each.invoiceId === invoice.id).map(signed),
        );
    }

    #credit(invoice, amount, origin, createdAt) {
        const key =
            origin.kind === 'payment'
                ? origin.paymentId
                : origin.kind === 'invoice'
                  ? origin.invoiceId
                  : null;
        if (key !== null && this.credits.some((each) => each.originKey === key)) return null;
        const credit = {
            id: this.#id('credit'),
            subscriberId: invoice.subscriberId,
            tenantId: invoice.tenantId,
            amount,
            currency: invoice.currency,
            origin,
            createdAt,
            originKey: key,
        };
        this.credits.push(credit);
        const { originKey: _key, ...record } = credit;
        return structuredClone(record);
    }

    #standings(subscriberId) {
        return this.credits
            .filter((each) => each.subscriberId === subscriberId)
            .map(({ originKey: _key, ...credit }) => {
                const entries = this.entries.filter((each) => each.creditId === credit.id);
                return {
                    credit: structuredClone(credit),
                    entries: structuredClone(entries),
                    open: openOfCredit(credit.amount, entries),
                };
            });
    }

    async recordPayment(payment) {
        const invoice = this.#invoice(payment.invoiceId);
        if (invoice.currency !== payment.currency) throw new Error('another currency');
        const taken = this.payments.some(
            (each) =>
                each.gatewayAccount === payment.gatewayAccount &&
                each.gatewayRef === payment.gatewayRef,
        );
        if (taken) return null;
        const { at, ...rest } = payment;
        const recorded = {
            id: this.#id('payment'),
            subscriberId: invoice.subscriberId,
            tenantId: invoice.tenantId,
            ...rest,
            recordedAt: at,
        };
        const { settles, credits } = paymentSettlement(payment.amount, this.#owed(invoice));
        this.payments.push(recorded);
        if (settles > 0) {
            this.settlements.push({
                invoiceId: invoice.id,
                paymentId: recorded.id,
                kind: 'PAYMENT',
                amount: settles,
                reversalId: null,
            });
        }
        const credit =
            credits > 0
                ? this.#credit(invoice, credits, { kind: 'payment', paymentId: recorded.id }, at)
                : null;
        return { payment: structuredClone(recorded), settled: settles, credit };
    }

    async creditInvoice(invoiceId, at) {
        const invoice = this.#invoice(invoiceId);
        if (invoice.totalGross >= 0) return null;
        return this.#credit(invoice, -invoice.totalGross, { kind: 'invoice', invoiceId }, at);
    }

    async listUncredited({ limit, after }) {
        return this.invoices
            .filter(
                (invoice) =>
                    invoice.totalGross < 0 &&
                    !this.credits.some((each) => each.originKey === invoice.id) &&
                    (after === undefined || invoice.id > after),
            )
            .map((invoice) => invoice.id)
            .sort()
            .slice(0, limit);
    }

    async recordRefund(refund) {
        const payment = this.payments.find(
            (each) =>
                each.gatewayAccount === refund.gatewayAccount &&
                each.gatewayRef === refund.paymentRef,
        );
        if (!payment) return { outcome: 'unknown-payment' };
        if (refund.currency !== payment.currency) throw new Error('another currency');
        const known = this.refunds.find(
            (each) =>
                each.gatewayAccount === refund.gatewayAccount &&
                each.gatewayRef === refund.gatewayRef,
        );
        if (known) return this.#restate(known, refund);
        const ends = isEndedRefund(refund.status);
        const written = {
            id: this.#id('refund'),
            subscriberId: payment.subscriberId,
            paymentId: payment.id,
            gatewayAccount: refund.gatewayAccount,
            gatewayRef: refund.gatewayRef,
            amount: refund.amount,
            currency: refund.currency,
            status: refund.status,
            recordedAt: refund.at,
            endedAt: ends ? refund.at : null,
        };
        this.refunds.push(written);
        if (ends)
            return {
                outcome: 'recorded',
                refund: structuredClone(written),
                parts: [],
                unmatched: 0,
                case: null,
            };
        const open = this.#standings(payment.subscriberId)
            .filter(({ credit }) => credit.currency === refund.currency)
            .map(({ credit, open: owed }) => ({ ...credit, open: owed }));
        const { parts, unmatched } = refundParts(refund.amount, payment.id, open);
        this.#entries(written, 'REFUND', parts, refund.at);
        const opened =
            unmatched > 0
                ? this.#openCase('REFUND_UNMATCHED', unmatched, payment, written, refund.at)
                : null;
        return {
            outcome: 'recorded',
            refund: structuredClone(written),
            parts,
            unmatched,
            case: opened,
        };
    }

    #restate(known, refund) {
        if (isEndedRefund(known.status) || known.status === refund.status) {
            return { outcome: 'unchanged', refund: structuredClone(known) };
        }
        const ends = isEndedRefund(refund.status);
        Object.assign(known, { status: refund.status, endedAt: ends ? refund.at : null });
        if (!ends) return { outcome: 'unchanged', refund: structuredClone(known) };
        const parts = this.entries
            .filter((each) => each.refundId === known.id && each.kind === 'REFUND')
            .map(({ creditId, amount }) => ({ creditId, amount }));
        this.#entries(known, 'REFUND_FAILED', parts, refund.at);
        const closedCases = this.#closeCases(
            (each) => each.refundId === known.id,
            CASE_CLOSED_REFUND_ENDED,
            refund.at,
        );
        return { outcome: 'given-back', refund: structuredClone(known), parts, closedCases };
    }

    #openCase(kind, amount, payment, about, at) {
        const opened = {
            id: this.#id('case'),
            subscriberId: payment.subscriberId,
            tenantId: payment.tenantId,
            kind,
            amount,
            currency: payment.currency,
            paymentId: payment.id,
            refundId: kind === 'REFUND_UNMATCHED' ? about.id : null,
            reversalId: kind === 'REFUND_UNMATCHED' ? null : about.id,
            gatewayAccount: about.gatewayAccount,
            gatewayRef: about.gatewayRef,
            recordedAt: at,
            closedAt: null,
            closedBy: null,
            note: null,
        };
        this.cases.push(opened);
        return structuredClone(opened);
    }

    #closeCases(names, note, at, only) {
        return this.cases
            .filter((each) => names(each) && each.closedAt === null)
            .filter((each) => !only || only.includes(each.id))
            .map((each) => {
                Object.assign(each, { closedAt: at, closedBy: null, note });
                return structuredClone(each);
            });
    }

    #entries(refund, kind, parts, recordedAt) {
        for (const { creditId, amount } of parts) {
            this.entries.push({
                id: this.#id('entry'),
                creditId,
                kind,
                amount,
                refundId: refund.id,
                reversalId: null,
                reference: refund.gatewayRef,
                paidOn: null,
                recordedBy: null,
                note: null,
                recordedAt,
            });
        }
    }

    async recordPayout(payout) {
        const credit = this.credits.find((each) => each.id === payout.creditId);
        if (!credit) return { outcome: 'unknown-credit' };
        const owed = openOfCredit(
            credit.amount,
            this.entries.filter((each) => each.creditId === credit.id),
        );
        if (toCents(payout.amount) > toCents(owed)) return { outcome: 'exceeds-open', open: owed };
        const { at, ...rest } = payout;
        const entry = {
            id: this.#id('entry'),
            kind: 'PAYOUT',
            refundId: null,
            reversalId: null,
            ...rest,
            recordedAt: at,
        };
        this.entries.push(entry);
        return {
            outcome: 'recorded',
            entry: structuredClone(entry),
            open: (toCents(owed) - toCents(payout.amount)) / 100,
        };
    }

    async listCredits(subscriberId) {
        return this.#standings(subscriberId);
    }

    async findPaymentById(id) {
        const found = this.payments.find((each) => each.id === id);
        return found ? structuredClone(found) : null;
    }

    async findReversalById(id) {
        const found = this.reversals.find((each) => each.id === id);
        return found ? structuredClone(found) : null;
    }

    async findPaymentByRef(gatewayAccount, gatewayRef) {
        const found = this.payments.find(
            (each) => each.gatewayAccount === gatewayAccount && each.gatewayRef === gatewayRef,
        );
        return found ? structuredClone(found) : null;
    }

    async listPaymentsByInvoice(invoiceId) {
        return structuredClone(this.payments.filter((each) => each.invoiceId === invoiceId));
    }

    /** Whether the invoice still owes something, as the attempts' turn reads it. */
    stillOwes(invoiceId) {
        const invoice = this.invoices.find((each) => each.id === invoiceId);
        return invoice ? this.#owed(invoice) > 0 : true;
    }

    async owedBy(invoiceId) {
        const invoice = this.invoices.find((each) => each.id === invoiceId);
        return invoice ? this.#owed(invoice) : null;
    }

    async owedByInvoices(invoiceIds) {
        return this.invoices
            .filter((invoice) => invoiceIds.includes(invoice.id))
            .map((invoice) => ({ invoiceId: invoice.id, owed: this.#owed(invoice) }));
    }

    async recordReversal(reported) {
        const payment = this.payments.find(
            (each) =>
                each.gatewayAccount === reported.gatewayAccount &&
                each.gatewayRef === reported.paymentRef,
        );
        if (!payment) return { outcome: 'unknown-payment' };
        if (reported.currency !== payment.currency) throw new Error('another currency');
        let reversal = this.reversals.find(
            (each) =>
                each.gatewayAccount === reported.gatewayAccount &&
                each.gatewayRef === reported.gatewayRef,
        );
        if (!reversal) {
            reversal = {
                id: this.#id('reversal'),
                subscriberId: payment.subscriberId,
                tenantId: payment.tenantId,
                paymentId: payment.id,
                gatewayAccount: reported.gatewayAccount,
                gatewayRef: reported.gatewayRef,
                amount: 0,
                currency: reported.currency,
                fromCredit: 0,
                reinstated: 0,
                recordedAt: reported.at,
                reinstatedAt: null,
            };
            this.reversals.push(reversal);
        }
        let withdrawal = null;
        const withdrawn = toCents(reported.withdrawn) - toCents(reversal.amount);
        if (withdrawn > 0) {
            const taken = this.#withdraw(reversal, payment, withdrawn / 100, reported.at);
            reversal.amount = reported.withdrawn;
            reversal.fromCredit = (toCents(reversal.fromCredit) + toCents(taken.fromCredit)) / 100;
            withdrawal = taken.withdrawal;
        }
        let reinstatement = null;
        const given =
            Math.min(toCents(reported.reinstated), toCents(reversal.amount)) -
            toCents(reversal.reinstated);
        if (given > 0) {
            reinstatement = this.#reinstate(reversal, payment, given / 100, reported.at);
            reversal.reinstated = (toCents(reversal.reinstated) + given) / 100;
            reversal.reinstatedAt = reported.at;
        }
        if (!withdrawal && !reinstatement) {
            return { outcome: 'unchanged', reversal: structuredClone(reversal) };
        }
        return {
            outcome: 'recorded',
            reversal: structuredClone(reversal),
            withdrawal,
            reinstatement,
        };
    }

    #withdraw(reversal, payment, amount, at) {
        const credit = this.credits.find((each) => each.originKey === payment.id);
        const taken = this.reversals
            .filter((each) => each.paymentId === payment.id)
            .reduce((sum, each) => sum + toCents(each.fromCredit), 0);
        const parts = withdrawalParts(
            amount,
            credit
                ? {
                      creditId: credit.id,
                      left: (toCents(credit.amount) - taken) / 100,
                      open: openOfCredit(
                          credit.amount,
                          this.entries.filter((each) => each.creditId === credit.id),
                      ),
                  }
                : null,
            netByInvoice(
                this.settlements
                    .filter((each) => each.paymentId === payment.id)
                    .map((each) => ({ invoiceId: each.invoiceId, amount: signed(each) })),
            ).map((net) => ({ invoiceId: net.invoiceId, left: net.amount })),
        );
        if (parts.credit) this.#reversalEntry(reversal, 'REVERSAL', parts.credit, at);
        for (const part of parts.invoices) {
            this.settlements.push({
                invoiceId: part.invoiceId,
                paymentId: payment.id,
                kind: 'REVERSAL',
                amount: part.amount,
                reversalId: reversal.id,
            });
        }
        const opened =
            parts.unmatched > 0
                ? this.#openCase('REVERSAL_UNMATCHED', parts.unmatched, payment, reversal, at)
                : null;
        return {
            fromCredit: parts.fromCredit,
            withdrawal: {
                credit: parts.credit,
                invoices: parts.invoices,
                unmatched: parts.unmatched,
                case: opened,
            },
        };
    }

    #reinstate(reversal, payment, amount, at) {
        const cases = this.cases.filter((each) => each.reversalId === reversal.id);
        const unmatched = cases.reduce((sum, each) => sum + toCents(each.amount), 0);
        const coveredBefore = Math.min(toCents(reversal.reinstated), unmatched);
        const parts = reinstatementParts(amount, {
            unmatched: (unmatched - coveredBefore) / 100,
            credits: paidOutByCredit(
                this.entries.filter((each) => each.reversalId === reversal.id),
            ).map((part) => ({ creditId: part.creditId, left: part.amount })),
            invoices: netByInvoice(
                this.settlements
                    .filter((each) => each.reversalId === reversal.id)
                    .map((each) => ({ invoiceId: each.invoiceId, amount: signed(each) })),
            ).map((net) => ({
                invoiceId: net.invoiceId,
                left: -net.amount,
                owed: this.#owed(this.#invoice(net.invoiceId)),
            })),
        });
        const closedCases = this.#closeCases(
            (each) => each.reversalId === reversal.id,
            CASE_CLOSED_REVERSAL_GIVEN_BACK,
            at,
            casesCovered(cases, (coveredBefore + toCents(parts.covered)) / 100),
        );
        for (const part of parts.credits)
            this.#reversalEntry(reversal, 'REVERSAL_TAKEN_BACK', part, at);
        for (const part of parts.invoices) {
            this.settlements.push({
                invoiceId: part.invoiceId,
                paymentId: payment.id,
                kind: 'REINSTATEMENT',
                amount: part.amount,
                reversalId: reversal.id,
            });
        }
        const credit =
            parts.credited > 0
                ? this.#credit(
                      payment,
                      parts.credited,
                      { kind: 'reversal', reversalId: reversal.id },
                      at,
                  )
                : null;
        return { closedCases, credits: parts.credits, invoices: parts.invoices, credit };
    }

    #reversalEntry(reversal, kind, part, recordedAt) {
        this.entries.push({
            id: this.#id('entry'),
            creditId: part.creditId,
            kind,
            amount: part.amount,
            refundId: null,
            reversalId: reversal.id,
            reference: reversal.gatewayRef,
            paidOn: null,
            recordedBy: null,
            note: null,
            recordedAt,
        });
    }

    async listCases(filter, { limit, after }) {
        const found = this.cases.filter(
            (each) =>
                (each.closedAt === null) === (filter.state === 'open') &&
                (filter.subscriberId === undefined || each.subscriberId === filter.subscriberId),
        );
        const from = after ? found.findIndex((each) => each.id === after) + 1 : 0;
        return structuredClone(found.slice(from, from + limit));
    }

    async closeCase(close) {
        const found = this.cases.find((each) => each.id === close.caseId);
        if (!found) return { outcome: 'unknown-case' };
        if (found.closedAt !== null)
            return { outcome: 'already-closed', case: structuredClone(found) };
        Object.assign(found, { closedAt: close.at, closedBy: close.closedBy, note: close.note });
        return { outcome: 'closed', case: structuredClone(found) };
    }

    async accountsHoldingCredits() {
        const accounts = new Set();
        for (const { credit, open } of this.credits.flatMap((each) =>
            this.#standings(each.subscriberId).filter((standing) => standing.credit.id === each.id),
        )) {
            const paymentId =
                credit.origin.kind === 'payment'
                    ? credit.origin.paymentId
                    : credit.origin.kind === 'reversal'
                      ? this.reversals.find((each) => each.id === credit.origin.reversalId)
                            ?.paymentId
                      : null;
            const payment = this.payments.find((each) => each.id === paymentId);
            if (payment && open > 0) accounts.add(payment.gatewayAccount);
        }
        return [...accounts].sort();
    }
}
