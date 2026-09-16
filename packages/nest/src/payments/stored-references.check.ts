import { Inject, Injectable, type OnApplicationBootstrap, Optional } from '@nestjs/common';
import type { RlsBypassPort, SubscriberPaymentMethodRepository } from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
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
 *
 * The read is platform-wide and there is no tenant at boot, so it goes through
 * the RLS bypass. Without it, an installation whose payment-method table carries
 * a policy answers with nothing — and this check exists to refuse, so blindness
 * here is not a message that reads oddly, it is a start that goes ahead with
 * payment methods nobody can collect on.
 */
@Injectable()
export class StoredPaymentReferencesCheck implements OnApplicationBootstrap {
    constructor(
        private readonly registry: PaymentGatewayRegistry,
        @Inject(SUBSCRIBER_PAYMENT_METHOD_REPOSITORY_TOKEN)
        private readonly methods: SubscriberPaymentMethodRepository,
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        const read = () => this.methods.accountsInUse();
        const inUse = await (this.rlsBypass ? this.rlsBypass.runWithBypass(read) : read());
        const unconfigured = this.registry.unconfigured(inUse);
        if (unconfigured.length === 0) return;
        throw new Error(
            `Payment methods in use are held at ${unconfigured.map((name) => `'${name}'`).join(', ')}, ` +
                'which config/saas.yaml#payments.accounts no longer names. List each account again, ' +
                'with its gateway bound, until its subscribers have a payment method at another one.',
        );
    }
}
