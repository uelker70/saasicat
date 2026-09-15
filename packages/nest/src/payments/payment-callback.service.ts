import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
    PaymentEventLog,
    PaymentGatewayCallback,
    PaymentGatewayEvent,
    PaymentMethodSetupSubject,
    TransactionContext,
    TransactionRunner,
} from '@saasicat/core';
import { PAYMENT_ERROR_CODES, isPaymentCallbackRejectedError } from '@saasicat/core';

import { codedError } from '../errors/coded-error.js';
import { PaymentGatewayRegistry } from './payment-gateway-registry.js';
import { PAYMENT_EVENT_LOG_TOKEN, PAYMENT_TRANSACTION_RUNNER_TOKEN } from './payments.tokens.js';

type SetupEvent = Exclude<PaymentGatewayEvent, { kind: 'unhandled' }>;

/** A confirmation of a payment method, as its handler receives it. */
export type PaymentMethodConfirmedEvent = Extract<
    PaymentGatewayEvent,
    { kind: 'payment-method-confirmed' }
>;

/** A setup the gateway reports as failed. */
export type PaymentMethodSetupFailedEvent = Extract<
    PaymentGatewayEvent,
    { kind: 'payment-method-setup-failed' }
>;

/** Where an event is handled: on the transaction its claim is written on. */
export interface PaymentEventContext {
    tx: TransactionContext;
    gatewayAccount: string;
    provider: string;
    /**
     * Runs `step` once the transaction committed — for what must not happen
     * when it rolls back, such as a notice or deleting a record kept outside
     * it. A step that fails is logged; the event stays handled.
     */
    afterCommit(step: () => Promise<void>): void;
}

/** What a sign-up or a subscriber does with the events about its setup. */
export interface PaymentSetupEventHandler {
    confirmed(event: PaymentMethodConfirmedEvent, context: PaymentEventContext): Promise<void>;
    failed(event: PaymentMethodSetupFailedEvent, context: PaymentEventContext): Promise<void>;
}

/** How a callback ended. A duplicate and an event nobody acts on are both answered as received. */
export type PaymentCallbackOutcome = 'handled' | 'duplicate' | 'unhandled';

/**
 * Takes a gateway callback from the wire to its effect.
 *
 * The adapter verifies it first, so nothing unverified is read. The event is
 * then claimed and handled on ONE transaction: a handler that fails rolls the
 * claim back with its own writes, and the gateway's retry is handled instead of
 * being discarded as a duplicate; a handler that succeeded leaves a claim that
 * turns every later delivery into a duplicate.
 */
@Injectable()
export class PaymentCallbackService {
    private readonly logger = new Logger(PaymentCallbackService.name);
    private readonly handlers = new Map<
        PaymentMethodSetupSubject['kind'],
        PaymentSetupEventHandler
    >();

    constructor(
        private readonly registry: PaymentGatewayRegistry,
        @Inject(PAYMENT_EVENT_LOG_TOKEN) private readonly log: PaymentEventLog,
        @Inject(PAYMENT_TRANSACTION_RUNNER_TOKEN) private readonly transactions: TransactionRunner,
    ) {}

    /**
     * Names who handles the setups of one kind of subject. Each kind has one
     * handler; a second is a wiring error, not a replacement.
     */
    handleSetupsOf(
        kind: PaymentMethodSetupSubject['kind'],
        handler: PaymentSetupEventHandler,
    ): void {
        if (this.handlers.has(kind)) {
            throw new Error(
                `A handler for payment method setups of '${kind}' is registered twice.`,
            );
        }
        this.handlers.set(kind, handler);
    }

    async handle(
        account: string,
        callback: PaymentGatewayCallback,
    ): Promise<PaymentCallbackOutcome> {
        const entry = this.registry.account(account);
        if (!entry) {
            throw new NotFoundException(
                codedError(PAYMENT_ERROR_CODES.PAYMENT_GATEWAY_ACCOUNT_UNKNOWN, { account }),
            );
        }
        const event = await this.read(
            entry.gateway.readCallback.bind(entry.gateway),
            callback,
            account,
        );
        if (event.kind === 'unhandled') {
            this.logger.debug(
                `Payment event ${event.eventId} (${event.type}) at '${account}' needs no action.`,
            );
            return 'unhandled';
        }
        const handler = this.handlerFor(event);
        const afterCommit: Array<() => Promise<void>> = [];

        const claimed = await this.transactions.run(async (tx) => {
            const fresh = await this.log.claim(
                {
                    gatewayAccount: account,
                    eventId: event.eventId,
                    provider: entry.provider,
                    sessionId: event.sessionRef,
                    kind: event.kind,
                    summary: summaryOf(event),
                },
                tx,
            );
            if (!fresh) return false;
            const context: PaymentEventContext = {
                tx,
                gatewayAccount: account,
                provider: entry.provider,
                afterCommit: (step) => afterCommit.push(step),
            };
            if (event.kind === 'payment-method-confirmed') {
                await handler.confirmed(event, context);
            } else {
                await handler.failed(event, context);
            }
            return true;
        });
        if (!claimed) {
            this.logger.log(
                `Payment event ${event.eventId} at '${account}' was handled before; duplicate ignored.`,
            );
            return 'duplicate';
        }
        for (const step of afterCommit) {
            try {
                await step();
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                this.logger.error(
                    `Payment event ${event.eventId} at '${account}' is handled, and a step after it failed: ${reason}`,
                );
            }
        }
        return 'handled';
    }

    private async read(
        readCallback: (callback: PaymentGatewayCallback) => Promise<PaymentGatewayEvent>,
        callback: PaymentGatewayCallback,
        account: string,
    ): Promise<PaymentGatewayEvent> {
        try {
            return await readCallback(callback);
        } catch (error) {
            if (!isPaymentCallbackRejectedError(error)) throw error;
            this.logger.warn(`A payment callback for '${account}' was rejected: ${error.message}`);
            throw new BadRequestException(
                codedError(PAYMENT_ERROR_CODES.PAYMENT_CALLBACK_REJECTED),
            );
        }
    }

    private handlerFor(event: SetupEvent): PaymentSetupEventHandler {
        const handler = this.handlers.get(event.subject.kind);
        if (handler) return handler;
        // Answered with an error so the gateway retries: the session was opened
        // by something that handles it, and a boot that has not wired that yet
        // should not turn the confirmation into a lost one.
        throw new Error(
            `A payment method setup for a ${event.subject.kind} was reported, and nothing handles ` +
                (event.subject.kind === 'registration'
                    ? 'sign-ups: wire RegistrationModule.'
                    : 'subscriber payment methods.'),
        );
    }
}

/** What an event said, for the log: its kind, whom it is about, which payment method — never a person. */
function summaryOf(event: SetupEvent): Record<string, unknown> {
    const subject =
        event.subject.kind === 'registration'
            ? { registration: event.subject.pendingRegistrationId }
            : { subscriber: event.subject.subscriberId };
    if (event.kind === 'payment-method-setup-failed') return { ...subject };
    const { type, brand, last4 } = event.paymentMethod;
    return { ...subject, type, brand, last4 };
}
