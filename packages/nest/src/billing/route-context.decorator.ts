import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/**
 * The execution context of the request a handler serves, as its guards were
 * handed it — for a handler that asks a guard's decision without being behind
 * that guard, such as `GET billing/access` asking the billing permission.
 */
export const RouteContext = createParamDecorator(
    (_data: unknown, context: ExecutionContext): ExecutionContext => context,
);
