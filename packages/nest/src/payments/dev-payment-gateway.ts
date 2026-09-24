import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
    ConfirmedPaymentMethod,
    PaymentGateway,
    PaymentGatewayCallback,
    PaymentGatewayEvent,
    PaymentMethodSetupSession,
    PaymentMethodSetupSubject,
    PaymentMethodType,
    StartPaymentMethodSetupInput,
} from '@saasicat/core';
import { PaymentCallbackRejectedError } from '@saasicat/core';

const SIGNATURE_HEADER = 'x-saasicat-dev-signature';

/** The provider name `config/saas.yaml` gives an account bound to this gateway. */
export const DEV_PAYMENT_PROVIDER = 'dev';

interface DevConfirmation {
    eventId: string;
    occurredAt: string;
    sessionRef: string;
    subject: PaymentMethodSetupSubject;
    paymentMethod: ConfirmedPaymentMethod;
}

/**
 * A payment gateway for development and tests, with no provider behind it.
 *
 * It opens no form: starting a setup confirms the first payment method the
 * account offers straight away, as a callback signed with a key it holds in
 * memory, which the platform handles like any other — verified, claimed and
 * recorded on one transaction. The person is sent to the success URL.
 *
 * It takes no means of payment and charges nothing, which is why it refuses to
 * be constructed with `NODE_ENV=production`.
 */
export class DevPaymentGateway implements PaymentGateway {
    readonly provider = DEV_PAYMENT_PROVIDER;
    private readonly key = randomBytes(32);

    constructor() {
        if (process.env.NODE_ENV === 'production') {
            throw new Error(
                'DevPaymentGateway confirms every payment method without taking one, and refuses to ' +
                    'run with NODE_ENV=production. Bind a gateway adapter such as @saasicat/payment-stripe.',
            );
        }
    }

    async startPaymentMethodSetup(
        input: StartPaymentMethodSetupInput,
    ): Promise<PaymentMethodSetupSession> {
        const sessionRef = `dev_cs_${randomUUID()}`;
        const customerRef = input.holder.customerRef ?? `dev_cus_${randomUUID()}`;
        const confirmation: DevConfirmation = {
            eventId: `dev_evt_${randomUUID()}`,
            occurredAt: new Date().toISOString(),
            sessionRef,
            subject: input.subject,
            paymentMethod: {
                ...maskedDetailsOf(input.methods[0] ?? 'card'),
                customerRef,
                paymentMethodRef: `dev_pm_${randomUUID()}`,
            },
        };
        const body = JSON.stringify(confirmation);
        return {
            sessionRef,
            redirectUrl: input.successUrl,
            customerRef,
            // Confirmed on the spot: there is no form left to complete later.
            confirmableUntil: null,
            immediateCallback: { body, headers: { [SIGNATURE_HEADER]: this.sign(body) } },
        };
    }

    async readCallback(callback: PaymentGatewayCallback): Promise<PaymentGatewayEvent> {
        const body =
            typeof callback.body === 'string'
                ? callback.body
                : Buffer.from(callback.body).toString('utf8');
        const signature = callback.headers[SIGNATURE_HEADER];
        if (typeof signature !== 'string' || !this.verify(body, signature)) {
            throw new PaymentCallbackRejectedError('the development signature does not verify');
        }
        const confirmation = JSON.parse(body) as DevConfirmation;
        return {
            kind: 'payment-method-confirmed',
            eventId: confirmation.eventId,
            occurredAt: new Date(confirmation.occurredAt),
            sessionRef: confirmation.sessionRef,
            subject: confirmation.subject,
            paymentMethod: confirmation.paymentMethod,
        };
    }

    private sign(body: string): string {
        return createHmac('sha256', this.key).update(body).digest('hex');
    }

    private verify(body: string, signature: string): boolean {
        const expected = Buffer.from(this.sign(body), 'hex');
        const given = Buffer.from(signature, 'hex');
        return given.length === expected.length && timingSafeEqual(given, expected);
    }
}

/** Test data a real gateway would never hand out: Stripe's documented test card and test IBAN. */
function maskedDetailsOf(
    type: PaymentMethodType,
): Omit<ConfirmedPaymentMethod, 'customerRef' | 'paymentMethodRef'> {
    if (type === 'sepa_debit') {
        return {
            type,
            brand: null,
            last4: '3000',
            expiryMonth: null,
            expiryYear: null,
            country: 'DE',
            bankCode: '37040044',
            mandateReference: `DEV-${randomUUID().slice(0, 8).toUpperCase()}`,
        };
    }
    return {
        type,
        brand: 'visa',
        last4: '4242',
        expiryMonth: 12,
        expiryYear: new Date().getUTCFullYear() + 3,
        country: null,
        bankCode: null,
        mandateReference: null,
    };
}
