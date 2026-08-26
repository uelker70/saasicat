// The bundle catalogue: stems, drafts, and the lineage between versions.
//
// The shared persistence contract publishes twice and checks the validity
// window, which leaves most of this repository unvisited — updating a stem,
// retiring one, finding by key, numbering the next draft, refusing a second
// one, and discarding a draft that has not been published. Each of those is a
// thing an operator does, and none of them had a test.
//
// Requires SAASICAT_TEST_DATABASE_URL pointing at a DISPOSABLE database.

import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { DrizzleBundleRepository } from '../../dist/index.js';
import { openDisposableDatabase } from './support/disposable-database.mjs';

const PROJECT = 'catalogue-probe';

let pool;
let db;
let repository;

before(async () => {
    ({ pool, db } = await openDisposableDatabase({ max: 4 }));
    repository = new DrizzleBundleRepository(db, { validityWindows: true });
});

after(async () => {
    await pool.end();
});

beforeEach(async () => {
    await pool.query('TRUNCATE TABLE bundle_versions, bundles RESTART IDENTITY CASCADE');
});

const createBundle = (overrides = {}) =>
    repository.create({
        projectKey: PROJECT,
        bundleKey: `REPORTING_${randomUUID().slice(0, 8)}`,
        label: 'Reporting',
        ...overrides,
    });

const publish = (versionId, validFrom) =>
    repository.publishDraft(versionId, {
        publishedByUserId: null,
        publishedChanges: [],
        nonRegressive: true,
        validFrom: new Date(`${validFrom}T00:00:00.000Z`),
        validUntil: null,
    });

describe('an operator manages a bundle', () => {
    test('a new bundle comes back with its defaults filled in', async () => {
        const bundle = await createBundle();
        assert.equal(bundle.projectKey, PROJECT);
        assert.equal(bundle.sortOrder, 0);
        assert.deepEqual(bundle.i18n, {});
        assert.equal(bundle.description, null);
        assert.equal(bundle.deletedAt, null);
    });

    test('it is findable by its key as well as its id', async () => {
        const bundle = await createBundle({ bundleKey: 'ANALYTICS' });
        assert.equal((await repository.findByKey(PROJECT, 'ANALYTICS')).id, bundle.id);
        assert.equal((await repository.findById(bundle.id)).bundleKey, 'ANALYTICS');
    });

    test('a key in another project is not this project’s bundle', async () => {
        await createBundle({ bundleKey: 'ANALYTICS' });
        assert.equal(await repository.findByKey('somebody-else', 'ANALYTICS'), null);
    });

    test('an update changes what it names and leaves the rest alone', async () => {
        const bundle = await createBundle({ description: 'before', sortOrder: 3 });
        const updated = await repository.update(bundle.id, { label: 'Renamed' });
        assert.equal(updated.label, 'Renamed');
        assert.equal(updated.description, 'before', 'an unnamed field must not be cleared');
        assert.equal(updated.sortOrder, 3);
    });

    test('a field can be cleared on purpose, which is not the same as leaving it out', async () => {
        const bundle = await createBundle({ description: 'before' });
        assert.equal((await repository.update(bundle.id, { description: null })).description, null);
    });

    test('updating a bundle that is not there says so', async () => {
        await assert.rejects(() => repository.update(randomUUID(), { label: 'x' }), /not found/);
    });

    test('a retired bundle drops out of the list but stays readable', async () => {
        const kept = await createBundle({ bundleKey: 'KEPT' });
        const retired = await createBundle({ bundleKey: 'RETIRED' });
        await repository.softDelete(retired.id);

        const listed = await repository.list({ projectKey: PROJECT });
        assert.deepEqual(
            listed.map((row) => row.id),
            [kept.id],
        );
        // Still readable: a booking pinned to one of its versions has to
        // resolve, and a retired bundle is history rather than absence.
        assert.ok((await repository.findById(retired.id)).deletedAt);
    });

    test('…and can be listed deliberately', async () => {
        const retired = await createBundle();
        await repository.softDelete(retired.id);
        const listed = await repository.list({ projectKey: PROJECT, excludeDeleted: false });
        assert.equal(listed.length, 1);
    });

    test('the list is ordered by sort order, then by key', async () => {
        await createBundle({ bundleKey: 'B_SECOND', sortOrder: 1 });
        await createBundle({ bundleKey: 'A_THIRD', sortOrder: 2 });
        await createBundle({ bundleKey: 'C_FIRST', sortOrder: 0 });

        assert.deepEqual(
            (await repository.list({ projectKey: PROJECT })).map((row) => row.bundleKey),
            ['C_FIRST', 'B_SECOND', 'A_THIRD'],
        );
    });

    test('another project’s bundles are not in this project’s list', async () => {
        await createBundle();
        const listed = await repository.list({ projectKey: 'somebody-else' });
        assert.deepEqual(listed, []);
    });
});

describe('drafting a version', () => {
    test('the first draft is v1, and the next one after publishing is v2', async () => {
        const bundle = await createBundle();
        const first = await repository.createDraft({ bundleId: bundle.id, features: ['REPORTS'] });
        assert.equal(first.version, 1);
        assert.equal(first.publishedAt, null);

        await publish(first.id, '2026-01-01');
        const second = await repository.createDraft({
            bundleId: bundle.id,
            baseVersionId: first.id,
            features: ['REPORTS', 'EXPORTS'],
        });
        assert.equal(second.version, 2);
        assert.equal(second.baseVersionId, first.id);
    });

    test('a second draft beside an unpublished one is refused, and names the one in the way', async () => {
        const bundle = await createBundle();
        await repository.createDraft({ bundleId: bundle.id, features: ['REPORTS'] });
        await assert.rejects(
            () => repository.createDraft({ bundleId: bundle.id, features: ['OTHER'] }),
            /already has a draft version \(v1\)/,
        );
    });

    test('the draft is the one findable as current, and only while it is a draft', async () => {
        const bundle = await createBundle();
        const draft = await repository.createDraft({ bundleId: bundle.id, features: ['REPORTS'] });
        assert.equal((await repository.findCurrentDraft(bundle.id)).id, draft.id);

        await publish(draft.id, '2026-01-01');
        assert.equal(await repository.findCurrentDraft(bundle.id), null);
    });

    test('an edit changes what it names and leaves the rest standing', async () => {
        const bundle = await createBundle();
        const draft = await repository.createDraft({
            bundleId: bundle.id,
            features: ['REPORTS'],
            monthlyNet: '9.90',
            changeNote: 'first',
        });

        const edited = await repository.updateDraft(draft.id, { features: ['REPORTS', 'EXPORTS'] });
        assert.deepEqual(edited.features, ['REPORTS', 'EXPORTS']);
        assert.equal(edited.monthlyNet, '9.90');
        assert.equal(edited.changeNote, 'first');
    });

    test('a price can be taken away, which an omitted field would not do', async () => {
        const bundle = await createBundle();
        const draft = await repository.createDraft({
            bundleId: bundle.id,
            features: ['REPORTS'],
            monthlyNet: '9.90',
        });
        assert.equal(
            (await repository.updateDraft(draft.id, { monthlyNet: null })).monthlyNet,
            null,
        );
    });

    test('editing a version that is not there says so', async () => {
        await assert.rejects(
            () => repository.updateDraft(randomUUID(), { features: [] }),
            /not found/,
        );
    });

    test('every version of the bundle is listed, oldest first', async () => {
        const bundle = await createBundle();
        const first = await repository.createDraft({ bundleId: bundle.id, features: ['A'] });
        await publish(first.id, '2026-01-01');
        const second = await repository.createDraft({ bundleId: bundle.id, features: ['B'] });

        assert.deepEqual(
            (await repository.listVersions(bundle.id)).map((row) => row.version),
            [1, 2],
        );
        assert.equal((await repository.findVersionById(second.id)).id, second.id);
    });

    test('a version id nobody created answers null', async () => {
        assert.equal(await repository.findVersionById(randomUUID()), null);
    });
});

describe('discarding a draft', () => {
    test('an unpublished draft is gone afterwards', async () => {
        const bundle = await createBundle();
        const draft = await repository.createDraft({ bundleId: bundle.id, features: ['REPORTS'] });

        await repository.deleteDraft(draft.id);
        assert.equal(await repository.findVersionById(draft.id), null);
        // …and the bundle can be drafted again, which is the point of discarding.
        assert.ok(await repository.createDraft({ bundleId: bundle.id, features: ['OTHER'] }));
    });

    test('a published version is refused — it is what somebody may have booked', async () => {
        const bundle = await createBundle();
        const draft = await repository.createDraft({ bundleId: bundle.id, features: ['REPORTS'] });
        await publish(draft.id, '2026-01-01');

        await assert.rejects(() => repository.deleteDraft(draft.id), /already published/);
    });

    test('discarding something that is already gone is a no-op, not an error', async () => {
        // A second click, or a concurrent discard. Both are the state the
        // caller wanted.
        await repository.deleteDraft(randomUUID());
    });
});

describe('which version is live', () => {
    test('the newest published one that has not been superseded', async () => {
        const bundle = await createBundle();
        const first = await repository.createDraft({ bundleId: bundle.id, features: ['A'] });
        await publish(first.id, '2026-01-01');
        assert.equal((await repository.findLatestLive(bundle.id)).id, first.id);

        const second = await repository.createDraft({ bundleId: bundle.id, features: ['B'] });
        await publish(second.id, '2026-03-01');
        assert.equal((await repository.findLatestLive(bundle.id)).id, second.id);
    });

    test('a bundle with only a draft has nothing live', async () => {
        const bundle = await createBundle();
        await repository.createDraft({ bundleId: bundle.id, features: ['A'] });
        assert.equal(await repository.findLatestLive(bundle.id), null);
    });
});

describe('reading inside a transaction stays on its connection', () => {
    // A version query that honours the caller's transaction and a stem query
    // beside it that quietly takes a second connection is a deadlock waiting
    // for load: the second connection can only be released when the transaction
    // ends, and the transaction cannot end until the query returns.
    //
    // A pool of ONE makes that certain rather than likely. `enforceLimit()` is
    // the real caller — it holds a subscription row lock while resolving what a
    // tenant is entitled to — and it would stop dead here.

    test('every transaction-aware read answers with a pool of one', async () => {
        const { pool: single, db: singleDb } = await openDisposableDatabase({ max: 1 });
        try {
            const repo = new DrizzleBundleRepository(singleDb, { validityWindows: true });
            const bundle = await repo.create({
                projectKey: PROJECT,
                bundleKey: 'SOLO',
                label: 'Solo',
            });
            const draft = await repo.createDraft({ bundleId: bundle.id, features: ['A'] });
            await repo.publishDraft(draft.id, {
                publishedByUserId: null,
                publishedChanges: [],
                nonRegressive: true,
                validFrom: new Date('2026-01-01T00:00:00.000Z'),
                validUntil: null,
            });

            // Inside the transaction there is no second connection to take.
            // Anything reaching for one waits for this block to finish, which
            // it cannot do while waiting.
            const seen = await singleDb.transaction(async (tx) => {
                // The transaction object itself is the `TransactionContext`
                // here — `DrizzleTransactionRunner` hands the same thing on.
                return {
                    byId: await repo.findVersionById(draft.id, tx),
                    latest: await repo.findLatestLive(bundle.id, tx),
                    active: await repo.findActiveBundleVersion(
                        bundle.id,
                        new Date('2026-06-01T00:00:00.000Z'),
                        tx,
                    ),
                };
            });

            assert.equal(seen.byId.id, draft.id);
            assert.equal(seen.latest.id, draft.id);
            assert.equal(seen.active.id, draft.id);
            // The stem came along, which is what needed the second connection.
            assert.equal(seen.byId.bundleKey, 'SOLO');
            assert.equal(seen.latest.label, 'Solo');
        } finally {
            await single.end();
        }
    });
});
