// LimitExceededFilter — translates the domain-neutral `LimitExceededError`
// (entitlement/limit-exceeded-error.ts) into HTTP 402 (Payment Required).
//
// Registered by consumers as an `APP_FILTER` provider so that all routes
// throwing through `EntitlementService.enforceLimit(...)` or
// `@EnforceQuota` return the same HTTP 402 response:
//
// ```ts
// providers: [{ provide: APP_FILTER, useClass: LimitExceededFilter }]
// ```
//
// The filter is a catch-all that matches by the realm-safe
// `isLimitExceededError` guard, NOT by `@Catch(LimitExceededError)`: the
// tsup multi-entry build duplicates the error class per sub-bundle, so an
// instanceof-based filter from `billing/` never matches a throw from
// `platform/`. Everything that is not a limit error falls through to
// Nest's default handling (`BaseExceptionFilter`).

import { type ArgumentsHost, Catch, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { isLimitExceededError } from '../entitlement/limit-exceeded-error.js';

interface ResponseLike {
    status: (code: number) => { send: (body: unknown) => void };
}

interface RequestLike {
    url?: string;
    method?: string;
}

@Catch()
export class LimitExceededFilter extends BaseExceptionFilter {
    private readonly logger = new Logger(LimitExceededFilter.name);

    override catch(exception: unknown, host: ArgumentsHost): void {
        if (!isLimitExceededError(exception)) {
            super.catch(exception, host);
            return;
        }

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
