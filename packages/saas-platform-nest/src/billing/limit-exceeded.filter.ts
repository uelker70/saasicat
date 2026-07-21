// LimitExceededFilter — translates the domain-neutral `LimitExceededError`
// (entitlement/limit-exceeded-error.ts) into HTTP 402 (Payment Required).
//
// Registered by consumers as an `APP_FILTER` so that all routes calling
// `EntitlementService.enforceLimit(...)` return the same HTTP 402 response.

import {
    type ArgumentsHost,
    Catch,
    type ExceptionFilter,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { LimitExceededError } from '../entitlement/limit-exceeded-error.js';

interface ResponseLike {
    status: (code: number) => { send: (body: unknown) => void };
}

interface RequestLike {
    url?: string;
    method?: string;
}

@Catch(LimitExceededError)
export class LimitExceededFilter implements ExceptionFilter {
    private readonly logger = new Logger(LimitExceededFilter.name);

    catch(exception: LimitExceededError, host: ArgumentsHost): void {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<ResponseLike>();
        const request = ctx.getRequest<RequestLike>();

        this.logger.warn(
            `Limit ${exception.dimension} überschritten: ${exception.used}/${exception.max} bei ${request.method ?? '?'} ${request.url ?? ''}`,
        );

        response.status(HttpStatus.PAYMENT_REQUIRED).send({
            statusCode: HttpStatus.PAYMENT_REQUIRED,
            error: 'PaymentRequired',
            reason: 'LIMIT_EXCEEDED',
            dimension: exception.dimension,
            used: exception.used,
            max: exception.max,
            message: exception.message,
        });
    }
}
