import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { PasswordHasher } from '@saasicat/types';

const KEY_LENGTH = 64;

/**
 * scrypt, so the SuperAdmin setup wizard works before you have decided.
 *
 * Deliberately not a default the platform ships: hashing is a decision with
 * consequences, and a framework that picks one for you picks it for everyone.
 * For production, argon2id with tuned parameters — this class is the seam.
 */
@Injectable()
export class __HASHER_CLASS__ implements PasswordHasher {
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
