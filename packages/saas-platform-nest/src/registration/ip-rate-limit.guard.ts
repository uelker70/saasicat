import {
    type CanActivate,
    type ExecutionContext,
    HttpException,
    HttpStatus,
    Injectable,
} from '@nestjs/common';

/**
 * Konfigurierbarer In-Memory-Rate-Limiter (per IP, Sliding-Window).
 *
 * Bewusst ohne externe Dependencies (`@nestjs/throttler`, Redis) — fuer die
 * Auth-Routen ist ein Single-Instance-Memory-Bucket ausreichend. Fuer skalierte
 * Multi-Instance-Deploys sollte dieser Guard durch einen Redis-basierten
 * Counter ersetzt werden (gleicher CanActivate-Vertrag).
 *
 * Pattern entspricht `PromoCodeRateLimitGuard`, aber generisch: Subklassen
 * uebergeben Window + Limit + Bucket-Map an den Base-Constructor und schaffen
 * so eigene Limits pro Route (Login / Register / OTP-Resend / Password-Reset).
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
            /** Sliding-Window in ms (z. B. 15 * 60_000 fuer 15 min). */
            windowMs: number;
            /** Max Requests pro Window pro IP. */
            limit: number;
            /** Telemetrie-Name (kommt in Reason + Logs). */
            name: string;
        },
    ) {}

    canActivate(context: ExecutionContext): boolean {
        if (
            process.env.SAAS_PLATFORM_SKIP_RATE_LIMITS === '1' &&
            process.env.NODE_ENV !== 'production'
        ) {
            // Erlaubter Bypass für CI-Smoke-Tests (Plattform-weit; Konsumenten
            // dürfen das nicht einzeln umkonfigurieren). Analog MfaGuard.
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
 * Liest die Client-IP aus `X-Forwarded-For` (erste Adresse) oder faellt
 * auf `req.ip` zurueck. Fuer Fastify mit `trustProxy: true` ist `req.ip`
 * bereits die echte Client-IP — XFF-Lesung bleibt aber als zusaetzliche
 * Verteidigung gegen Proxies, die nur den Header setzen.
 *
 * Bewusst nicht als Top-Level-Export reexportiert — eine identische Helper-
 * Variante lebt in `promo/rate-limit.guard.ts`. Subklassen brauchen den
 * Helper nicht; der Base-Guard kapselt die IP-Logik intern.
 */
function ipFingerprint(req: {
    headers: Record<string, string | string[] | undefined>;
    ip?: string;
}): string {
    const fwd = req.headers['x-forwarded-for'];
    const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0]?.trim();
    return first || req.ip || 'unknown';
}
