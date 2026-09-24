import { BadGatewayException, type Logger } from '@nestjs/common';
import type { PaymentMethodSetupSession, StartPaymentMethodSetupInput } from '@saasicat/core';
import { PAYMENT_ERROR_CODES } from '@saasicat/core';

import { codedError } from '../errors/coded-error.js';
import type { PaymentGatewayAccount } from './payment-gateway-registry.js';

/** The fields of a thrown error the log keeps, beside its kind. */
const LOGGED_FIELDS = ['code', 'statusCode', 'requestId'] as const;

/**
 * Opens the account's form for a payment method, and answers a failure of the
 * gateway as `gatewayFailure` does.
 */
export async function openGatewayForm(
    account: PaymentGatewayAccount,
    input: StartPaymentMethodSetupInput,
    logger: Logger,
): Promise<PaymentMethodSetupSession> {
    try {
        return await account.gateway.startPaymentMethodSetup(input);
    } catch (error) {
        throw gatewayFailure(account.name, 'did not open its form', error, logger);
    }
}

/**
 * Logs what a gateway threw and returns the answer for it: `PAYMENT_GATEWAY_FAILED`
 * and 502 — SaaSiCat's own refusal rather than the gateway's answer.
 *
 * What a gateway throws is written for the operator, not for whoever made the
 * request. Passed on, its status would become the answer's own — a provider
 * that refuses the account's keys answers 401 — and its wording describes the
 * installation's setup. So it stays on the server, where the operator can find
 * the request at the provider by its id.
 *
 * Its message and stack go in only where no status says the provider's server
 * wrote the error: then it is the adapter's own, and the stack says where it
 * broke. With a status both stay out, since the stack's first line repeats the
 * message.
 */
export function gatewayFailure(
    account: string,
    what: string,
    error: unknown,
    logger: Logger,
): BadGatewayException {
    const line = `The payment gateway of account '${account}' ${what}: ${describeFailure(error)}`;
    if (isAdaptersOwn(error)) logger.error(line, error.stack);
    else logger.error(line);
    return new BadGatewayException(codedError(PAYMENT_ERROR_CODES.PAYMENT_GATEWAY_FAILED));
}

/** Whether no status marks the error as written by the provider's server. */
function isAdaptersOwn(error: unknown): error is Error {
    return error instanceof Error && (error as { statusCode?: unknown }).statusCode === undefined;
}

/** The kind of a gateway's failure, with the fields that identify it. */
function describeFailure(error: unknown): string {
    if (!(error instanceof Error)) return `a thrown ${typeof error}`;
    const fields = error as Error & Record<string, unknown>;
    const parts = [typeof fields.type === 'string' ? fields.type : error.name];
    for (const key of LOGGED_FIELDS) {
        const value = fields[key];
        if (typeof value === 'string' || typeof value === 'number') parts.push(`${key}=${value}`);
    }
    if (isAdaptersOwn(error)) parts.push(`message=${JSON.stringify(error.message)}`);
    return parts.join(' ');
}
