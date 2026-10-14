import { createHash } from 'node:crypto';
import Stripe from 'stripe';
import type {
    CollectInvoiceInput,
    CollectionFailureReason,
    CollectionOutcome,
    FindCollectionInput,
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

/**
 * Where a collection's attempt key and invoice ride on the payment intent:
 * the key is what `findCollection` finds the intent by again.
 */
const ATTEMPT_KEY = 'saasicat_attempt';
const INVOICE_ID = 'saasicat_invoice';

/**
 * How far before an attempt's first submission the intents of its customer are
 * searched: the moment is this machine's clock, and an intent's `created` is
 * Stripe's.
 */
const CLOCK_MARGIN_SECONDS = 60 * 60;

/**
 * Currencies Stripe does not take to the cent: in whole units or thousandths,
 * or, for `isk` and `ugx`, in cents of which it takes only whole units.
 * SaaSiCat computes every amount to the cent, so an invoice in one of them
 * would be collected for a hundredfold or a tenth of what it says, or refused
 * wherever it has cents.
 */
const NOT_TO_THE_CENT: ReadonlySet<string> = new Set([
    'bif',
    'clp',
    'djf',
    'gnf',
    'jpy',
    'kmf',
    'krw',
    'mga',
    'pyg',
    'rwf',
    'ugx',
    'vnd',
    'vuv',
    'xaf',
    'xof',
    'xpf',
    'bhd',
    'jod',
    'kwd',
    'omr',
    'tnd',
    'isk',
]);

/**
 * The code an invoice in another currency than the account's is refused with,
 * before anything is sent: only the account's currency was checked against
 * `NOT_TO_THE_CENT`, and a direct debit's mandate is set up in it. Prefixed so
 * that nobody reads it as one of Stripe's.
 */
const OTHER_CURRENCY = 'saasicat_other_currency';

/**
 * The statuses of a request Stripe refused as it stands, which no repeat of it
 * changes: a card declined (`402`), a parameter it does not take or an object
 * that no longer exists (`400`, `404`). A conflict (`409`, such as
 * `idempotency_key_in_use` while the first request under the key is still
 * running) or a lock that timed out (`429`) says nothing about whether a charge
 * was made, and Stripe's advice is to repeat the request under the same key:
 * every other status is thrown, whichever class the Stripe library gives it,
 * and the attempt is asked about later.
 */
const REFUSED_REQUEST: ReadonlySet<number> = new Set([400, 402, 404]);

/**
 * The reason each of Stripe's codes stands for: a card's decline code, or a
 * direct debit's failure code. A code not named here is `other`, which no
 * second try is made for.
 */
const FAILURE_REASONS: ReadonlyMap<string, CollectionFailureReason> = new Map([
    ['insufficient_funds', 'insufficient-funds'],
    ...[
        'generic_decline',
        'card_declined',
        'do_not_honor',
        'call_issuer',
        'no_action_taken',
        'transaction_not_allowed',
        'try_again_later',
        'issuer_not_available',
        'processing_error',
        'reenter_transaction',
        'approve_with_id',
        'card_velocity_exceeded',
        'withdrawal_count_limit_exceeded',
        'refer_to_customer',
        'generic_could_not_process',
        // A volume limit of the account, which clears with time.
        'charge_exceeds_source_limit',
        'charge_exceeds_weekly_limit',
    ].map((code): [string, CollectionFailureReason] => [code, 'declined']),
    ['authentication_required', 'authentication-required'],
    ...[
        'expired_card',
        'lost_card',
        'stolen_card',
        'pickup_card',
        'restricted_card',
        'card_not_supported',
        'currency_not_supported',
        'invalid_account',
        'new_account_information_available',
        'incorrect_number',
        'invalid_number',
        'invalid_expiry_month',
        'invalid_expiry_year',
        'account_closed',
        'bank_account_restricted',
        'branch_does_not_exist',
        'invalid_account_number',
        'no_account',
        'recipient_deceased',
        'resource_missing',
        'payment_method_unexpected_state',
    ].map((code): [string, CollectionFailureReason] => [code, 'payment-method-unusable']),
    ...[
        'authorization_revoked',
        'debit_not_authorized',
        'debit_authorization_not_match',
        'debit_disputed',
        'incorrect_account_holder_name',
        'revocation_of_authorization',
        'revocation_of_all_authorizations',
        'stop_payment_order',
    ].map((code): [string, CollectionFailureReason] => [code, 'mandate-invalid']),
]);

const SIGNATURE_HEADER = 'stripe-signature';

/**
 * How long Stripe goes on delivering an event it could not deliver: up to three
 * days in live mode, with an exponential back-off (sandboxes retry three times
 * within a few hours). A session completed just before its `expires_at` can
 * therefore be confirmed that much later. A delivery resent by hand from the
 * dashboard, possible for fifteen days, is not covered.
 */
const WEBHOOK_RETRY_SECONDS = 3 * 24 * 60 * 60;

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
 * How long an event about a setup that has settled on none of those is asked
 * about again. Measured from the moment Stripe created it, so its retries are
 * deliveries of one event and share the one window.
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
        if (NOT_TO_THE_CENT.has(this.currency)) {
            throw new Error(
                `Stripe does not take ${options.currency} to the cent, and SaaSiCat computes ` +
                    'every amount to the cent: an invoice in it would be collected for another ' +
                    'amount than it states, or refused.',
            );
        }
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
        return {
            sessionRef: session.id,
            redirectUrl: session.url,
            customerRef,
            confirmableUntil: new Date((session.expires_at + WEBHOOK_RETRY_SECONDS) * 1000),
        };
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

    /**
     * Confirms a payment intent off session for the payment method the
     * invoice announced, under the attempt key as its idempotency key: a
     * repeat within Stripe's day of keeping the key gets the same intent, and
     * `findCollection` finds it by the key in its metadata after that. A
     * direct debit uses the mandate its setup created. An invoice in another
     * currency than the account's is refused without a request.
     */
    async collect(input: CollectInvoiceInput): Promise<CollectionOutcome> {
        if (input.currency.toLowerCase() !== this.currency) {
            return {
                status: 'failed',
                paymentRef: null,
                reason: 'other',
                gatewayCode: OTHER_CURRENCY,
            };
        }
        let intent: Stripe.PaymentIntent;
        try {
            intent = await this.stripe.paymentIntents.create(
                {
                    amount: input.amountCents,
                    currency: this.currency,
                    customer: input.customerRef,
                    payment_method: input.paymentMethodRef,
                    payment_method_types: [input.type],
                    off_session: true,
                    confirm: true,
                    description: `Invoice ${input.invoiceNumber}`,
                    metadata: { [ATTEMPT_KEY]: input.attemptKey, [INVOICE_ID]: input.invoiceId },
                    expand: ['latest_charge'],
                },
                { idempotencyKey: input.attemptKey },
            );
        } catch (error) {
            return refusalOf(error);
        }
        return outcomeOf(intent);
    }

    /**
     * The intent the attempt created, by its reference where an answer named
     * one, or by its key among the customer's intents created since it was
     * first submitted; `null` where there is none. A list rather than
     * Stripe's search, which answers what it indexed a while ago.
     */
    async findCollection(input: FindCollectionInput): Promise<CollectionOutcome | null> {
        if (input.paymentRef !== null) {
            const intent = await this.stripe.paymentIntents.retrieve(input.paymentRef, {
                expand: ['latest_charge'],
            });
            if (intent.metadata?.[ATTEMPT_KEY] !== input.attemptKey) {
                throw new Error(
                    `Payment intent ${input.paymentRef} carries another attempt than ` +
                        `${input.attemptKey}, which it was recorded for.`,
                );
            }
            return outcomeOf(intent);
        }
        const since = Math.floor(input.submittedAt.getTime() / 1000) - CLOCK_MARGIN_SECONDS;
        for await (const intent of this.stripe.paymentIntents.list({
            customer: input.customerRef,
            created: { gte: since },
            limit: 100,
            expand: ['data.latest_charge'],
        })) {
            if (intent.metadata?.[ATTEMPT_KEY] === input.attemptKey) return outcomeOf(intent);
        }
        return null;
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
 * What became of a collection, as its payment intent stands: a direct debit is
 * `processing` until the bank settles it, and an intent that asks for a
 * payment method again carries the reason the last one failed.
 */
function outcomeOf(intent: Stripe.PaymentIntent): CollectionOutcome {
    switch (intent.status) {
        case 'succeeded':
            return { status: 'succeeded', paymentRef: intent.id };
        case 'processing':
            return { status: 'pending', paymentRef: intent.id };
        case 'requires_payment_method': {
            const code = failureCodeOf(intent);
            return {
                status: 'failed',
                paymentRef: intent.id,
                reason: reasonOf(code),
                gatewayCode: code,
            };
        }
        // Off session nobody can complete what the bank asks for.
        case 'requires_action':
            return {
                status: 'failed',
                paymentRef: intent.id,
                reason: 'authentication-required',
                gatewayCode: failureCodeOf(intent) ?? 'authentication_required',
            };
        case 'canceled':
            return {
                status: 'failed',
                paymentRef: intent.id,
                reason: 'other',
                gatewayCode: intent.cancellation_reason ?? 'canceled',
            };
        default:
            throw new Error(
                `Payment intent ${intent.id} is '${intent.status}', which an intent confirmed off ` +
                    'session with automatic capture does not stand in.',
            );
    }
}

/**
 * The code of the last failure: a card's decline code, which names why the
 * bank refused it — a charge's own code is `card_declined` for every one of
 * them —, else the charge's code, which is what names a direct debit's
 * failure, else the error's.
 */
function failureCodeOf(intent: Stripe.PaymentIntent): string | null {
    const charge = expanded<Stripe.Charge>(intent.latest_charge);
    const error = intent.last_payment_error;
    return error?.decline_code ?? charge?.failure_code ?? error?.code ?? null;
}

function reasonOf(code: string | null): CollectionFailureReason {
    return (code === null ? undefined : FAILURE_REASONS.get(code)) ?? 'other';
}

/**
 * What a refused request is a refusal of. A declined card is answered with the
 * intent it created where there is one; a request Stripe refused as invalid —
 * a payment method detached since, a parameter it does not take — created
 * none and is answered as failed. Anything else — a status `REFUSED_REQUEST`
 * does not name, the network, a rate limit, a key reused with other
 * parameters, Stripe's own error, the account's keys — says nothing about
 * whether a charge was made, and is thrown, so the attempt is asked about
 * later.
 */
function refusalOf(error: unknown): CollectionOutcome {
    if (
        !(error instanceof Stripe.errors.StripeError) ||
        !REFUSED_REQUEST.has(error.statusCode ?? 0)
    ) {
        throw error;
    }
    if (error instanceof Stripe.errors.StripeCardError) {
        if (error.payment_intent) return outcomeOf(error.payment_intent);
        const code = error.decline_code ?? error.code ?? null;
        return { status: 'failed', paymentRef: null, reason: reasonOf(code), gatewayCode: code };
    }
    if (error instanceof Stripe.errors.StripeInvalidRequestError) {
        if (error.payment_intent) return outcomeOf(error.payment_intent);
        const code = error.code ?? null;
        return { status: 'failed', paymentRef: null, reason: reasonOf(code), gatewayCode: code };
    }
    throw error;
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

/**
 * The subject a session was opened for: `null` where the metadata names none, or
 * names a kind this build does not know.
 *
 * Not "where THIS installation did not open it": every installation writes the
 * same two metadata keys, so a session opened by one sharing this Stripe account
 * parses here as an ordinary subject. What keeps its confirmation from changing
 * anything is the open setup it is matched against further in, not this
 * function — and an account is meant to belong to one installation for that
 * reason among others (see the README). The unknown kind is the other half of
 * the same case: a sibling on a newer version reads as `null` here, which is
 * why that answer means "nothing to do with this build" rather than "nobody
 * opened it".
 */
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
