// Pure helper functions for the Registration module.
// Deliberately free of DI / NestJS — directly importable for unit tests.

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

/** 6-digit numeric OTP code, uniformly distributed from 100000..999999. */
export function generateOtpCode(): string {
    return String(randomInt(100000, 1000000));
}

/** SHA-256 hash of an OTP code (hex). OTPs are never stored in plaintext. */
export function hashOtpCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
}

/**
 * Constant-time comparison of an OTP hash against a plaintext code.
 * Prevents timing attacks against short numeric codes.
 */
export function verifyOtpCode(expectedHash: string, code: string): boolean {
    const actual = hashOtpCode(code);
    if (actual.length !== expectedHash.length) {
        return false;
    }
    try {
        return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expectedHash, 'hex'));
    } catch {
        return false;
    }
}

/**
 * Club/Tenant slug from a plaintext name.
 * Lowercase, ASCII, only a-z0-9 and hyphen.
 * Whitespace and special characters are collapsed to '-'.
 * The result is never empty (fallback `'verein'`).
 */
export function slugify(name: string): string {
    const transliterated = name
        .toLowerCase()
        .replace(/ß/g, 'ss')
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '');
    const slug = transliterated.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return slug || 'verein';
}
