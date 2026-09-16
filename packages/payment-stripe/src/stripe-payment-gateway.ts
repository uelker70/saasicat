import { createHash } from 'node:crypto';
import Stripe from 'stripe';
import type {
    MaskedPaymentMethod,
    PaymentGateway,
    PaymentGatewayCallback,
    PaymentGatewayEvent,
    PaymentMethodSetupSession,
    PaymentMethodSetupSubject,
    StartPaymentMethodSetupInput,
} from '@saasicat/core';
import { PAYMENT_METHOD_TYPES, PaymentCallbackRejectedError } from '@saasicat/core';

/** The provider name `config/saas.yaml#payments.accounts` gives an account bound to this gateway. */
export const STRIPE_PAYMENT_PROVIDER = 'stripe';

/**
 * Where the subject rides on the session Stripe keeps.
 *
 * Stripe hands metadata back unchanged with every event about the session, and
 * a session without these two is one this installation did not open — the
 * account may serve the application's own payments as well, and those events
 * are none of SaaSiCat's business.
 */
const SUBJECT_KIND = 'saasicat_subject_kind';
const SUBJECT_ID = 'saasicat_subject_id';

const SIGNATURE_HEADER = 'stripe-signature';

/**
 * The states a setup ends in: `succeeded` is the payment method, and the other
 * two are the attempt that did not produce one. A failed attempt does not stay
 * failed in Stripe's vocabulary — the intent goes back to asking for a payment
 * method, with the error beside it — and one nobody came back to is cancelled.
 */
const SETUP_GAVE_UP: ReadonlySet<Stripe.SetupIntent.Status> = new Set([
    'requires_payment_method',
    'canceled',
]);

/**
 * How long a delivery about a setup that has settled on none of those is asked
 * about again.
 *
 * The state is read after the delivery, so a setup still on its way is a race
 * the next attempt wins. The bound is what keeps a state that never settles
 * from failing every delivery for ever: Stripe turns off an endpoint that keeps
 * failing, and that would take every other sign-up at the account with it.
 *
 * Twelve hours, because Stripe's retries are front-loaded — the first six land
 * inside that — while the endpoint is turned off only after days of failing, so
 * the bound sits well inside the margin it is there for. It leaves room for a
 * direct debit whose mandate takes hours to register; a payment method whose
 * setup takes longer than that would need a wider window, and none can be
 * configured today, because `PaymentMethodType` is the card and the direct
 * debit.
 */
const ASK_AGAIN_FOR_MS = 12 * 60 * 60 * 1000;

export interface StripePaymentGatewayOptions {
    /**
     * The secret key of the account this gateway is bound to, from the
     * environment. `config/saas.yaml` refuses to carry it.
     */
    secretKey: string;
    /** The signing secret of that account's webhook endpoint, also from the environment. */
    webhookSecret: string;
    /**
     * The currency a mandate is set up in, as `config/saas.yaml#currency` names
     * it. Stripe asks for it whenever a direct debit is among the payment
     * methods offered, and takes it for a card as well.
     */
    currency: string;
    /**
     * A Stripe client to use instead of one built from `secretKey` — for an
     * application that configures its own, and for tests against a local
     * server.
     */
    client?: Stripe;
}

/**
 * The Stripe side of one gateway account.
 *
 * A payment method is set up in Stripe Checkout in `setup` mode: the person
 * enters the card or the IBAN in Stripe's own form, and what comes back here is
 * a reference to the payment method Stripe now holds, with the masked details
 * that tell one apart from another (ADR 0012). Nothing is charged; collecting
 * is a later step.
 *
 * One instance serves one account. Two accounts are two instances with their
 * own keys, and an event is read with the secret of the account it arrived at.
 */
export class StripePaymentGateway implements PaymentGateway {
    readonly provider = STRIPE_PAYMENT_PROVIDER;
    private readonly stripe: Stripe;
    // A real private field: a secret that is only unreachable by convention
    // still turns up in anything that walks the object, a logged provider
    // among them.
    readonly #webhookSecret: string;
    private readonly currency: string;

    constructor(options: StripePaymentGatewayOptions) {
        this.#webhookSecret = options.webhookSecret;
        // Stripe takes the currency in lower case, and `config/saas.yaml`
        // writes it the way an invoice does.
        this.currency = options.currency.toLowerCase();
        this.stripe =
            options.client ??
            new Stripe(options.secretKey, {
                // The version the installed library's types describe, so the
                // fields read below are the fields Stripe sends. Upgrading the
                // library is what moves it, deliberately and in one place.
                apiVersion: Stripe.API_VERSION,
                maxNetworkRetries: 2,
            });
    }

    async startPaymentMethodSetup(
        input: StartPaymentMethodSetupInput,
    ): Promise<PaymentMethodSetupSession> {
        const customerRef = input.holder.customerRef ?? (await this.createCustomer(input));
        const metadata = metadataOf(input.subject);
        const session = await this.stripe.checkout.sessions.create({
            mode: 'setup',
            customer: customerRef,
            payment_method_types: [...input.methods],
            currency: this.currency,
            success_url: input.successUrl,
            cancel_url: input.cancelUrl,
            metadata,
            // The same subject on the setup intent: an event about the intent
            // rather than the session still says whom it was set up for.
            setup_intent_data: { metadata },
        });
        if (!session.url) {
            throw new Error(
                `Stripe opened checkout session ${session.id} without a URL to send the person to, ` +
                    'which a hosted session always has. Check the account for an embedded ' +
                    'checkout configuration.',
            );
        }
        return { sessionRef: session.id, redirectUrl: session.url, customerRef };
    }

    async readCallback(callback: PaymentGatewayCallback): Promise<PaymentGatewayEvent> {
        const event = this.verified(callback);
        const occurredAt = new Date(event.created * 1000);
        if (event.type === 'checkout.session.completed') {
            return this.confirmationOf(event.data.object, event.id, occurredAt);
        }
        if (event.type === 'checkout.session.expired') {
            const session = event.data.object;
            const subject = subjectOf(session);
            if (session.mode !== 'setup' || !subject) {
                return { kind: 'unhandled', eventId: event.id, occurredAt, type: event.type };
            }
            return {
                kind: 'payment-method-setup-failed',
                eventId: event.id,
                occurredAt,
                sessionRef: session.id,
                subject,
            };
        }
        return { kind: 'unhandled', eventId: event.id, occurredAt, type: event.type };
    }

    private async createCustomer(input: StartPaymentMethodSetupInput): Promise<string> {
        const { holder, subject } = input;
        const params: Stripe.CustomerCreateParams = {
            name: holder.name,
            ...(holder.email === null ? {} : { email: holder.email }),
            address: {
                line1: holder.address.addressLine1 ?? undefined,
                line2: holder.address.addressLine2 ?? undefined,
                postal_code: holder.address.postalCode ?? undefined,
                city: holder.address.city ?? undefined,
                country: holder.address.country ?? undefined,
            },
            metadata: metadataOf(subject),
        };
        // The party and what is being asked for it. A request whose answer was
        // lost repeats under the same key and gets the customer it already
        // made; a second request that differs — another invoice email, a
        // corrected address — is a different request, and Stripe refuses a key
        // reused with other values rather than answering with the old customer.
        const customer = await this.stripe.customers.create(params, {
            idempotencyKey: `saasicat:customer:${subjectIdOf(subject)}:${fingerprintOf(params)}`,
        });
        return customer.id;
    }

    private verified(callback: PaymentGatewayCallback): Stripe.Event {
        const signature = signatureOf(callback.headers);
        if (signature === null) {
            throw new PaymentCallbackRejectedError(`the ${SIGNATURE_HEADER} header is missing`);
        }
        const body = typeof callback.body === 'string' ? callback.body : Buffer.from(callback.body);
        try {
            return this.stripe.webhooks.constructEvent(body, signature, this.#webhookSecret);
        } catch (error) {
            // Stripe's own reason — a signature that does not match, a
            // timestamp outside the tolerance, a body that was parsed and
            // re-serialised on the way — and never the secret it was checked
            // against.
            const reason = error instanceof Error ? error.message : String(error);
            throw new PaymentCallbackRejectedError(reason);
        }
    }

    private async confirmationOf(
        session: Stripe.Checkout.Session,
        eventId: string,
        occurredAt: Date,
    ): Promise<PaymentGatewayEvent> {
        const subject = subjectOf(session);
        if (session.mode !== 'setup' || !subject) {
            return {
                kind: 'unhandled',
                eventId,
                occurredAt,
                type: 'checkout.session.completed',
            };
        }
        const intentRef = idOf(session.setup_intent);
        if (intentRef === null) {
            throw new Error(
                `Stripe reported checkout session ${session.id} as completed in setup mode ` +
                    'without a setup intent, which a completed setup always has.',
            );
        }
        // Expanded rather than fetched one by one: the payment method carries
        // what is shown to the person, and the mandate the reference a debit
        // announcement quotes.
        const intent = await this.stripe.setupIntents.retrieve(intentRef, {
            expand: ['payment_method', 'mandate'],
        });
        // The setup produced no payment method and is not going to: an attempt
        // that failed leaves its error behind, and a cancelled intent is over
        // whether or not anything was tried. Asking for a payment method with
        // nothing recorded against it is an intent nobody confirmed yet, which
        // belongs to the race below rather than here. The port has an event for
        // a setup that failed, and a sign-up takes it as its cue to try again.
        if (
            intent.status === 'canceled' ||
            (SETUP_GAVE_UP.has(intent.status) && intent.last_setup_error !== null)
        ) {
            return {
                kind: 'payment-method-setup-failed',
                eventId,
                occurredAt,
                sessionRef: session.id,
                subject,
            };
        }
        // Still on its way — `processing` while a direct debit's mandate is
        // registered, or an action still outstanding. The state is read on this
        // second request, after the delivery, so it is a race and not a verdict:
        // failing the delivery is what makes Stripe ask again, and the next ask
        // reads the state it settled on. Answering it `200` would end the
        // matter with nothing recorded, and no other event picks a session back
        // up — until the race is old enough not to be one.
        if (intent.status !== 'succeeded') {
            if (Date.now() - occurredAt.getTime() < ASK_AGAIN_FOR_MS) {
                throw new Error(
                    `Stripe reported checkout session ${session.id} as completed while setup ` +
                        `intent ${intentRef} is '${intent.status}'; asking again reads the state ` +
                        'it settles on.',
                );
            }
            // Named, because this is the one answer that drops a session of
            // ours: the platform logs the type, and `checkout.session.completed`
            // alone would read like an event nobody acts on.
            return {
                kind: 'unhandled',
                eventId,
                occurredAt,
                type: `checkout.session.completed (setup intent ${intentRef} still '${intent.status}')`,
            };
        }
        const paymentMethod = expanded<Stripe.PaymentMethod>(intent.payment_method);
        if (paymentMethod === null) {
            throw new Error(
                `Stripe reported setup intent ${intentRef} as succeeded without a payment method.`,
            );
        }
        // A payment method whose shape SaaSiCat has nowhere to put is not
        // recorded, and does not fail the delivery either: asking again would
        // read the same answer, and Stripe turns an endpoint that keeps failing
        // off, which would take every other sign-up at this account with it. A
        // single setup nobody can use is the smaller loss, and the account
        // offers what `config/saas.yaml` names, so this is a misconfigured
        // account rather than a person's doing.
        const masked = maskedDetailsOf(paymentMethod, expanded<Stripe.Mandate>(intent.mandate));
        if (masked === null) {
            return {
                kind: 'unhandled',
                eventId,
                occurredAt,
                type: `checkout.session.completed (payment method ${paymentMethod.id} ${whyUnusable(paymentMethod)})`,
            };
        }
        return {
            kind: 'payment-method-confirmed',
            eventId,
            occurredAt,
            sessionRef: session.id,
            subject,
            paymentMethod: {
                ...masked,
                customerRef: customerRefOf(session, intent),
                paymentMethodRef: paymentMethod.id,
            },
        };
    }
}

/**
 * The masked details of a payment method Stripe confirmed, by its type, or
 * `null` where SaaSiCat has no shape for what came back.
 */
function maskedDetailsOf(
    paymentMethod: Stripe.PaymentMethod,
    mandate: Stripe.Mandate | null,
): MaskedPaymentMethod | null {
    if (paymentMethod.type === 'card' && paymentMethod.card) {
        const card = paymentMethod.card;
        return {
            type: 'card',
            brand: card.brand,
            last4: card.last4,
            expiryMonth: card.exp_month,
            expiryYear: card.exp_year,
            country: card.country ?? null,
            bankCode: null,
            mandateReference: null,
        };
    }
    const debit = paymentMethod.type === 'sepa_debit' ? paymentMethod.sepa_debit : undefined;
    // Without the last four digits there is nothing to tell this payment method
    // apart by, and the port promises them.
    if (debit?.last4) {
        return {
            type: 'sepa_debit',
            brand: null,
            last4: debit.last4,
            expiryMonth: null,
            expiryYear: null,
            country: debit.country ?? null,
            bankCode: debit.bank_code ?? null,
            mandateReference: mandate?.payment_method_details?.sepa_debit?.reference ?? null,
        };
    }
    // Recording another type as a card would tell the tenant something untrue,
    // and there is no third shape to record it as.
    return null;
}

/** What the request asks for, as one short value, so a different request takes a different key. */
function fingerprintOf(params: Stripe.CustomerCreateParams): string {
    return createHash('sha256').update(stableJsonOf(params)).digest('hex').slice(0, 32);
}

/** JSON whose key order does not depend on the order the fields were written in. */
function stableJsonOf(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(stableJsonOf).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, field]) => field !== undefined)
        .sort(([one], [other]) => (one < other ? -1 : 1))
        .map(([key, field]) => `${JSON.stringify(key)}:${stableJsonOf(field)}`);
    return `{${entries.join(',')}}`;
}

/**
 * Why a payment method has no masked details: a kind SaaSiCat does not keep, or
 * one it does with nothing in it to tell this payment method apart. An operator
 * reading the first at an account that offers exactly that kind would look in
 * the wrong place.
 */
function whyUnusable(paymentMethod: Stripe.PaymentMethod): string {
    return (PAYMENT_METHOD_TYPES as readonly string[]).includes(paymentMethod.type)
        ? `is a ${paymentMethod.type} with nothing to tell it apart by`
        : `is a ${paymentMethod.type}`;
}

/** The customer the payment method was set up for, as either object names it. */
function customerRefOf(session: Stripe.Checkout.Session, intent: Stripe.SetupIntent): string {
    const ref = idOf(session.customer) ?? idOf(intent.customer);
    if (ref === null) {
        throw new Error(
            `Stripe reported checkout session ${session.id} as completed without a customer, ` +
                'and a payment method is kept for one.',
        );
    }
    return ref;
}

function metadataOf(subject: PaymentMethodSetupSubject): Record<string, string> {
    return { [SUBJECT_KIND]: subject.kind, [SUBJECT_ID]: subjectIdOf(subject) };
}

function subjectIdOf(subject: PaymentMethodSetupSubject): string {
    return subject.kind === 'registration' ? subject.pendingRegistrationId : subject.subscriberId;
}

/** The subject a session was opened for, or `null` where this installation did not open it. */
function subjectOf(session: Stripe.Checkout.Session): PaymentMethodSetupSubject | null {
    const kind = session.metadata?.[SUBJECT_KIND];
    const id = session.metadata?.[SUBJECT_ID];
    if (typeof id !== 'string' || id.length === 0) return null;
    if (kind === 'registration') return { kind, pendingRegistrationId: id };
    if (kind === 'subscriber') return { kind, subscriberId: id };
    return null;
}

/** The identifier of a field Stripe sends either as a string or as the object itself. */
function idOf(field: string | { id: string } | null | undefined): string | null {
    if (typeof field === 'string') return field;
    return field?.id ?? null;
}

/** The object of an expandable field, or `null` where it was not expanded or is absent. */
function expanded<T extends { id: string }>(field: string | T | null | undefined): T | null {
    return field === null || field === undefined || typeof field === 'string' ? null : field;
}

/** The signature Stripe sent, whichever way the server handed the headers over. */
function signatureOf(
    headers: Readonly<Record<string, string | readonly string[] | undefined>>,
): string | null {
    for (const [name, value] of Object.entries(headers)) {
        if (name.toLowerCase() !== SIGNATURE_HEADER) continue;
        const signature = Array.isArray(value) ? value[0] : value;
        return typeof signature === 'string' && signature.length > 0 ? signature : null;
    }
    return null;
}
