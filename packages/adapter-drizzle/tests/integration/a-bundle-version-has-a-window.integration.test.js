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

// @requirement SC-PLAN-011 — A published version says which day it applies from
// @requirement SC-BUN-024 — An add-on version somebody has already booked cannot be edited

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
    repository = new DrizzleBundleRepository(db);
});

after(async () => {
    await pool.end();
});

beforeEach(async () => {
    await pool.query('TRUNCATE TABLE bundle_versions, bundles RESTART IDENTITY CASCADE');
    const bundle = await repository.create({
        bundleKey: `REPORTING_${randomUUID().slice(0, 8)}`,
        label: 'Reporting',
    });
    bundleId = bundle.id;
});

/** A published version with the window it should carry, without going through publish. */
// As UTC text, not a Date: node-postgres writes a Date in the machine's local
// time, and a column without a zone keeps that wall-clock reading — so the
// stored moment would move with the timezone of whoever runs the test.
const utc = (date) => (date === null ? null : date.toISOString());

async function seedVersion({ version, validFrom, validUntil, supersededAt = null }) {
    const id = randomUUID();
    await pool.query(
        `INSERT INTO bundle_versions
           ("id","bundleId","version","features","quotas","compatibility","pricingOverrides",
            "marketed","changeNote","nonRegressive","publishedAt","validFrom","validUntil",
            "supersededAt","createdAt","updatedAt")
         VALUES ($1,$2,$3,'[]','{}','{}','[]',true,'seed',true,NOW(),$4,$5,$6,NOW(),NOW())`,
        [id, bundleId, version, utc(validFrom), utc(validUntil), utc(supersededAt)],
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

    test('a superseded version without a last day does not come back when its successor closes', async () => {
        // Superseded without a window — as an import leaves it — it has nothing
        // that would ever end its window, and the successor's closing must not
        // put it back on sale at its old terms.
        await seedVersion({
            version: 1,
            validFrom: null,
            validUntil: null,
            supersededAt: at('2026-01-01'),
        });
        await seedVersion({
            version: 2,
            validFrom: at('2026-01-01'),
            validUntil: at('2026-03-10'),
        });

        assert.equal(await repository.findActiveBundleVersion(bundleId, at('2026-03-15')), null);
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

describe('a version read back', () => {
    test('carries the window it has stored', async () => {
        const id = await seedVersion({
            version: 1,
            validFrom: at('2026-03-01'),
            validUntil: at('2026-03-10'),
        });

        const row = await repository.findVersionById(id);
        assert.equal(row.validFrom, '2026-03-01T00:00:00.000Z');
        assert.equal(row.validUntil, '2026-03-10T00:00:00.000Z');
    });
});
