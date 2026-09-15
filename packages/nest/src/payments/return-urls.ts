import { BadRequestException } from '@nestjs/common';
import { PAYMENT_ERROR_CODES } from '@saasicat/core';

import { codedError } from '../errors/coded-error.js';

/** Where a gateway's form sends a person, once they are done with it or leave it. */
export interface PaymentReturnUrls {
    successUrl: string;
    cancelUrl: string;
}

/**
 * Refuses a success or cancel URL at an origin `config/saas.yaml#payments.returnUrlOrigins`
 * does not name, before the gateway is asked.
 *
 * The URLs arrive from a browser, and the gateway redirects to them from the
 * operator's own payment form — a page a stranger could otherwise have forward
 * somebody to a site of their choosing. Compared as parsed origins rather than
 * as text: a prefix match would let `https://app.example.com.evil.test` through.
 */
export function refuseForeignReturnUrls(
    urls: PaymentReturnUrls,
    allowedOrigins: readonly string[],
): void {
    const allowed = new Set(allowedOrigins.map(originOf));
    for (const field of ['successUrl', 'cancelUrl'] as const) {
        const origin = originOf(urls[field]);
        if (origin === null || !allowed.has(origin)) {
            throw new BadRequestException(
                codedError(PAYMENT_ERROR_CODES.PAYMENT_RETURN_URL_NOT_ALLOWED, { field }),
            );
        }
    }
}

function originOf(url: string): string | null {
    try {
        return new URL(url).origin;
    } catch {
        // Not a URL at all is no origin, and no origin is allowed.
        return null;
    }
}
