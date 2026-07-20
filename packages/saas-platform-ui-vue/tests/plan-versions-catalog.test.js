// Plan-Versions-Catalog-Builder — Lift-and-Shift-Tests (Phase 2b).
//
// Verifiziert die Snapshot-Konstruktion: drafts > active > historical, plus
// Quota-Mirror (Legacy-Flachfelder maxUsers etc.) und planSortOrder.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSnapshots, listOpenDrafts } from '../dist/index.js';

function planRow(overrides) {
    return {
        id: overrides.id,
        planId: overrides.planId,
        version: overrides.version ?? 1,
        baseVersionId: null,
        features: overrides.features ?? [],
        monthlyNet: '10.00',
        yearlyNet: '100.00',
        marketed: true,
        publishedAt: overrides.publishedAt ?? null,
        supersededAt: overrides.supersededAt ?? null,
        publishedChanges: null,
        changeNote: overrides.changeNote ?? '',
        nonRegressive: overrides.nonRegressive ?? true,
        createdByUserId: null,
        publishedByUserId: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        ...overrides,
    };
}

describe('buildSnapshots — Drafts/Active/Historical', () => {
    test('liefert nur drafts-Snapshot bei leerem Catalog', () => {
        const snaps = buildSnapshots({
            planVersions: [],
        });
        assert.equal(snaps.length, 1);
        assert.equal(snaps[0].kind, 'drafts');
        assert.equal(snaps[0].draftCount, 0);
    });

    test('liefert active-Snapshot bei publizierten Plänen', () => {
        const snaps = buildSnapshots({
            planVersions: [
                planRow({
                    id: 'p1',
                    planId: 'BASIC',
                    version: 1,
                    publishedAt: '2026-02-01T00:00:00Z',
                }),
            ],
        });
        assert.equal(snaps.length, 2);
        assert.equal(snaps[0].kind, 'drafts');
        assert.equal(snaps[1].kind, 'active');
        assert.equal(snaps[1].plans.length, 1);
        assert.equal(snaps[1].plans[0].planId, 'BASIC');
    });

    test('zählt offene Drafts korrekt', () => {
        const snaps = buildSnapshots({
            planVersions: [
                planRow({ id: 'p1', planId: 'BASIC', version: 2 }),
                planRow({ id: 'u1', planId: 'STANDARD', version: 2 }),
            ],
        });
        const drafts = snaps.find((s) => s.kind === 'drafts');
        assert.equal(drafts.draftCount, 2);
    });
});

describe('buildSnapshots — Quota-Mirror (Legacy-Kompatibilität)', () => {
    test('legacy maxUsers/maxVehicles/maxStorageGb werden auf ResolvedPlan gespiegelt', () => {
        const snaps = buildSnapshots({
            planVersions: [
                planRow({
                    id: 'p1',
                    planId: 'BASIC',
                    publishedAt: '2026-02-01T00:00:00Z',
                    maxUsers: 10,
                    maxVehicles: 50,
                    maxStorageGb: 5,
                }),
            ],
        });
        const active = snaps.find((s) => s.kind === 'active');
        const plan = active.plans[0];
        assert.equal(plan.quotas.users, 10);
        assert.equal(plan.quotas.vehicles, 50);
        assert.equal(plan.quotas.storageGb, 5);
        assert.equal(plan.maxUsers, 10);
        assert.equal(plan.maxVehicles, 50);
        assert.equal(plan.maxStorageGb, 5);
    });

    test('moderne quotas-Map hat Vorrang vor legacy-Feldern', () => {
        const snaps = buildSnapshots({
            planVersions: [
                planRow({
                    id: 'p1',
                    planId: 'BASIC',
                    publishedAt: '2026-02-01T00:00:00Z',
                    quotas: { members: 100, storageGb: 20 },
                    maxUsers: 999, // sollte ignoriert werden
                }),
            ],
        });
        const active = snaps.find((s) => s.kind === 'active');
        const plan = active.plans[0];
        assert.equal(plan.quotas.members, 100);
        assert.equal(plan.quotas.storageGb, 20);
        assert.equal(plan.maxUsers, undefined);
    });
});

describe('buildSnapshots — planSortOrder', () => {
    test('planSortOrder: BASIC < STANDARD < PROFESSIONAL', () => {
        const snaps = buildSnapshots(
            {
                planVersions: [
                    planRow({
                        id: 'p3',
                        planId: 'PROFESSIONAL',
                        publishedAt: '2026-02-01T00:00:00Z',
                    }),
                    planRow({ id: 'p1', planId: 'BASIC', publishedAt: '2026-02-01T00:00:00Z' }),
                    planRow({ id: 'p2', planId: 'STANDARD', publishedAt: '2026-02-01T00:00:00Z' }),
                ],
            },
            { planSortOrder: ['BASIC', 'STANDARD', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE'] },
        );
        const active = snaps.find((s) => s.kind === 'active');
        assert.deepEqual(
            active.plans.map((p) => p.planId),
            ['BASIC', 'STANDARD', 'PROFESSIONAL'],
        );
    });

    test('Default: alphabetisch', () => {
        const snaps = buildSnapshots({
            planVersions: [
                planRow({ id: 'p1', planId: 'PROFESSIONAL', publishedAt: '2026-02-01T00:00:00Z' }),
                planRow({ id: 'p2', planId: 'BASIC', publishedAt: '2026-02-01T00:00:00Z' }),
            ],
        });
        const active = snaps.find((s) => s.kind === 'active');
        assert.deepEqual(
            active.plans.map((p) => p.planId),
            ['BASIC', 'PROFESSIONAL'],
        );
    });
});

describe('listOpenDrafts', () => {
    test('liefert nur Drafts (publishedAt = null), sortiert', () => {
        const data = {
            planVersions: [
                planRow({
                    id: 'p1',
                    planId: 'BASIC',
                    version: 1,
                    publishedAt: '2026-02-01T00:00:00Z',
                }),
                planRow({ id: 'p2', planId: 'BASIC', version: 2 }), // draft
            ],
        };
        const drafts = listOpenDrafts(data);
        assert.equal(drafts.plans.length, 1);
        assert.equal(drafts.plans[0].id, 'p2');
    });
});
