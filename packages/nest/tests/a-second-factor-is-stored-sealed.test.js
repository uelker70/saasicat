// @requirement SC-SEC-016 — An administrator's second factor is stored sealed, keyed outside the database

// A SuperAdmin's TOTP secret is the second factor of the accounts that can
// change every tenant's plan, codes and contracts. Stored as it is, a database
// dump, a backup or a replica holds it, and the second factor adds nothing
// against whoever has them. So the platform seals it before the port sees it,
// under a key the installation keeps out of that database, and opens nothing
// it did not seal.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { generate, generateSecret } from 'otplib';

import {
    MfaService,
    UnreadableSealedSecretError,
    aesGcmSecretSealer,
    storeSecretsInPlainText,
} from '../dist/admin/index.js';

const key = () => randomBytes(32).toString('base64');

/** An MFA port over a map, holding whatever it is given. */
function portOver(store = new Map()) {
    return {
        store,
        async getSecret(userId) {
            return store.get(userId) ?? null;
        },
        async setSecret(userId, secret) {
            if (secret === null) store.delete(userId);
            else store.set(userId, secret);
        },
        async isEnabled(userId) {
            return store.has(userId);
        },
    };
}

describe('the AES-256-GCM sealer', () => {
    test('opens what it sealed, and nothing of the secret shows in the sealed value', async () => {
        const sealer = aesGcmSecretSealer(key());
        const sealed = await sealer.seal('JBSWY3DPEHPK3PXP');

        assert.ok(!sealed.includes('JBSWY3DPEHPK3PXP'));
        assert.match(sealed, /^v1:/);
        assert.equal(await sealer.open(sealed), 'JBSWY3DPEHPK3PXP');
    });

    test('seals one secret differently every time', async () => {
        const sealer = aesGcmSecretSealer(key());
        assert.notEqual(await sealer.seal('SAME'), await sealer.seal('SAME'));
    });

    test('refuses a value sealed under another key', async () => {
        const sealed = await aesGcmSecretSealer(key()).seal('JBSWY3DPEHPK3PXP');
        await assert.rejects(aesGcmSecretSealer(key()).open(sealed), UnreadableSealedSecretError);
    });

    test('refuses a sealed value that was altered', async () => {
        const sealer = aesGcmSecretSealer(key());
        const [format, iv, tag, body] = (await sealer.seal('JBSWY3DPEHPK3PXP')).split(':');
        const altered = Buffer.from(body, 'base64');
        altered[0] ^= 1;
        await assert.rejects(
            sealer.open([format, iv, tag, altered.toString('base64')].join(':')),
            UnreadableSealedSecretError,
        );
    });

    test('refuses a secret stored before sealing', async () => {
        await assert.rejects(
            aesGcmSecretSealer(key()).open('JBSWY3DPEHPK3PXP'),
            UnreadableSealedSecretError,
        );
    });

    test('refuses a key of the wrong length when it is made, and says its length', () => {
        for (const length of [16, 31, 33]) {
            assert.throws(
                () => aesGcmSecretSealer(randomBytes(length).toString('base64')),
                (error) =>
                    error instanceof RangeError &&
                    error.message.includes('needs a key of 32 bytes') &&
                    error.message.includes(`this one is ${length} bytes`),
                `${length} bytes`,
            );
        }
    });

    test('refuses text that is not base64 at all', () => {
        assert.throws(() => aesGcmSecretSealer('not a key'), {
            name: 'RangeError',
            message: /needs a key of 32 bytes/,
        });
    });

    test('refuses 32 bytes written URL-safe or unpadded, and names the form it takes', () => {
        // Bytes whose standard base64 carries `+`, `/` and padding, so both
        // other spellings differ from it.
        const bytes = Buffer.alloc(32, 0xfb);
        const standard = bytes.toString('base64');
        for (const written of [
            bytes.toString('base64url'),
            standard.slice(0, standard.indexOf('=')),
        ]) {
            assert.throws(() => aesGcmSecretSealer(written), {
                name: 'RangeError',
                message: /needs its key as standard base64[^]*decodes to 32 bytes/,
            });
        }
    });

    test('refuses a missing, empty or blank key, and says how to make one', () => {
        // `process.env.…` is passed as it is, so an unset variable is the case
        // a deployment meets first.
        for (const value of [undefined, '', '   ']) {
            assert.throws(() => aesGcmSecretSealer(value), {
                name: 'RangeError',
                message: /none was given\. Generate one with/,
            });
        }
    });

    test('takes a key with the line break a file leaves after it', async () => {
        const sealer = aesGcmSecretSealer(`${key()}\n`);
        assert.equal(await sealer.open(await sealer.seal('JBSWY3DPEHPK3PXP')), 'JBSWY3DPEHPK3PXP');
    });
});

describe('the MFA service', () => {
    test('stores a sealed secret, and the code from the authenticator still checks', async () => {
        const port = portOver();
        const service = new MfaService(port, aesGcmSecretSealer(key()));

        const { secret } = await service.setup('u1', 'ops@example.com', 'Demo');

        assert.notEqual(port.store.get('u1'), secret, 'stored as it is');
        assert.ok(!port.store.get('u1').includes(secret));
        assert.equal(
            await service.verify({ userId: 'u1', code: await generate({ secret }) }),
            true,
        );
    });

    test('turns away a code where the stored secret cannot be opened, rather than failing open', async () => {
        // A secret stored before sealing, or under a key since replaced: the
        // administrator enrols again.
        const plain = generateSecret();
        const port = portOver(new Map([['u1', plain]]));
        const service = new MfaService(port, aesGcmSecretSealer(key()));

        assert.equal(
            await service.verify({ userId: 'u1', code: await generate({ secret: plain }) }),
            false,
        );
    });

    test('stores the secret as it is only where plain text is bound on purpose', async () => {
        const port = portOver();
        const service = new MfaService(port, storeSecretsInPlainText());

        const { secret } = await service.setup('u1', 'ops@example.com', 'Demo');

        assert.equal(port.store.get('u1'), secret);
    });
});
