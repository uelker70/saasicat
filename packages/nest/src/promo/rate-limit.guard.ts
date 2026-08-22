import {
    CanActivate,
    ExecutionContext,
    HttpException,
    HttpStatus,
    Injectable,
} from '@nestjs/common';
import { REGISTRATION_ERROR_CODES } from '@saasicat/core';
import { codedError } from '../errors/coded-error.js';

// Lightweight in-memory rate limiter for /onboarding/promo-code/preview.
// No external dependencies — deliberately kept simple. For scaling
// deploys (multi-instance) this should later be replaced by Redis or similar.
//
// Spec: max. 20 attempts per IP/minute, max. 50 per onboarding session.

const IP_WINDOW_MS = 60_000;
const IP_LIMIT = 20;
const SESSION_WINDOW_MS = 60 * 60_000;
const SESSION_LIMIT = 50;

interface Bucket {
    count: number;
    windowStart: number;
}

interface RequestLike {
    headers: Record<string, string | string[] | undefined>;
    ip?: string;
    user?: { id?: string };
}

// `retryAfterSeconds` is part of the documented `RATE_LIMITED` contract, so it
// is derived from the window of the limiter that actually tripped — the IP
// window is a minute, the session window an hour.
function rateLimited(windowMs: number): HttpException {
    return new HttpException(
        {
            ...codedError(REGISTRATION_ERROR_CODES.RATE_LIMITED, {
                retryAfterSeconds: Math.ceil(windowMs / 1000),
            }),
            retryAfterSeconds: Math.ceil(windowMs / 1000),
            valid: false,
            // Superseded by `code` — kept until all consumers read `code`.
            reason: 'RATE_LIMITED',
        },
        HttpStatus.TOO_MANY_REQUESTS,
    );
}

@Injectable()
export class PromoCodeRateLimitGuard implements CanActivate {
    private ipBuckets = new Map<string, Bucket>();
    private sessionBuckets = new Map<string, Bucket>();

    canActivate(context: ExecutionContext): boolean {
        const req = context.switchToHttp().getRequest<RequestLike>();
        const ipKey = ipFingerprint(req);
        const sessionKey = req.user?.id ?? null;

        if (this.exceeded(this.ipBuckets, ipKey, IP_WINDOW_MS, IP_LIMIT)) {
            throw rateLimited(IP_WINDOW_MS);
        }
        if (
            sessionKey &&
            this.exceeded(this.sessionBuckets, sessionKey, SESSION_WINDOW_MS, SESSION_LIMIT)
        ) {
            throw rateLimited(SESSION_WINDOW_MS);
        }
        return true;
    }

    private exceeded(
        map: Map<string, Bucket>,
        key: string,
        windowMs: number,
        limit: number,
    ): boolean {
        const now = Date.now();
        const b = map.get(key);
        if (!b || now - b.windowStart > windowMs) {
            map.set(key, { count: 1, windowStart: now });
            return false;
        }
        b.count += 1;
        return b.count > limit;
    }
}

export function ipFingerprint(req: RequestLike): string {
    const fwd = req.headers['x-forwarded-for'];
    const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0]?.trim();
    return first || req.ip || 'unknown';
}

export function hashIp(req: RequestLike): string {
    // Not a cryptographic hash, only to guard against accidental IP logging.
    // Privacy-compliant for internal audit logs.
    const fp = ipFingerprint(req);
    let h = 0;
    for (let i = 0; i < fp.length; i++) {
        h = (h * 31 + fp.charCodeAt(i)) | 0;
    }
    return `ip${(h >>> 0).toString(16)}`;
}
