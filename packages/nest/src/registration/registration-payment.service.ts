import {
    ConflictException,
    Inject,
    Injectable,
    Logger,
    type OnApplicationBootstrap,
    type OnModuleInit,
    Optional,
} from '@nestjs/common';
import type {
    ActivationOrchestrator,
    PendingRegistration,
    PendingRegistrationRepository,
    RegistrationAuditEvent,
    RegistrationAuditLogger,
    PaymentGatewayCallback,
    RegistrationBillingDetails,
    SubscriberPaymentMethodRepository,
} from '@saasicat/core';
import { PAYMENT_ERROR_CODES, PENDING_CHECKOUT_TTL_DAYS } from '@saasicat/core';

import { codedError } from '../errors/coded-error.js';
import {
    PaymentCallbackService,
    type PaymentEventContext,
    type PaymentEventEffect,
    type PaymentMethodConfirmedEvent,
    type PaymentMethodSetupFailedEvent,
} from '../payments/payment-callback.service.js';
import { PaymentGatewayRegistry } from '../payments/payment-gateway-registry.js';
import { SUBSCRIBER_PAYMENT_METHOD_REPOSITORY_TOKEN } from '../payments/payments.tokens.js';
import { refuseForeignReturnUrls } from '../payments/return-urls.js';
import { settleBillingDetails } from './billing-details.js';
import {
    ACTIVATION_ORCHESTRATOR_TOKEN,
    PENDING_REGISTRATION_REPOSITORY_TOKEN,
    REGISTRATION_AUDIT_LOGGER_TOKEN,
} from './registration.tokens.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a checkout started at `startedAt` expires, and the sign-up with it. */
export function checkoutExpiresAt(startedAt: Date): Date {
    return new Date(startedAt.getTime() + PENDING_CHECKOUT_TTL_DAYS * DAY_MS);
}

/**
 * How long a promo code slot is held while the gateway's form is being opened:
 * long enough for that request, short enough that the slot of a form that
 * never opened is free again soon, should giving it back have failed as well.
 */
const FORM_OPENING_MS = 10 * 60 * 1000;

/** Until when a slot is held while the form started at `startedAt` is being opened. */
export function whileTheFormOpens(startedAt: Date): Date {
    return new Date(startedAt.getTime() + FORM_OPENING_MS);
}

export interface RegistrationSetupUrls {
    successUrl: string;
    cancelUrl: string;
}

export interface RegistrationSetupStarted {
    updated: PendingRegistration;
    sessionRef: string;
    redirectUrl: string;
    /** The last moment a confirmation of this session can arrive, as the gateway reports it. */
    confirmableUntil: Date | null;
    /** A confirmation the gateway already holds, for `confirm`. */
    immediate: { account: string; callback: PaymentGatewayCallback } | null;
}

/**
 * Step 4 of a sign-up: the billing address and the payment method, and the
 * activation once the gateway confirmed it.
 *
 * The confirmation arrives as a gateway callback, claimed on a transaction the
 * platform opens. The application's `ActivationOrchestrator` writes the user,
 * the tenant, the subscriber and the subscription on that transaction, and the
 * payment method is recorded for the subscriber on it too — all of it, the
 * claim included, or none of it.
 */
@Injectable()
export class RegistrationPaymentService implements OnModuleInit, OnApplicationBootstrap {
    private readonly logger = new Logger(RegistrationPaymentService.name);

    constructor(
        @Inject(PENDING_REGISTRATION_REPOSITORY_TOKEN)
        private readonly repo: PendingRegistrationRepository,
        @Inject(ACTIVATION_ORCHESTRATOR_TOKEN)
        private readonly orchestrator: ActivationOrchestrator,
        @Inject(REGISTRATION_AUDIT_LOGGER_TOKEN)
        private readonly audit: RegistrationAuditLogger,
        // Named explicitly: a union with `null` reaches Nest as `Object`, which
        // resolves to nothing and would read as "not wired".
        @Optional()
        @Inject(PaymentGatewayRegistry)
        private readonly registry: PaymentGatewayRegistry | null = null,
        @Optional()
        @Inject(PaymentCallbackService)
        private readonly callbacks: PaymentCallbackService | null = null,
        @Optional()
        @Inject(SUBSCRIBER_PAYMENT_METHOD_REPOSITORY_TOKEN)
        private readonly methods: SubscriberPaymentMethodRepository | null = null,
    ) {}

    onModuleInit(): void {
        this.payments().callbacks.handleSetupsOf('registration', {
            confirmed: (event, context) => this.activate(event, context),
            failed: (event, context) => this.noteFailure(event, context),
        });
    }

    async onApplicationBootstrap(): Promise<void> {
        const held = await this.repo.findOpenCheckoutAccounts(new Date());
        const unconfigured = this.payments().registry.unconfigured(held);
        if (unconfigured.length === 0) return;
        throw new Error(
            `Sign-ups are waiting for a payment method at ${unconfigured.map((name) => `'${name}'`).join(', ')}, ` +
                'which config/saas.yaml#payments.accounts no longer names, so their confirmations ' +
                'cannot arrive. List each account again, with its gateway bound, until those sign-ups ' +
                'have completed or expired.',
        );
    }

    /**
     * Records the billing details and opens the gateway's form. Returns the
     * record as it now stands, where to send the person, and what `confirm`
     * hands on when the gateway confirmed on the spot. The checkout expires
     * `PENDING_CHECKOUT_TTL_DAYS` after `startedAt`.
     */
    async startSetup(
        pending: PendingRegistration,
        billingDetails: RegistrationBillingDetails,
        urls: RegistrationSetupUrls,
        startedAt: Date,
    ): Promise<RegistrationSetupStarted> {
        const { registry } = this.payments();
        refuseForeignReturnUrls(urls, registry.returnUrlOrigins());
        const billing = settleBillingDetails(pending, billingDetails);
        const account = registry.forNewPaymentMethods();
        if (!account) {
            throw new ConflictException(codedError(PAYMENT_ERROR_CODES.PAYMENTS_NOT_CONFIGURED));
        }
        const session = await account.gateway.startPaymentMethodSetup({
            subject: { kind: 'registration', pendingRegistrationId: pending.id },
            holder: {
                name: pending.tenantName,
                email: pending.email,
                address: {
                    addressLine1: billing.addressLine1,
                    addressLine2: billing.addressLine2,
                    postalCode: billing.postalCode,
                    city: billing.city,
                    country: billing.country,
                },
                customerRef:
                    pending.checkoutGatewayAccount === account.name
                        ? pending.gatewayCustomerRef
                        : null,
            },
            methods: account.methods,
            successUrl: urls.successUrl,
            cancelUrl: urls.cancelUrl,
        });
        const updated = await this.repo.update(pending.id, {
            ...billing,
            status: 'CHECKOUT_STARTED',
            currentStep: 4,
            checkoutSessionId: session.sessionRef,
            checkoutGatewayAccount: account.name,
            gatewayCustomerRef: session.customerRef,
            checkoutStartedAt: startedAt,
            expiresAt: checkoutExpiresAt(startedAt),
        });
        return {
            updated,
            sessionRef: session.sessionRef,
            redirectUrl: session.redirectUrl,
            confirmableUntil: session.confirmableUntil,
            immediate: session.immediateCallback
                ? { account: account.name, callback: session.immediateCallback }
                : null,
        };
    }

    /** Handles a confirmation the gateway gave when the setup started, like any callback. */
    async confirm(started: RegistrationSetupStarted): Promise<void> {
        if (!started.immediate) return;
        await this.payments().callbacks.handle(
            started.immediate.account,
            started.immediate.callback,
        );
    }

    private async activate(
        event: PaymentMethodConfirmedEvent,
        context: PaymentEventContext,
    ): Promise<PaymentEventEffect> {
        const pending = await this.pendingFor(event, context);
        if (!pending) return 'nothing-to-do';
        const { methods } = this.payments();
        const result = await this.orchestrator.activate(pending, { tx: context.tx });
        await methods.recordConfirmed(
            {
                ...event.paymentMethod,
                subscriberId: result.subscriberId,
                gatewayAccount: context.gatewayAccount,
                provider: context.provider,
                confirmedAt: event.occurredAt,
            },
            context.tx,
        );
        // On the same transaction: the sign-up is gone exactly when its tenant
        // exists. Any later confirmation — another event, another session opened
        // from a stale tab — finds nothing to activate a second time.
        await this.repo.delete(pending.id, context.tx);
        context.afterCommit(async () => {
            await this.record({
                eventType: 'PAYMENT_RECEIVED',
                pendingRegistrationId: pending.id,
                metadata: { eventId: event.eventId, sessionId: event.sessionRef },
            });
            await this.record({
                eventType: 'ACTIVATION_COMPLETED',
                pendingRegistrationId: pending.id,
                metadata: { ...result },
            });
            this.logger.log(
                `Activation succeeded: pending=${pending.id} → user=${result.userId} tenant=${result.tenantId} subscriber=${result.subscriberId} subscription=${result.subscriptionId}`,
            );
        });
        return 'took-effect';
    }

    private async noteFailure(
        event: PaymentMethodSetupFailedEvent,
        context: PaymentEventContext,
    ): Promise<void> {
        const pending = await this.pendingFor(event, context);
        context.afterCommit(() =>
            this.record({
                eventType: 'PAYMENT_FAILED',
                pendingRegistrationId: pending?.id ?? null,
                metadata: { eventId: event.eventId, sessionId: event.sessionRef },
            }),
        );
    }

    /**
     * The sign-up a setup event is about, found by the session its account
     * opened. `null` — and nothing done — when there is none waiting: it was
     * activated already, or expired and was cleaned up, or the event names a
     * different sign-up than the session belongs to.
     */
    private async pendingFor(
        event: PaymentMethodConfirmedEvent | PaymentMethodSetupFailedEvent,
        context: PaymentEventContext,
    ): Promise<PendingRegistration | null> {
        const pending = await this.repo.findByCheckoutSession(
            context.gatewayAccount,
            event.sessionRef,
        );
        const subject = event.subject;
        if (
            !pending ||
            pending.status !== 'CHECKOUT_STARTED' ||
            subject.kind !== 'registration' ||
            subject.pendingRegistrationId !== pending.id
        ) {
            this.logger.warn(
                `Payment event ${event.eventId} at '${context.gatewayAccount}' finds no sign-up waiting for session ${event.sessionRef}.`,
            );
            return null;
        }
        return pending;
    }

    private payments(): {
        registry: PaymentGatewayRegistry;
        callbacks: PaymentCallbackService;
        methods: SubscriberPaymentMethodRepository;
    } {
        if (!this.registry || !this.callbacks || !this.methods) {
            throw new Error(
                'RegistrationModule takes the payment method of a sign-up through the payments ' +
                    'module, and none is wired: configure `SaaSiCatModule.forRoot({ payments })`, ' +
                    'or `PaymentsModule.forRoot` beside RegistrationModule.',
            );
        }
        return { registry: this.registry, callbacks: this.callbacks, methods: this.methods };
    }

    private async record(event: RegistrationAuditEvent): Promise<void> {
        try {
            await this.audit.log(event);
        } catch (error) {
            // An audit write that fails does not undo an activation that committed.
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Audit log write failed (${event.eventType}): ${message}`);
        }
    }
}
