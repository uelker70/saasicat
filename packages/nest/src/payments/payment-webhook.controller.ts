import { Controller, HttpCode, Param, Post, Req, type RawBodyRequest } from '@nestjs/common';

import { SaaSiCatPublicRoute } from '../core/public-route.js';
import { PaymentCallbackService } from './payment-callback.service.js';

interface CallbackRequest {
    headers: Record<string, string | string[] | undefined>;
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
