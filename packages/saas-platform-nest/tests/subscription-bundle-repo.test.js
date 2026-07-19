import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { FakeSubscriptionBundleRepository } from '../dist/testing/index.js';

// FakeSubscriptionBundleRepository — In-Memory-Adapter für die
// `subscription_bundles`-Junction (SPEC_V2 §11.1 M6 Pack 2e). Tests
// decken die Repo-API ab: add → listBy → cancel → countActive. Die
// fachliche Schicht (Mindestlaufzeit-Default, Plan-Kompat-Check beim
// Add) gehört in einen Service und wird separat getestet, sobald er
// existiert (siehe OPEN_ISSUES P11.7.3 Restschuld).

const SUB_A = 'sub-a';
const SUB_B = 'sub-b';
const BV_A = 'bv-a';
const BV_B = 'bv-b';

let repo;

beforeEach(() => {
    repo = new FakeSubscriptionBundleRepository();
});

describe('SubscriptionBundleRepository — Lifecycle', () => {
    test('add + listBySubscription liefert die neue Buchung', async () => {
        const startedAt = new Date('2026-01-01T00:00:00Z');
        const row = await repo.add({
            subscriptionId: SUB_A,
            bundleVersionId: BV_A,
            startedAt,
        });
        assert.equal(row.subscriptionId, SUB_A);
        assert.equal(row.bundleVersionId, BV_A);
        assert.equal(row.canceledAt, null);
        assert.equal(row.minimumTermEndsAt, null);

        const list = await repo.listBySubscription(SUB_A);
        assert.equal(list.length, 1);
        assert.equal(list[0].id, row.id);
    });

    test('listActiveBySubscription filtert gekündigte Buchungen mit vergangenem Wirksamkeitsdatum', async () => {
        const startedAt = new Date('2026-01-01T00:00:00Z');
        const cancelEffective = new Date('2026-02-01T00:00:00Z');

        const active = await repo.add({ subscriptionId: SUB_A, bundleVersionId: BV_A, startedAt });
        const canceled = await repo.add({
            subscriptionId: SUB_A,
            bundleVersionId: BV_B,
            startedAt,
        });
        await repo.cancel(canceled.id, {
            canceledAt: new Date('2026-01-15T00:00:00Z'),
            canceledEffectiveAt: cancelEffective,
        });

        // asOf = 2026-03-01 → cancelEffective ist in der Vergangenheit
        const list = await repo.listActiveBySubscription(SUB_A, new Date('2026-03-01T00:00:00Z'));
        assert.equal(list.length, 1);
        assert.equal(list[0].id, active.id);

        // asOf = 2026-01-20 → cancelEffective ist in der Zukunft → noch aktiv
        const list2 = await repo.listActiveBySubscription(SUB_A, new Date('2026-01-20T00:00:00Z'));
        assert.equal(list2.length, 2);
    });

    test('cancel: zweiter Aufruf wirft', async () => {
        const row = await repo.add({
            subscriptionId: SUB_A,
            bundleVersionId: BV_A,
            startedAt: new Date('2026-01-01T00:00:00Z'),
        });
        await repo.cancel(row.id, {
            canceledAt: new Date('2026-01-15T00:00:00Z'),
            canceledEffectiveAt: new Date('2026-02-01T00:00:00Z'),
        });
        await assert.rejects(() =>
            repo.cancel(row.id, {
                canceledAt: new Date(),
                canceledEffectiveAt: new Date(),
            }),
        );
    });

    test('countActiveByBundleVersionId zählt nur nicht-gekündigte (oder zukünftig wirksame) Buchungen', async () => {
        const startedAt = new Date('2026-01-01T00:00:00Z');
        const a = await repo.add({ subscriptionId: SUB_A, bundleVersionId: BV_A, startedAt });
        await repo.add({ subscriptionId: SUB_B, bundleVersionId: BV_A, startedAt });
        const c = await repo.add({ subscriptionId: SUB_A, bundleVersionId: BV_B, startedAt });
        await repo.cancel(a.id, {
            canceledAt: new Date('2026-01-10T00:00:00Z'),
            canceledEffectiveAt: new Date('2026-01-15T00:00:00Z'),
        });

        // asOf = 2026-02-01 → a ist effektiv gekündigt; b aktiv
        const ab = await repo.countActiveByBundleVersionId(BV_A, new Date('2026-02-01T00:00:00Z'));
        assert.equal(ab, 1);
        const bc = await repo.countActiveByBundleVersionId(BV_B, new Date('2026-02-01T00:00:00Z'));
        assert.equal(bc, 1);

        // asOf = 2026-01-12 → a Kündigung noch nicht wirksam
        const abEarly = await repo.countActiveByBundleVersionId(
            BV_A,
            new Date('2026-01-12T00:00:00Z'),
        );
        assert.equal(abEarly, 2);

        // c bleibt aktiv (nie gekündigt)
        void c;
    });
});
