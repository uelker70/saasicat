// A payment gateway and the two payment stores, in memory, for tests whose
// subject is what the platform does with a gateway: its callbacks, the claim
// and the effect on one transaction, and the payment method it confirms.
//
// The stores keep their rows in a form `RollbackRunner` can put back, so a
// handler that throws takes its claim and its writes with it — the property
// the persistence contract checks against PostgreSQL.

import { PaymentCallbackRejectedError, subscriberPaymentMethodColumns } from '@saasicat/core';

/** The account every test takes payment methods at, unless it names another. */
export const MAIN_ACCOUNT = 'stripe-main';

/** A catalogue with `payments`, and nothing else a payment test reads. */
export function paymentsCatalog(
    payments = {
        newPaymentMethods: MAIN_ACCOUNT,
        accounts: { [MAIN_ACCOUNT]: { provider: 'stripe', methods: ['card', 'sepa_debit'] } },
    },
) {
    return {
        schemaVersion: 1,
        app: { name: 'Test App' },
        currency: 'EUR',
        vatRate: 19,
        plans: [],
        payments,
    };
}

const SIGNATURE_HEADER = 'x-test-signature';
const SIGNED = 'signed-by-the-gateway';

/** A gateway that records what it was asked, and reads the callbacks `signedCallback` builds. */
export class ScriptedGateway {
    constructor(provider = 'stripe') {
        this.provider = provider;
        this.setups = [];
    }

    async startPaymentMethodSetup(input) {
        this.setups.push(structuredClone(input));
        const n = this.setups.length;
        return {
            sessionRef: `cs_${n}`,
            redirectUrl: `https://gateway.example/form/cs_${n}`,
            customerRef: input.holder.customerRef ?? `cus_${n}`,
        };
    }

    async readCallback({ body, headers }) {
        if (headers[SIGNATURE_HEADER] !== SIGNED) {
            throw new PaymentCallbackRejectedError('no valid test signature');
        }
        const event = JSON.parse(Buffer.from(body).toString('utf8'));
        return { ...event, occurredAt: new Date(event.occurredAt) };
    }
}

/** The callback a gateway sends for `event`, as the webhook route receives it. */
export function signedCallback(event) {
    return { body: Buffer.from(JSON.stringify(event)), headers: { [SIGNATURE_HEADER]: SIGNED } };
}

/** The same callback, with the signature of somebody who is not the gateway. */
export function forgedCallback(event) {
    return { body: Buffer.from(JSON.stringify(event)), headers: { [SIGNATURE_HEADER]: 'forged' } };
}

/** A confirmed card for `subject`, from the session `sessionRef`. */
export function confirmation({
    eventId,
    sessionRef,
    subject,
    paymentMethodRef = 'pm_card_1',
    customerRef = 'cus_1',
    occurredAt = '2026-09-15T10:00:00.000Z',
}) {
    return {
        kind: 'payment-method-confirmed',
        eventId,
        occurredAt,
        sessionRef,
        subject,
        paymentMethod: {
            type: 'card',
            brand: 'visa',
            last4: '4242',
            expiryMonth: 12,
            expiryYear: 2030,
            country: 'DE',
            bankCode: null,
            mandateReference: null,
            customerRef,
            paymentMethodRef,
        },
    };
}

export class MemoryPaymentEventLog {
    constructor() {
        this.claims = [];
    }

    snapshot() {
        return structuredClone(this.claims);
    }

    restore(claims) {
        this.claims = claims;
    }

    async claim(claim, tx) {
        if (tx === undefined) throw new Error('a gateway event was claimed outside a transaction');
        const taken = this.claims.some(
            (held) =>
                held.gatewayAccount === claim.gatewayAccount && held.eventId === claim.eventId,
        );
        if (taken) return false;
        this.claims.push(structuredClone(claim));
        return true;
    }
}

export class MemoryPaymentMethods {
    constructor() {
        this.rows = [];
        this.setups = [];
        this.writes = [];
    }

    snapshot() {
        return structuredClone({ rows: this.rows, setups: this.setups });
    }

    restore({ rows, setups }) {
        this.rows = rows;
        this.setups = setups;
    }

    async recordSetup(data) {
        if (
            this.setups.some(
                (s) => s.gatewayAccount === data.gatewayAccount && s.sessionRef === data.sessionRef,
            )
        ) {
            throw new Error(`session ${data.sessionRef} already has a setup`);
        }
        this.setups.push({ ...data, completedAt: null });
    }

    async completeSetup(match, completedAt) {
        const setup = this.setups.find(
            (s) =>
                s.gatewayAccount === match.gatewayAccount &&
                s.sessionRef === match.sessionRef &&
                s.subscriberId === match.subscriberId &&
                s.completedAt === null,
        );
        if (!setup) return false;
        setup.completedAt = completedAt;
        return true;
    }

    async recordConfirmed(data, tx) {
        this.writes.push({ paymentMethodRef: data.paymentMethodRef, tx });
        const recorded = this.rows.find(
            (row) =>
                row.gatewayAccount === data.gatewayAccount &&
                row.paymentMethodRef === data.paymentMethodRef,
        );
        if (recorded) return { method: structuredClone(recorded), outcome: 'already-recorded' };
        const active = this.rows.find(
            (row) => row.subscriberId === data.subscriberId && row.status === 'ACTIVE',
        );
        const row = {
            ...subscriberPaymentMethodColumns(data),
            id: `payment-method-${this.rows.length + 1}`,
            createdAt: new Date(),
        };
        if (active && active.confirmedAt > data.confirmedAt) {
            this.rows.push({ ...row, status: 'REPLACED', replacedAt: active.confirmedAt });
            return { method: structuredClone(this.rows.at(-1)), outcome: 'superseded' };
        }
        if (active) Object.assign(active, { status: 'REPLACED', replacedAt: data.confirmedAt });
        this.rows.push({ ...row, status: 'ACTIVE', replacedAt: null });
        return { method: structuredClone(this.rows.at(-1)), outcome: 'activated' };
    }

    async findActive(subscriberId) {
        const row = this.rows.find((r) => r.subscriberId === subscriberId && r.status === 'ACTIVE');
        return row ? structuredClone(row) : null;
    }

    async findByReference(gatewayAccount, paymentMethodRef) {
        const row = this.rows.find(
            (r) => r.gatewayAccount === gatewayAccount && r.paymentMethodRef === paymentMethodRef,
        );
        return row ? structuredClone(row) : null;
    }

    async accountsInUse() {
        return [
            ...new Set(this.rows.filter((r) => r.status === 'ACTIVE').map((r) => r.gatewayAccount)),
        ];
    }
}

/** A transaction runner that puts the stores it was given back when its callback throws. */
export class RollbackRunner {
    constructor(stores) {
        this.stores = stores;
        this.opened = 0;
    }

    async run(fn) {
        const snapshots = this.stores.map((store) => store.snapshot());
        const tx = { transaction: ++this.opened };
        try {
            return await fn(tx);
        } catch (error) {
            this.stores.forEach((store, i) => store.restore(snapshots[i]));
            throw error;
        }
    }
}
