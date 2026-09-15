import {
    BadRequestException,
    Controller,
    HttpCode,
    Param,
    Post,
    Req,
    type RawBodyRequest,
} from '@nestjs/common';
import { PAYMENT_ERROR_CODES } from '@saasicat/core';

import { SaaSiCatPublicRoute } from '../core/public-route.js';
import { codedError } from '../errors/coded-error.js';
import { PaymentCallbackService } from './payment-callback.service.js';

interface CallbackRequest {
    headers: Record<string, string | string[] | undefined>;
}

/**
 * The bodies a web framework parses, and therefore keeps raw with `rawBody:
 * true`: JSON, which Stripe sends, and form fields, which Mollie sends.
 */
const PARSED_BODY_TYPES: readonly string[] = [
    'application/json',
    'application/x-www-form-urlencoded',
];

function carriesAParsedBody(contentType: string | string[] | undefined): boolean {
    const header = Array.isArray(contentType) ? contentType[0] : contentType;
    const mediaType = (header ?? '').split(';')[0]!.trim().toLowerCase();
    return PARSED_BODY_TYPES.includes(mediaType);
}

/**
 * `POST /webhooks/payment/:account` — where a gateway account sends its
 * callbacks, one route per account in `config/saas.yaml#payments.accounts`.
 *
 * Public, because the gateway has no session: what makes a callback genuine is
 * its signature over the exact bytes it sent, which the account's adapter
 * verifies before anything is read. That needs the body as it arrived, so the
 * application is created with `rawBody: true`.
 */
@Controller('webhooks/payment')
@SaaSiCatPublicRoute()
export class PaymentWebhookController {
    constructor(private readonly callbacks: PaymentCallbackService) {}

    @Post(':account')
    @HttpCode(200)
    async receive(
        @Param('account') account: string,
        @Req() request: RawBodyRequest<CallbackRequest>,
    ): Promise<{ received: true }> {
        if (!request.rawBody) {
            // Nothing a gateway sends: no framework keeps other bodies raw, so
            // there is nothing to verify, and the request is not the gateway's.
            if (!carriesAParsedBody(request.headers['content-type'])) {
                throw new BadRequestException(
                    codedError(PAYMENT_ERROR_CODES.PAYMENT_CALLBACK_REJECTED),
                );
            }
            // A setup error, answered with a server error so the gateway retries
            // once the application is started with the raw body kept.
            throw new Error(
                'A payment callback arrived without its raw body, and its signature cannot be ' +
                    'verified against a body parsed and serialised again. Create the application ' +
                    'with `NestFactory.create(AppModule, { rawBody: true })`.',
            );
        }
        await this.callbacks.handle(account, { body: request.rawBody, headers: request.headers });
        return { received: true };
    }
}
