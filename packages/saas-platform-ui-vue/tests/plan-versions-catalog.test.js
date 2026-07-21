// Plan-versions catalog builder — lift-and-shift tests (Phase 2b).
//
// Verifies snapshot construction: drafts > active > historical, plus
// Quota mirror (legacy flat fields maxUsers etc.) and planSortOrder.

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
    test('returns only drafts snapshot for empty catalog', () => {
        const snaps = buildSnapshots({
            planVersions: [],
        });
        assert.equal(snaps.length, 1);
        assert.equal(snaps[0].kind, 'drafts');
        assert.equal(snaps[0].draftCount, 0);
    });

    test('returns active snapshot for published plans', () => {
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

    test('counts open drafts correctly', () => {
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

describe('buildSnapshots — Quota mirror (legacy compatibility)', () => {
    test('legacy maxUsers/maxVehicles/maxStorageGb are mirrored onto ResolvedPlan', () => {
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

    test('modern quotas map takes precedence over legacy fields', () => {
        const snaps = buildSnapshots({
            planVersions: [
                planRow({
                    id: 'p1',
                    planId: 'BASIC',
                    publishedAt: '2026-02-01T00:00:00Z',
                    quotas: { members: 100, storageGb: 20 },
                    maxUsers: 999, // should be ignored
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

    test('Default: alphabetical', () => {
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
    test('returns only drafts (publishedAt = null), sorted', () => {
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
