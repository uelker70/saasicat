// Pure Helper-Funktionen fuer das Registration-Module.
// Bewusst frei von DI / NestJS — direkt importierbar fuer Unit-Tests.

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

/** 6-stelliger numerischer OTP-Code, gleichverteilt aus 100000..999999. */
export function generateOtpCode(): string {
    return String(randomInt(100000, 1000000));
}

/** SHA-256-Hash eines OTP-Codes (Hex). OTPs werden nie im Klartext gespeichert. */
export function hashOtpCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
}

/**
 * Konstantzeit-Vergleich von OTP-Hash und Klartext-Code.
 * Verhindert Timing-Angriffe gegen kurze numerische Codes.
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
 * Vereins-/Tenant-Slug aus einem Klartext-Namen.
 * Lowercase, ASCII, nur a-z0-9 und Bindestrich.
 * Leerzeichen und Sonderzeichen werden zu '-' kollabiert.
 * Ergebnis ist niemals leer (Fallback `'verein'`).
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
