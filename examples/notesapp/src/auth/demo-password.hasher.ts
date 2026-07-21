import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { PasswordHasher } from '@saasicat/types';

const KEY_LENGTH = 64;

/**
 * scrypt-based `PasswordHasher` so the SuperAdmin setup wizard works out of
 * the box. Demo-grade: production apps should use argon2id with tuned
 * parameters.
 */
@Injectable()
export class DemoPasswordHasher implements PasswordHasher {
    async hash(plain: string): Promise<string> {
        const salt = randomBytes(16).toString('hex');
        const derived = scryptSync(plain, salt, KEY_LENGTH).toString('hex');
        return `scrypt:${salt}:${derived}`;
    }

    async verify(hash: string, plain: string): Promise<boolean> {
        const [scheme, salt, derived] = hash.split(':');
        if (scheme !== 'scrypt' || !salt || !derived) return false;
        const candidate = scryptSync(plain, salt, KEY_LENGTH);
        return timingSafeEqual(candidate, Buffer.from(derived, 'hex'));
    }
}
