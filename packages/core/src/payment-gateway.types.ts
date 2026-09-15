// Payment gateway — where a subscriber's means of payment live.
//
// SaaSiCat never holds a card number or an IBAN. The person enters them in the
// gateway's own form; the gateway confirms, and SaaSiCat keeps the gateway's
// reference with the masked details (ADR 0012). A gateway account — a merchant
// account at a provider, named in `config/saas.yaml#payments` — is what a
// reference is meaningful to, so every reference is stored with the account
// that issued it.

import type { PartyAddress } from './subscriber.types.js';

/** The payment methods SaaSiCat takes, by the names `config/saas.yaml` uses. */
export type PaymentMethodType = 'card' | 'sepa_debit';

/**
 * Whom a payment method is set up for. The gateway hands it back unchanged
 * with its confirmation, which is how the confirmation finds its way to the
 * sign-up or the subscriber that asked for it.
 */
export type PaymentMethodSetupSubject =
    | { kind: 'registration'; pendingRegistrationId: string }
    | { kind: 'subscriber'; subscriberId: string };

/** The party the gateway keeps the payment method for: its customer there. */
export interface PaymentMethodHolder {
    /** The legal name, which a direct debit mandate names. */
    name: string;
    /** Where the gateway sends what it sends; `null` lets its form ask. */
    email: string | null;
    address: PartyAddress;
    /**
     * The customer this party already has at the account, from an earlier
     * payment method. `null` asks the gateway for a new one.
     */
    customerRef: string | null;
}

export interface StartPaymentMethodSetupInput {
    subject: PaymentMethodSetupSubject;
    holder: PaymentMethodHolder;
    /** What the form offers, from the account's `methods`. */
    methods: readonly PaymentMethodType[];
    /** Where the gateway sends the person once the form is done. */
    successUrl: string;
    /** Where the gateway sends the person who leaves the form. */
    cancelUrl: string;
}

/** A body and headers exactly as they arrived, before anything parsed them. */
export interface PaymentGatewayCallback {
    body: string | Uint8Array;
    headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}

export interface PaymentMethodSetupSession {
    /** The gateway's identifier of the session, unique within its account. */
    sessionRef: string;
    /** The gateway's form, where the person is sent next. */
    redirectUrl: string;
    /** The customer the payment method is set up for, created if none was given. */
    customerRef: string;
    /**
     * A confirmation the gateway already holds when the session starts, to be
     * handled like any callback. Only a gateway without a form of its own has
     * one — the development gateway; a real gateway confirms through its
     * webhook.
     */
    immediateCallback?: PaymentGatewayCallback;
}

/**
 * What SaaSiCat keeps about a payment method: enough to show which one it is,
 * never enough to pay with it (`SC-PRIV-005`).
 */
export interface MaskedPaymentMethod {
    type: PaymentMethodType;
    /** The card network, such as `visa`; `null` for a direct debit. */
    brand: string | null;
    /** The last four digits of the card number or the IBAN. */
    last4: string;
    /** 1–12; `null` for a direct debit. */
    expiryMonth: number | null;
    /** Four digits; `null` for a direct debit. */
    expiryYear: number | null;
    /** ISO 3166-1 alpha-2 of the card's issuer or the bank account, where the gateway says. */
    country: string | null;
    /** The bank code of a direct debit account, where the gateway says. */
    bankCode: string | null;
    /** The reference of a direct debit mandate, which a debit announcement quotes. */
    mandateReference: string | null;
}

/** A payment method the gateway confirmed, with the references that reach it there. */
export interface ConfirmedPaymentMethod extends MaskedPaymentMethod {
    customerRef: string;
    paymentMethodRef: string;
}

/** A gateway callback, verified and translated. */
export type PaymentGatewayEvent =
    | {
          kind: 'payment-method-confirmed';
          /** The gateway's identifier of the event, unique within its account. */
          eventId: string;
          /** When the gateway says it happened. */
          occurredAt: Date;
          sessionRef: string;
          subject: PaymentMethodSetupSubject;
          paymentMethod: ConfirmedPaymentMethod;
      }
    | {
          kind: 'payment-method-setup-failed';
          eventId: string;
          occurredAt: Date;
          sessionRef: string;
          subject: PaymentMethodSetupSubject;
      }
    | {
          /** Genuine, and nothing SaaSiCat acts on. */
          kind: 'unhandled';
          eventId: string;
          occurredAt: Date;
          /** The gateway's own name for the event, for the log. */
          type: string;
      };

/**
 * One account at a payment gateway: its keys, its form and its callbacks.
 *
 * An adapter is bound to one account, and `config/saas.yaml#payments.accounts`
 * names it. Mollie or any other provider is another adapter behind this port.
 */
export interface PaymentGateway {
    /** The provider, as `config/saas.yaml` names it, e.g. `stripe`. */
    readonly provider: string;
    /**
     * Opens the gateway's form for a payment method. Nothing is confirmed until
     * the gateway says so through `readCallback`.
     */
    startPaymentMethodSetup(input: StartPaymentMethodSetupInput): Promise<PaymentMethodSetupSession>;
    /**
     * Verifies a callback with the account's secret and translates it.
     * Throws `PaymentCallbackRejectedError` for anything the gateway did not
     * send, before a single field of it is trusted.
     */
    readCallback(callback: PaymentGatewayCallback): Promise<PaymentGatewayEvent>;
}

const PAYMENT_CALLBACK_REJECTED = 'PAYMENT_CALLBACK_REJECTED';

/**
 * A callback that is not the gateway's: a missing or wrong signature, a stale
 * timestamp, a body that was altered. Nothing is read from it.
 */
export class PaymentCallbackRejectedError extends Error {
    readonly code = PAYMENT_CALLBACK_REJECTED;
    constructor(reason: string) {
        super(`Payment callback rejected: ${reason}`);
        this.name = 'PaymentCallbackRejectedError';
    }
}

/** Realm-safe type guard, like `isPlatformUserExistsError`. */
export function isPaymentCallbackRejectedError(err: unknown): err is PaymentCallbackRejectedError {
    return err instanceof Error && (err as { code?: string }).code === PAYMENT_CALLBACK_REJECTED;
}
