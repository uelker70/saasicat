// SubscriberCharge — one charge in a subscriber's account.
// Wire format: @saasicat/spec/schemas/subscriber-ledger.schema.json, from which
// the origin and source unions are generated.

import type {
    SubscriberChargeOrigin,
    SubscriberChargeSource,
} from './generated/subscriber-ledger.gen.js';

export type {
    SubscriberCharge,
    SubscriberChargeOrigin,
    SubscriberChargeSource,
} from './generated/subscriber-ledger.gen.js';

/** A charge as a store reads it back: the wire format, with its dates as dates. */
export interface SubscriberChargeRecord {
    id: string;
    subscriberId: string;
    tenantId: string;
    subscriptionId: string;
    contractId: string;
    contractLineItemId: string;
    origin: SubscriberChargeOrigin;
    source: SubscriberChargeSource;
    /** The subscription id for the plan, the booking id for an add-on, the discount's key. */
    sourceRef: string;
    periodStart: Date;
    periodEnd: Date;
    currency: string;
    /** Net, rounded to the cent when written. Negative for a discount. */
    amountNet: number;
    /** When the amount became due. */
    bookedAt: Date;
    createdAt: Date;
}

/** A charge to write: everything but what the store assigns. */
export type NewSubscriberCharge = Omit<SubscriberChargeRecord, 'id' | 'createdAt'>;
