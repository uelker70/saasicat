import {
    type CanActivate,
    type ExecutionContext,
    HttpException,
    HttpStatus,
    Injectable,
} from '@nestjs/common';

/**
 * Configurable in-memory rate limiter (per IP, sliding window).
 *
 * Deliberately without external dependencies (`@nestjs/throttler`, Redis) —
 * for the auth routes a single-instance memory bucket is sufficient. For
 * scaled multi-instance deploys this guard should be replaced by a
 * Redis-based counter (same CanActivate contract).
 *
 * The pattern matches `PromoCodeRateLimitGuard`, but is generic: subclasses
 * pass window + limit + bucket map to the base constructor and thus create
 * their own limits per route (login / register / OTP resend / password reset).
 *
 * @example
 * ```ts
 * @Injectable()
 * export class LoginRateLimitGuard extends BaseIpRateLimitGuard {
 *     constructor() {
 *         super({ windowMs: 15 * 60_000, limit: 10, name: 'login' });
 *     }
 * }
 * ```
 */
@Injectable()
export abstract class BaseIpRateLimitGuard implements CanActivate {
    private readonly buckets = new Map<string, { count: number; windowStart: number }>();

    constructor(
        protected readonly options: {
            /** Sliding window in ms (e.g. 15 * 60_000 for 15 min). */
            windowMs: number;
            /** Max requests per window per IP. */
            limit: number;
            /** Telemetry name (appears in reason + logs). */
            name: string;
        },
    ) {}

    canActivate(context: ExecutionContext): boolean {
        if (
            process.env.SAAS_PLATFORM_SKIP_RATE_LIMITS === '1' &&
            process.env.NODE_ENV !== 'production'
        ) {
            // Allowed bypass for CI smoke tests (platform-wide; consumers
            // must not reconfigure this individually). Analogous to MfaGuard.
            return true;
        }
        const req = context.switchToHttp().getRequest<{
            headers: Record<string, string | string[] | undefined>;
            ip?: string;
        }>();
        const key = ipFingerprint(req);
        if (this.exceeded(key)) {
            throw new HttpException(
                {
                    code: 'RATE_LIMITED',
                    reason: this.options.name,
                    retryAfterSeconds: Math.ceil(this.options.windowMs / 1000),
                },
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }
        return true;
    }

    private exceeded(key: string): boolean {
        const now = Date.now();
        const bucket = this.buckets.get(key);
        if (!bucket || now - bucket.windowStart > this.options.windowMs) {
            this.buckets.set(key, { count: 1, windowStart: now });
            return false;
        }
        bucket.count += 1;
        return bucket.count > this.options.limit;
    }
}

/**
 * Reads the client IP from `X-Forwarded-For` (first address) or falls back
 * to `req.ip`. For Fastify with `trustProxy: true`, `req.ip` is already the
 * real client IP — but the XFF read remains as an additional defense against
 * proxies that only set the header.
 *
 * Deliberately not re-exported as a top-level export — an identical helper
 * variant lives in `promo/rate-limit.guard.ts`. Subclasses do not need the
 * helper; the base guard encapsulates the IP logic internally.
 */
function ipFingerprint(req: {
    headers: Record<string, string | string[] | undefined>;
    ip?: string;
}): string {
    const fwd = req.headers['x-forwarded-for'];
    const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0]?.trim();
    return first || req.ip || 'unknown';
}
