// The two sealers an installation chooses between for its SuperAdmins' TOTP
// secrets: AES-256-GCM with a key of its own, or plain text on purpose.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { SecretSealer } from '@saasicat/core';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/**
 * The format a sealed value carries its version in, so a second key or a
 * second algorithm can be told from the first when it comes.
 */
const FORMAT = 'v1';

/** A value `open` does not recognise as one it sealed. */
export class UnreadableSealedSecretError extends Error {
    constructor(why: string) {
        super(`The stored secret cannot be opened: ${why}.`);
        this.name = 'UnreadableSealedSecretError';
    }
}

const GENERATE_A_KEY =
    "Generate one with `node -e \"console.log(require('node:crypto').randomBytes(32).toString('base64'))\"`.";

/**
 * Seals with AES-256-GCM under `key`, 32 bytes given as base64 — from the
 * installation's configuration, never from the database the sealed values
 * are stored in. A missing key, or one of any other length, is refused when
 * the sealer is made, which is at boot, not when the first secret is written.
 * `undefined` is accepted so that `process.env.…` can be passed as it is and
 * an unset variable stops the boot with this message.
 *
 * A sealed value reads `v1:<iv>:<tag>:<ciphertext>`, each part base64. The
 * tag makes a value sealed under another key, or altered, fail to open
 * rather than open to something else.
 */
export function aesGcmSecretSealer(key: string | undefined): SecretSealer {
    if (!key?.trim()) {
        throw new RangeError(
            `The secret sealer needs a key of ${KEY_BYTES} bytes, given as base64, and none ` +
                `was given. ${GENERATE_A_KEY}`,
        );
    }
    const bytes = Buffer.from(key, 'base64');
    if (bytes.length !== KEY_BYTES) {
        throw new RangeError(
            `The secret sealer needs a key of ${KEY_BYTES} bytes, given as base64; ` +
                `this one is ${bytes.length} bytes. ${GENERATE_A_KEY}`,
        );
    }
    // Node also decodes URL-safe and unpadded base64, so a key of the right
    // length can still be written in a form this sealer does not take as its
    // one spelling of the key.
    if (bytes.toString('base64') !== key.trim()) {
        throw new RangeError(
            `The secret sealer needs its key as standard base64 — \`+\`, \`/\` and \`=\` ` +
                `padding. This one decodes to ${KEY_BYTES} bytes but is written another way, ` +
                `URL-safe or unpadded. ${GENERATE_A_KEY}`,
        );
    }
    return {
        async seal(plain) {
            const iv = randomBytes(IV_BYTES);
            const cipher = createCipheriv('aes-256-gcm', bytes, iv);
            const sealed = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
            return [FORMAT, iv, cipher.getAuthTag(), sealed]
                .map((part) => (typeof part === 'string' ? part : part.toString('base64')))
                .join(':');
        },
        async open(sealed) {
            const parts = sealed.split(':');
            if (parts.length !== 4 || parts[0] !== FORMAT) {
                throw new UnreadableSealedSecretError('it is not a value this sealer wrote');
            }
            const [, iv, tag, body] = parts.map((part) => Buffer.from(part, 'base64'));
            if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
                throw new UnreadableSealedSecretError('its parts have the wrong length');
            }
            try {
                const decipher = createDecipheriv('aes-256-gcm', bytes, iv);
                decipher.setAuthTag(tag);
                return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
            } catch {
                throw new UnreadableSealedSecretError(
                    'it was sealed under another key, or has been altered',
                );
            }
        },
    };
}

/**
 * Stores secrets as they are. For an installation that decides so on purpose —
 * a development database, a store that encrypts every column itself — and
 * says so by binding this rather than by leaving the sealer out.
 */
export function storeSecretsInPlainText(): SecretSealer {
    return {
        async seal(plain) {
            return plain;
        },
        async open(sealed) {
            return sealed;
        },
    };
}
