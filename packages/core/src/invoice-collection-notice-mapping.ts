// A notice about collecting an invoice, read back from the record of notices.
//
// The record keeps what was handed to the invoice mail port, as JSON. A run
// that sends a notice again, or reads the day an announcement named, reads it
// through here, so a record of the wrong shape stops at the read and names
// its row, rather than reaching a subscriber or a collection date.

import { oneOf } from './closed-value.js';
import { dayOf } from './column-day.js';
import { COLLECTION_FAILURE_REASONS } from './invoice-collection-mapping.js';
import type {
    CollectionAnnouncedNotice,
    CollectionFailedNotice,
    CollectionFailureNext,
} from './invoice-collection-notice.types.js';
import { PAYMENT_METHOD_TYPES } from './subscriber-payment-method-mapping.js';

const TABLE = 'subscription_notices';

const NEXT_ACTIONS: readonly CollectionFailureNext['action'][] = [
    'charged-again',
    'announced-again',
    'replace-payment-method',
];

/** Reads the named fields of a JSON object, each checked as it is asked for. */
class NoticeFields {
    constructor(
        private readonly content: unknown,
        private readonly id: string,
    ) {}

    private where(column: string) {
        return { table: TABLE, column: `content.${column}`, id: this.id };
    }

    private value(name: string): unknown {
        if (this.content === null || typeof this.content !== 'object') {
            throw new Error(`${TABLE}.content of ${this.id} is not a notice.`);
        }
        return Object.getOwnPropertyDescriptor(this.content, name)?.value;
    }

    text(name: string): string {
        const value = this.value(name);
        if (typeof value !== 'string' || value === '') {
            throw new Error(`${TABLE}.content.${name} of ${this.id} is not a text.`);
        }
        return value;
    }

    amount(name: string): number {
        const value = this.value(name);
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new Error(`${TABLE}.content.${name} of ${this.id} is not an amount.`);
        }
        return value;
    }

    day(name: string) {
        return dayOf(this.value(name), this.where(name));
    }

    oneOf<T extends string>(allowed: readonly T[], name: string): T {
        return oneOf(allowed, this.text(name), this.where(name));
    }

    nested(name: string): NoticeFields {
        return new NoticeFields(this.value(name), this.id);
    }

    invoice() {
        return {
            tenantId: this.text('tenantId'),
            subscriptionId: this.text('subscriptionId'),
            subscriberId: this.text('subscriberId'),
            invoiceId: this.text('invoiceId'),
            invoiceNumber: this.text('invoiceNumber'),
            amount: this.amount('amount'),
            currency: this.text('currency'),
        };
    }
}

/** A recorded `collection-failed` notice, `id` being its record's. */
export function toCollectionFailedNotice(content: unknown, id: string): CollectionFailedNotice {
    const fields = new NoticeFields(content, id);
    const next = fields.nested('next');
    const action = next.oneOf(NEXT_ACTIONS, 'action');
    return {
        kind: fields.oneOf(['collection-failed'], 'kind'),
        ...fields.invoice(),
        paymentMethodType: fields.oneOf(PAYMENT_METHOD_TYPES, 'paymentMethodType'),
        reason: fields.oneOf(COLLECTION_FAILURE_REASONS, 'reason'),
        next: action === 'charged-again' ? { action, on: next.day('on') } : { action },
    };
}

/** A recorded `collection-announced` notice, `id` being its record's. */
export function toCollectionAnnouncedNotice(
    content: unknown,
    id: string,
): CollectionAnnouncedNotice {
    const fields = new NoticeFields(content, id);
    return {
        kind: fields.oneOf(['collection-announced'], 'kind'),
        ...fields.invoice(),
        collectOn: fields.day('collectOn'),
        mandateReference: fields.text('mandateReference'),
        last4: fields.text('last4'),
    };
}
