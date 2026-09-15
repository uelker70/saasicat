import { Inject, Injectable } from '@nestjs/common';
import type { PaymentGateway, PaymentMethodType, PlanCatalog } from '@saasicat/core';

import { PLAN_CATALOG_TOKEN } from '../billing/plan-catalog.module.js';
import { paymentAccountProblems } from './payment-accounts.js';
import { PAYMENT_GATEWAYS_TOKEN } from './payments.tokens.js';

/** A configured account with the adapter bound for it. */
export interface PaymentGatewayAccount {
    name: string;
    provider: string;
    gateway: PaymentGateway;
}

/** The account new payment methods are taken at, with what its form offers. */
export interface NewPaymentMethodAccount extends PaymentGatewayAccount {
    methods: readonly PaymentMethodType[];
}

/**
 * The gateway accounts `config/saas.yaml#payments` names, each with the adapter
 * the application bound for it.
 *
 * Refuses to be built when the two disagree: a callback for an account nobody
 * bound would be answered with an error until the gateway gave up, and a
 * payment method taken at the wrong provider could not be charged.
 */
@Injectable()
export class PaymentGatewayRegistry {
    private readonly accounts = new Map<string, PaymentGatewayAccount>();
    private readonly takesNew: string | undefined;

    constructor(
        @Inject(PLAN_CATALOG_TOKEN) private readonly catalog: PlanCatalog,
        @Inject(PAYMENT_GATEWAYS_TOKEN) gateways: Readonly<Record<string, PaymentGateway>>,
    ) {
        const problems = paymentAccountProblems(catalog.payments, gateways);
        if (problems.length > 0) {
            throw new Error(`Payments cannot start:\n- ${problems.join('\n- ')}`);
        }
        for (const [name, account] of Object.entries(catalog.payments!.accounts)) {
            this.accounts.set(name, { name, provider: account.provider, gateway: gateways[name]! });
        }
        this.takesNew = catalog.payments!.newPaymentMethods;
    }

    /** The account a callback names, or `null` when none is configured under it. */
    account(name: string): PaymentGatewayAccount | null {
        return this.accounts.get(name) ?? null;
    }

    /** The accounts among `held` that are not configured, each once — references nothing can reach any more. */
    unconfigured(held: readonly string[]): string[] {
        return [...new Set(held)].filter((name) => !this.accounts.has(name));
    }

    /** The account a new payment method is taken at, or `null` when none takes new ones. */
    forNewPaymentMethods(): NewPaymentMethodAccount | null {
        if (this.takesNew === undefined) return null;
        const account = this.accounts.get(this.takesNew)!;
        return { ...account, methods: this.catalog.payments!.accounts[this.takesNew]!.methods! };
    }
}
