// What the collections brought, in memory, as the persistence contract holds
// both adapters to keep it: a payment once by its gateway account and
// reference, settling what its invoice owes and crediting the rest, a refund
// divided across the credits — the one its payment left first, then the
// oldest — and given back once when it fails, a payout never beyond what a
// credit owes. Each method decides in one synchronous step, as the turn does.

import {
    isEndedRefund,
    openOfCredit,
    owedOn,
    paymentSettlement,
    refundParts,
    toCents,
} from '@saasicat/core';

export class MemorySubscriberPayments {
    /** `invoices` is the invoice store's list, which every payment is settled against. */
    constructor(invoices) {
        this.invoices = invoices;
        this.payments = [];
        this.settlements = [];
        this.credits = [];
        this.entries = [];
        this.refunds = [];
        this.counter = 0;
    }

    snapshot() {
        const { payments, settlements, credits, entries, refunds } = this;
        return structuredClone({ payments, settlements, credits, entries, refunds });
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
            this.settlements
                .filter((each) => each.invoiceId === invoice.id)
                .map((each) => each.amount),
        );
    }

    #credit(invoice, amount, origin, createdAt) {
        const key = origin.kind === 'payment' ? origin.paymentId : origin.invoiceId;
        if (this.credits.some((each) => each.originKey === key)) return null;
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
                amount: settles,
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
            };
        const open = this.#standings(payment.subscriberId)
            .filter(({ credit }) => credit.currency === refund.currency)
            .map(({ credit, open: owed }) => ({ ...credit, open: owed }));
        const { parts, unmatched } = refundParts(refund.amount, payment.id, open);
        this.#entries(written, 'REFUND', parts, refund.at);
        return { outcome: 'recorded', refund: structuredClone(written), parts, unmatched };
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
        return { outcome: 'given-back', refund: structuredClone(known), parts };
    }

    #entries(refund, kind, parts, recordedAt) {
        for (const { creditId, amount } of parts) {
            this.entries.push({
                id: this.#id('entry'),
                creditId,
                kind,
                amount,
                refundId: refund.id,
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

    async findPaymentByRef(gatewayAccount, gatewayRef) {
        const found = this.payments.find(
            (each) => each.gatewayAccount === gatewayAccount && each.gatewayRef === gatewayRef,
        );
        return found ? structuredClone(found) : null;
    }

    async listPaymentsByInvoice(invoiceId) {
        return structuredClone(this.payments.filter((each) => each.invoiceId === invoiceId));
    }

    async owedBy(invoiceId) {
        const invoice = this.invoices.find((each) => each.id === invoiceId);
        return invoice ? this.#owed(invoice) : null;
    }
}
