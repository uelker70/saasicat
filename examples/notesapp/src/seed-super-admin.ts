import { randomBytes, scryptSync } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { SecretSealer } from '@saasicat/core';

/**
 * The demo SuperAdmin. One id for every row that names it: DemoAuthGuard says
 * the admin app's caller is `demo-user-admin` (`x-demo-tenant: admin`), the
 * platform looks the second factor up under the caller's id, and the command
 * line finds the operator by e-mail and checks the second factor under the id
 * of the row it found. A row under any other id has no second factor.
 */
export const DEMO_SUPER_ADMIN = {
    id: 'demo-user-admin',
    email: 'admin@notesapp.example',
    password: 'demo',
} as const;

/** RFC 4648 base32, the form an authenticator app takes a TOTP secret in. */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Twenty random bytes, the secret length RFC 4226 recommends. */
const TOTP_SECRET_BYTES = 20;

/** The two tables the SuperAdmin is kept in. */
export type SuperAdminTables = Pick<PrismaClient, 'superAdminUser' | 'superAdminMfa'>;

/**
 * Seeds the demo SuperAdmin and its second factor, and returns the otpauth URI
 * when this run set the factor up, `null` when a working one was there.
 *
 * DEMO ONLY. The secret is random per database and sealed with the
 * installation's sealer, as `admin mfa-setup` stores it — the platform opens
 * every secret before it checks a code, and refuses one it cannot open. A
 * secret this sealer opens is kept on a re-seed, so an authenticator set up
 * once keeps working; one it cannot open — sealed under another key, or never
 * sealed — checks no code, so it is replaced.
 */
export async function seedSuperAdmin(
    prisma: SuperAdminTables,
    sealer: SecretSealer,
): Promise<string | null> {
    await prisma.superAdminUser.upsert({
        where: { email: DEMO_SUPER_ADMIN.email },
        create: {
            id: DEMO_SUPER_ADMIN.id,
            email: DEMO_SUPER_ADMIN.email,
            passwordHash: hashPassword(DEMO_SUPER_ADMIN.password),
            firstName: 'Demo',
            lastName: 'Admin',
        },
        // Keep an existing password — re-seeding should not invalidate a
        // password the developer changed through the UI. The id is set on
        // both paths, so a row created under another id is brought in line.
        update: { id: DEMO_SUPER_ADMIN.id, isActive: true, deletedAt: null },
    });

    const existing = await prisma.superAdminMfa.findUnique({
        where: { userId: DEMO_SUPER_ADMIN.id },
    });
    if (existing?.secret && (await opens(sealer, existing.secret))) return null;

    const secret = base32(randomBytes(TOTP_SECRET_BYTES));
    const sealed = await sealer.seal(secret);
    await prisma.superAdminMfa.upsert({
        where: { userId: DEMO_SUPER_ADMIN.id },
        create: { userId: DEMO_SUPER_ADMIN.id, secret: sealed, enabledAt: new Date() },
        update: { secret: sealed, enabledAt: new Date() },
    });
    const label = encodeURIComponent(`NotesApp:${DEMO_SUPER_ADMIN.email}`);
    return `otpauth://totp/${label}?secret=${secret}&issuer=NotesApp`;
}

/** Whether `sealer` opens `stored`; a refusal is the answer, not an error. */
async function opens(sealer: SecretSealer, stored: string): Promise<boolean> {
    return sealer.open(stored).then(
        () => true,
        () => false,
    );
}

/** Matches DemoPasswordHasher — scrypt with a 64-byte key. */
function hashPassword(plain: string): string {
    const salt = randomBytes(16).toString('hex');
    return `scrypt:${salt}:${scryptSync(plain, salt, 64).toString('hex')}`;
}

function base32(bytes: Uint8Array): string {
    let buffer = 0;
    let bits = 0;
    let out = '';
    for (const byte of bytes) {
        buffer = (buffer << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            out += BASE32_ALPHABET[(buffer >> bits) & 31];
        }
        buffer &= (1 << bits) - 1;
    }
    if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
    return out;
}
