// Whether the gateway adapters an application binds are the accounts
// `config/saas.yaml#payments` names. Pure, so the registry can refuse a boot
// with every mismatch at once and a test can read the sentences.

import type { PaymentGateway, PlanCatalogPayments } from '@saasicat/core';

/** Every way the bound gateways and the file disagree, as sentences. Empty when they agree. */
export function paymentAccountProblems(
    payments: PlanCatalogPayments | undefined,
    gateways: Readonly<Record<string, PaymentGateway>>,
): string[] {
    const bound = Object.keys(gateways);
    if (!payments) {
        return [
            `Payment gateways are bound for ${bound.join(', ') || 'no account'}, but ` +
                'config/saas.yaml has no `payments` block naming the accounts.',
        ];
    }
    const named = Object.keys(payments.accounts);
    const problems: string[] = [];
    for (const account of named) {
        const gateway = gateways[account];
        if (!gateway) {
            problems.push(
                `config/saas.yaml names the payment account '${account}', and no gateway is bound ` +
                    'for it: bind its adapter, or remove the account once it holds nothing.',
            );
            continue;
        }
        const provider = payments.accounts[account]!.provider;
        if (gateway.provider !== provider) {
            problems.push(
                `The payment account '${account}' is at '${provider}' in config/saas.yaml, ` +
                    `but the gateway bound for it is '${gateway.provider}'.`,
            );
        }
    }
    for (const account of bound) {
        if (!named.includes(account)) {
            problems.push(
                `A gateway is bound for the payment account '${account}', which ` +
                    'config/saas.yaml#payments.accounts does not name.',
            );
        }
    }
    const takesNew = payments.newPaymentMethods;
    if (takesNew !== undefined) {
        const account = payments.accounts[takesNew];
        if (!account) {
            problems.push(
                `config/saas.yaml#payments.newPaymentMethods names '${takesNew}', which is not ` +
                    'one of its accounts.',
            );
        } else if (!account.methods?.length) {
            problems.push(
                `The payment account '${takesNew}' takes new payment methods, and lists no ` +
                    '`methods` to offer.',
            );
        }
    }
    return problems;
}
