import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { SubscriberPaymentMethodRepository } from '@saasicat/core';

import { PaymentGatewayRegistry } from './payment-gateway-registry.js';
import { SUBSCRIBER_PAYMENT_METHOD_REPOSITORY_TOKEN } from './payments.tokens.js';

/**
 * Refuses the start when a payment method in use belongs to a gateway account
 * the configuration no longer names.
 *
 * Such a reference is meaningful only to its own account: without the account
 * configured, its callbacks go unanswered and nothing can be collected with it.
 * An account stays listed until its subscribers have given a payment method at
 * another one.
 */
@Injectable()
export class StoredPaymentReferencesCheck implements OnApplicationBootstrap {
    constructor(
        private readonly registry: PaymentGatewayRegistry,
        @Inject(SUBSCRIBER_PAYMENT_METHOD_REPOSITORY_TOKEN)
        private readonly methods: SubscriberPaymentMethodRepository,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        const unconfigured = this.registry.unconfigured(await this.methods.accountsInUse());
        if (unconfigured.length === 0) return;
        throw new Error(
            `Payment methods in use are held at ${unconfigured.map((name) => `'${name}'`).join(', ')}, ` +
                'which config/saas.yaml#payments.accounts no longer names. List each account again, ' +
                'with its gateway bound, until its subscribers have a payment method at another one.',
        );
    }
}
