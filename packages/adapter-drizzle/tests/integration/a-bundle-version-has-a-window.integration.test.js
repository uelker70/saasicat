// Which BundleVersion is bookable at a given moment.
//
// The shared persistence contract asks this too, but its fixture only ever has
// ONE version inside the window at a time — so it cannot tell the ordering from
// the `validUntil` filter, and removing either from the adapter leaves it
// green. Both were removed to check, and both times it was.
//
// These cases put two versions inside the same moment on purpose, which is the
// only arrangement where the ordering has anything to decide.
//
// Requires SAASICAT_TEST_DATABASE_URL pointing at a DISPOSABLE database.

import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { DrizzleBundleRepository } from '../../dist/index.js';
import { openDisposableDatabase } from './support/disposable-database.mjs';

const at = (s) => new Date(`${s}T00:00:00.000Z`);

let pool;
let db;
let repository;
let bundleId;

before(async () => {
    ({ pool, db } = await openDisposableDatabase({ max: 4 }));
    repository = new DrizzleBundleRepository(db, { validityWindows: true });
});

after(async () => {
    await pool.end();
});

beforeEach(async () => {
    await pool.query('TRUNCATE TABLE bundle_versions, bundles RESTART IDENTITY CASCADE');
    const bundle = await repository.create({
        projectKey: 'window-probe',
        bundleKey: `REPORTING_${randomUUID().slice(0, 8)}`,
        label: 'Reporting',
    });
    bundleId = bundle.id;
});

/** A published version with the window it should carry, without going through publish. */
async function seedVersion({ version, validFrom, validUntil }) {
    const id = randomUUID();
    await pool.query(
        `INSERT INTO bundle_versions
           ("id","bundleId","version","features","quotas","compatibility","pricingOverrides",
            "marketed","changeNote","nonRegressive","publishedAt","validFrom","validUntil",
            "createdAt","updatedAt")
         VALUES ($1,$2,$3,'[]','{}','{}','[]',true,'seed',true,NOW(),$4,$5,NOW(),NOW())`,
        [id, bundleId, version, validFrom, validUntil],
    );
    return id;
}

describe('two versions inside the same moment', () => {
    test('the one whose window opened later wins', async () => {
        // Overlapping on purpose: v1 runs open-ended from January, v2 opens in
        // March. On 15 March both satisfy every other clause, so the ordering is
        // the only thing that can decide — and reversing it picks the wrong one.
        const first = await seedVersion({
            version: 1,
            validFrom: at('2026-01-01'),
            validUntil: null,
        });
        const second = await seedVersion({
            version: 2,
            validFrom: at('2026-03-01'),
            validUntil: null,
        });

        const active = await repository.findActiveBundleVersion(bundleId, at('2026-03-15'));
        assert.equal(active.id, second, 'the later window must win');
        assert.notEqual(active.id, first);
    });

    test('a version with no window at all loses to one that has a window it is inside', async () => {
        // NULLS LAST. A version published before windows existed carries none;
        // it must not outrank a version that deliberately opened.
        await seedVersion({ version: 1, validFrom: null, validUntil: null });
        const windowed = await seedVersion({
            version: 2,
            validFrom: at('2026-03-01'),
            validUntil: null,
        });

        const active = await repository.findActiveBundleVersion(bundleId, at('2026-03-15'));
        assert.equal(active.id, windowed);
    });

    test('a closed window is excluded even when it is the later one', async () => {
        // The ordering alone would pick v2; `validUntil` is what stops it. With
        // that clause removed the ordering compensates and nothing goes red,
        // which is exactly why this case exists.
        const open = await seedVersion({
            version: 1,
            validFrom: at('2026-01-01'),
            validUntil: null,
        });
        await seedVersion({
            version: 2,
            validFrom: at('2026-03-01'),
            validUntil: at('2026-03-10'),
        });

        const active = await repository.findActiveBundleVersion(bundleId, at('2026-03-15'));
        assert.equal(active.id, open, 'a version past its validUntil must not be returned');
    });
});

describe('the edges of one window', () => {
    test('a version is active throughout its last day, and not the next', async () => {
        const id = await seedVersion({
            version: 1,
            validFrom: at('2026-03-01'),
            validUntil: at('2026-03-10'),
        });

        const lastMoment = new Date('2026-03-10T23:59:59.999Z');
        assert.equal((await repository.findActiveBundleVersion(bundleId, lastMoment)).id, id);
        assert.equal(await repository.findActiveBundleVersion(bundleId, at('2026-03-11')), null);
    });

    test('a version is not active before its window opens', async () => {
        await seedVersion({ version: 1, validFrom: at('2026-03-01'), validUntil: null });

        assert.equal(
            await repository.findActiveBundleVersion(
                bundleId,
                new Date('2026-02-28T23:59:59.999Z'),
            ),
            null,
        );
    });

    test('a bundle with no published version at all answers null, not an error', async () => {
        assert.equal(await repository.findActiveBundleVersion(bundleId, at('2026-03-15')), null);
    });
});

describe('an adapter that does not promise windows', () => {
    test('does not offer the method, rather than answering from columns it ignores', () => {
        // The contract gates on `!repository?.findActiveBundleVersion`, so what
        // has to be false is the VALUE. `in` stays true — a declared field is
        // defined as `undefined` under `useDefineForClassFields` — and
        // `adapter-prisma` behaves the same way. Asserting `in` would invent a
        // stricter contract than the one anybody relies on.
        const plain = new DrizzleBundleRepository(db);
        assert.equal(plain.findActiveBundleVersion, undefined);
        const promising = new DrizzleBundleRepository(db, { validityWindows: true });
        assert.equal(typeof promising.findActiveBundleVersion, 'function');
    });

    test('and hands back no window on a version that has one stored', async () => {
        const id = await seedVersion({
            version: 1,
            validFrom: at('2026-03-01'),
            validUntil: at('2026-03-10'),
        });
        const plain = new DrizzleBundleRepository(db);

        const row = await plain.findVersionById(id);
        assert.equal(row.validFrom, null);
        assert.equal(row.validUntil, null);
    });
});
