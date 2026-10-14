// Payment gateway — where a subscriber's means of payment live, and where an
// invoice is collected with them.
//
// SaaSiCat never holds a card number or an IBAN. The person enters them in the
// gateway's own form; the gateway confirms, and SaaSiCat keeps the gateway's
// reference with the masked details (ADR 0012). A gateway account — a merchant
// account at a provider, named in `config/saas.yaml#payments` — is what a
// reference is meaningful to, so every reference is stored with the account
// that issued it.
//
// An invoice is collected with the payment method it announced, without the
// subscriber present. Every request carries a key that stays the same for that
// invoice and attempt, so a request whose answer was lost is repeated as the
// same request, and the gateway can be asked what became of it before anything
// is sent under a new key (`SC-PRIC-034`).

import type { PartyAddress } from './legal-identity.js';

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
    /**
     * The gateway's identifier of the session, unique within its account — and
     * an adapter that has no session of its own makes one per start rather than
     * a constant. A session is confirmed once, which the event log holds, so a
     * value two starts share lets the second confirmation through as the
     * duplicate it is not.
     */
    sessionRef: string;
    /** The gateway's form, where the person is sent next. */
    redirectUrl: string;
    /** The customer the payment method is set up for, created if none was given. */
    customerRef: string;
    /**
     * The last moment a confirmation of this session can still arrive: the end
     * of its form, after which nobody can complete it, plus the time the
     * gateway goes on retrying a confirmation it could not deliver. `null` for
     * a gateway that states neither. A sign-up's promo code slot is held until
     * then, so a form paid shortly before its end still finds its slot when the
     * confirmation arrives late, and an abandoned form gives it back.
     */
    confirmableUntil: Date | null;
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
          /**
           * What became of a collection, reported by the gateway on its own:
           * the same outcome `findCollection` answers, for the attempt its key
           * names. Each report reads the payment as it stands when the adapter
           * translates it, so reports arriving out of order never take an
           * attempt back to an earlier state.
           */
          kind: 'collection-reported';
          eventId: string;
          occurredAt: Date;
          attemptKey: string;
          outcome: CollectionOutcome;
      }
    | {
          /**
           * A refund the operator made in the gateway, of a payment an attempt
           * of SaaSiCat's collected, as it stands when the adapter translates
           * the report: created, settled, failed or canceled.
           */
          kind: 'refund-reported';
          eventId: string;
          occurredAt: Date;
          /** The attempt that collected the payment it pays back. */
          attemptKey: string;
          refund: GatewayRefund;
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
 * Why a collection failed, in SaaSiCat's words; the gateway's own code is kept
 * beside it. Whether a second try can pass follows from the reason alone
 * (`isRetryableCollectionFailure`):
 *
 * - `insufficient-funds` — the account or the card does not cover the amount;
 * - `declined` — refused without a reason that rules out a second try, or the
 *   bank or issuer could not be reached;
 * - `authentication-required` — the card's bank asks the subscriber to confirm
 *   the payment, which nobody can do while they are not present;
 * - `payment-method-unusable` — the card is lost, stolen, blocked or expired,
 *   or the account is closed or restricted;
 * - `mandate-invalid` — the direct debit's mandate was revoked, does not match
 *   or was disputed;
 * - `other` — anything the gateway names that is none of these.
 */
export type CollectionFailureReason =
    | 'insufficient-funds'
    | 'declined'
    | 'authentication-required'
    | 'payment-method-unusable'
    | 'mandate-invalid'
    | 'other';

/** The collection of one invoice, as the platform asks a gateway to make it. */
export interface CollectInvoiceInput {
    /**
     * The same for this invoice and attempt across every repeat of the
     * request, and kept by the gateway with what it creates, so
     * `findCollection` finds it again. Never a second charge for one key.
     */
    attemptKey: string;
    invoiceId: string;
    /** The invoice's number, which the subscriber's statement names. */
    invoiceNumber: string;
    /** The invoice's gross amount in cents, of `currency`. */
    amountCents: number;
    /** As `config/saas.yaml#currency` writes it, e.g. `EUR`. */
    currency: string;
    /** The customer the payment method is kept for at the gateway. */
    customerRef: string;
    paymentMethodRef: string;
    type: PaymentMethodType;
}

/**
 * What became of a collection: collected, still on its way — a direct debit
 * is submitted to the bank and settles days later —, or failed.
 * `paymentRef` is the gateway's reference to what it created for the attempt.
 */
export type CollectionOutcome =
    | {
          status: 'succeeded';
          paymentRef: string;
          /** What the gateway received, in cents of `currency`. */
          amountCents: number;
          /** As `config/saas.yaml#currency` writes it, e.g. `EUR`. */
          currency: string;
      }
    | { status: 'pending'; paymentRef: string }
    | {
          status: 'failed';
          /** `null` where the gateway refused before it created anything. */
          paymentRef: string | null;
          reason: CollectionFailureReason;
          /** The gateway's own code for the reason, for the operator. */
          gatewayCode: string | null;
      };

/**
 * A refund as the gateway reports it. `pending` and `succeeded` pay the money
 * out; `failed` and `canceled` gave it back to the operator.
 */
export interface GatewayRefund {
    /** The gateway's reference to the refund, unique within its account. */
    refundRef: string;
    /** The gateway's reference to the payment it pays back. */
    paymentRef: string;
    amountCents: number;
    /** As `config/saas.yaml#currency` writes it, e.g. `EUR`. */
    currency: string;
    status: 'pending' | 'succeeded' | 'failed' | 'canceled';
}

/** Which attempt the gateway is asked about. */
export interface FindCollectionInput {
    attemptKey: string;
    customerRef: string;
    /** The gateway's reference, where an earlier answer named one. */
    paymentRef: string | null;
    /** When the attempt was first submitted: nothing created before it is its. */
    submittedAt: Date;
}

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
     *
     * A failure is thrown as the provider reported it: the platform answers the
     * person with `PAYMENT_GATEWAY_FAILED` and keeps what the error carries —
     * its kind, code, status and request id — in the server log.
     */
    startPaymentMethodSetup(
        input: StartPaymentMethodSetupInput,
    ): Promise<PaymentMethodSetupSession>;
    /**
     * Verifies a callback with the account's secret and translates it.
     * Throws `PaymentCallbackRejectedError` for anything the gateway did not
     * send, before a single field of it is trusted. Any other failure is
     * answered with `PAYMENT_GATEWAY_FAILED` and 502, like one of
     * `startPaymentMethodSetup` — to the gateway's webhook, or to the person
     * an `immediateCallback` is read for.
     */
    readCallback(callback: PaymentGatewayCallback): Promise<PaymentGatewayEvent>;
    /**
     * Collects an invoice with the payment method it announced, without the
     * subscriber present, under `attemptKey`: a repeat of the request with the
     * same key creates nothing new.
     *
     * Answers a refusal — a declined card, a debit the bank turned down — as a
     * `failed` outcome. Throws only where the answer is unknown: the request
     * may or may not have reached the gateway, and the platform asks
     * `findCollection` before it sends anything again.
     */
    collect(input: CollectInvoiceInput): Promise<CollectionOutcome>;
    /**
     * What became of the attempt `attemptKey` names, read from the gateway
     * itself; `null` where the gateway holds nothing under it, so the request
     * never arrived and may be sent again. Throws where the gateway cannot be
     * asked.
     */
    findCollection(input: FindCollectionInput): Promise<CollectionOutcome | null>;
}

/** The reasons a second try can pass on: a balance that changes, a refusal without a cause. */
const RETRYABLE_FAILURES: ReadonlySet<CollectionFailureReason> = new Set([
    'insufficient-funds',
    'declined',
]);

/**
 * Whether a collection that failed for `reason` can pass on a second try: an
 * account short of funds and a refusal without a cause can; a closed account,
 * a revoked mandate, a lost card or a payment the subscriber has to confirm
 * cannot, and asks the subscriber to act instead.
 */
export function isRetryableCollectionFailure(reason: CollectionFailureReason): boolean {
    return RETRYABLE_FAILURES.has(reason);
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
