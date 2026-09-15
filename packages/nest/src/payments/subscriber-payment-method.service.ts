import { ConflictException, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type {
    SubscriberPaymentMethodRecord,
    SubscriberPaymentMethodRepository,
    SubscriberRecord,
} from '@saasicat/core';
import { PAYMENT_ERROR_CODES } from '@saasicat/core';

import { codedError } from '../errors/coded-error.js';
import { SubscriberService } from '../subscriber/subscriber.service.js';
import {
    PaymentCallbackService,
    type PaymentEventContext,
    type PaymentMethodConfirmedEvent,
} from './payment-callback.service.js';
import { PaymentGatewayRegistry } from './payment-gateway-registry.js';
import { SUBSCRIBER_PAYMENT_METHOD_REPOSITORY_TOKEN } from './payments.tokens.js';

export interface StartPaymentMethodChange {
    successUrl: string;
    cancelUrl: string;
    /** Where the gateway writes when the subscriber's record holds no invoice email: the requesting user's. */
    fallbackEmail: string | null;
}

/**
 * A subscriber's payment method: the one in use, and replacing it through the
 * gateway's form.
 *
 * Nothing changes when the form is opened. The gateway confirms through its
 * callback, and the confirmation is what records the new payment method —
 * on the transaction that claims the callback.
 */
@Injectable()
export class SubscriberPaymentMethodService implements OnModuleInit {
    constructor(
        @Inject(SUBSCRIBER_PAYMENT_METHOD_REPOSITORY_TOKEN)
        private readonly methods: SubscriberPaymentMethodRepository,
        private readonly subscribers: SubscriberService,
        private readonly registry: PaymentGatewayRegistry,
        private readonly callbacks: PaymentCallbackService,
    ) {}

    onModuleInit(): void {
        this.callbacks.handleSetupsOf('subscriber', {
            confirmed: (event, context) => this.recordConfirmed(event, context),
            // Nothing was recorded for the setup, so a failed one changes nothing:
            // the payment method in use stays, and the claim keeps the event.
            failed: async () => undefined,
        });
    }

    /** The payment method in use for the tenant's subscriber, or `null` when it has none. */
    async current(tenantId: string): Promise<SubscriberPaymentMethodRecord | null> {
        const subscriber = await this.subscribers.requireForTenant(tenantId);
        return this.methods.findActive(subscriber.id);
    }

    /**
     * Opens the gateway's form for a new payment method for the tenant's
     * subscriber, and returns where to send the person.
     *
     * The customer the subscriber has at that account is reused, so the new
     * payment method sits beside the ones the gateway already holds for it.
     */
    async startChange(tenantId: string, input: StartPaymentMethodChange): Promise<{ redirectUrl: string }> {
        const subscriber = await this.subscribers.requireForTenant(tenantId);
        const account = this.registry.forNewPaymentMethods();
        if (!account) {
            throw new ConflictException(codedError(PAYMENT_ERROR_CODES.PAYMENTS_NOT_CONFIGURED));
        }
        const inUse = await this.methods.findActive(subscriber.id);
        const session = await account.gateway.startPaymentMethodSetup({
            subject: { kind: 'subscriber', subscriberId: subscriber.id },
            holder: holderOf(subscriber, input.fallbackEmail, customerAt(inUse, account.name)),
            methods: account.methods,
            successUrl: input.successUrl,
            cancelUrl: input.cancelUrl,
        });
        if (session.immediateCallback) {
            await this.callbacks.handle(account.name, session.immediateCallback);
        }
        return { redirectUrl: session.redirectUrl };
    }

    private async recordConfirmed(
        event: PaymentMethodConfirmedEvent,
        context: PaymentEventContext,
    ): Promise<void> {
        if (event.subject.kind !== 'subscriber') return;
        await this.methods.recordConfirmed(
            {
                ...event.paymentMethod,
                subscriberId: event.subject.subscriberId,
                gatewayAccount: context.gatewayAccount,
                provider: context.provider,
                confirmedAt: event.occurredAt,
            },
            context.tx,
        );
    }
}

/** The customer a payment method in use has at `account`, to be reused there. */
function customerAt(inUse: SubscriberPaymentMethodRecord | null, account: string): string | null {
    return inUse?.gatewayAccount === account ? inUse.customerRef : null;
}

function holderOf(subscriber: SubscriberRecord, fallbackEmail: string | null, customerRef: string | null) {
    return {
        name: subscriber.legalName,
        email: subscriber.invoiceEmail ?? fallbackEmail,
        address: {
            addressLine1: subscriber.addressLine1,
            addressLine2: subscriber.addressLine2,
            postalCode: subscriber.postalCode,
            city: subscriber.city,
            country: subscriber.country,
        },
        customerRef,
    };
}
