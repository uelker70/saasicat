import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PlansService, PlanVersionsService } from '../dist/catalog/index.js';
import { FakePlanRepository } from '../dist/testing/index.js';

// PlansService — plan-root CRUD (SPEC_V2 §11.1 M6 Pack 1).
// PlanVersion lifecycle is explicitly not part of this package (follows in Pack 2).

const PROJECT = 'clubapp';

function makeService() {
    const repo = new FakePlanRepository();
    return { service: new PlansService(repo), repo };
}

describe('PlansService — root operations', () => {
    test('createPlan + listPlans + getPlan happy path', async () => {
        const { service } = makeService();
        const created = await service.createPlan({
            projectKey: PROJECT,
            planKey: 'STARTER',
            label: 'Starter',
            sortOrder: 10,
        });
        assert.equal(created.planKey, 'STARTER');
        assert.equal(created.sortOrder, 10);
        assert.equal(created.deletedAt, null);

        const list = await service.listPlans(PROJECT);
        assert.equal(list.length, 1);
        assert.equal(list[0].id, created.id);

        const fetched = await service.getPlan(created.id);
        assert.equal(fetched.label, 'Starter');
    });

    test('createPlan: duplicate planKey → UnprocessableEntity', async () => {
        const { service } = makeService();
        await service.createPlan({
            projectKey: PROJECT,
            planKey: 'STARTER',
            label: 'Starter',
        });
        await assert.rejects(
            () =>
                service.createPlan({
                    projectKey: PROJECT,
                    planKey: 'STARTER',
                    label: 'Doppelt',
                }),
            (err) => {
                assert.equal(err.status, 422);
                return true;
            },
        );
    });

    test('createPlan: same planKey allowed in a different project', async () => {
        const { service } = makeService();
        await service.createPlan({
            projectKey: 'clubapp',
            planKey: 'STARTER',
            label: 'ClubApp Starter',
        });
        const demoApp = await service.createPlan({
            projectKey: 'demoapp',
            planKey: 'STARTER',
            label: 'DemoApp Starter',
        });
        assert.equal(demoApp.projectKey, 'demoapp');
        assert.equal(demoApp.planKey, 'STARTER');
    });

    test('updatePlan changes label + sortOrder', async () => {
        const { service } = makeService();
        const created = await service.createPlan({
            projectKey: PROJECT,
            planKey: 'STD',
            label: 'Standard',
        });
        const patched = await service.updatePlan(created.id, {
            label: 'Standard PRO',
            sortOrder: 99,
        });
        assert.equal(patched.label, 'Standard PRO');
        assert.equal(patched.sortOrder, 99);
        // planKey stays — it is not in the UpdatePlanData contract
        assert.equal(patched.planKey, 'STD');
    });

    test('updatePlan: NotFound for unknown ID', async () => {
        const { service } = makeService();
        await assert.rejects(
            () => service.updatePlan('not-existing', { label: 'X' }),
            (err) => {
                assert.equal(err.status, 404);
                return true;
            },
        );
    });

    test('softDeletePlan without versions sets deletedAt + disappears from list', async () => {
        const { service } = makeService();
        const created = await service.createPlan({
            projectKey: PROJECT,
            planKey: 'PRO',
            label: 'Professional',
        });
        await service.softDeletePlan(created.id);
        const list = await service.listPlans(PROJECT);
        assert.equal(list.length, 0);

        // getPlan still returns it (contract protection P1: existing subscriptions still see it)
        const fetched = await service.getPlan(created.id);
        assert.notEqual(fetched.deletedAt, null);
    });

    test('softDeletePlan idempotent (second call without throw)', async () => {
        const { service } = makeService();
        const created = await service.createPlan({
            projectKey: PROJECT,
            planKey: 'IDEM',
            label: 'Idempotent',
        });
        await service.softDeletePlan(created.id);
        await service.softDeletePlan(created.id); // should not throw
    });

    test('softDeletePlan: NotFound for unknown ID', async () => {
        const { service } = makeService();
        await assert.rejects(
            () => service.softDeletePlan('not-existing'),
            (err) => {
                assert.equal(err.status, 404);
                return true;
            },
        );
    });

    test('softDeletePlan: live version → 422 PLAN_HAS_PUBLISHED_VERSIONS', async () => {
        const { service, repo } = makeService();
        const versionsService = new PlanVersionsService(repo, null, { strictModeCheckMode: 'warn-only' });
        const created = await service.createPlan({
            projectKey: PROJECT,
            planKey: 'WITH_LIVE_SOFT',
            label: 'With Live',
        });
        const draft = await versionsService.createPlanDraft({
            planId: created.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '0.00',
            yearlyNet: '0.00',
        });
        await versionsService.publishPlanVersion(draft.planVersion.id, {
            publishedByUserId: null,
            allowZeroPrice: true, // setup drafts use 0.00 placeholder prices
            validFrom: '2026-01-01',
        });
        await assert.rejects(
            () => service.softDeletePlan(created.id),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response.code, 'PLAN_HAS_PUBLISHED_VERSIONS');
                assert.equal(err.response.liveCount, 1);
                return true;
            },
        );
    });

    test('softDeletePlan: superseded version (no live anymore) → 422 PLAN_HAS_PUBLISHED_VERSIONS', async () => {
        const { service, repo } = makeService();
        const versionsService = new PlanVersionsService(repo, null, { strictModeCheckMode: 'warn-only' });
        const created = await service.createPlan({
            projectKey: PROJECT,
            planKey: 'WITH_SUPERSEDED',
            label: 'Superseded',
        });
        const v1 = await versionsService.createPlanDraft({
            planId: created.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '0.00',
            yearlyNet: '0.00',
        });
        await versionsService.publishPlanVersion(v1.planVersion.id, {
            publishedByUserId: null,
            allowZeroPrice: true, // setup drafts use 0.00 placeholder prices
            validFrom: '2026-01-01',
        });
        const v2 = await versionsService.createPlanDraft({
            planId: created.id,
            features: ['A', 'B'],
            quotas: {},
            monthlyNet: '0.00',
            yearlyNet: '0.00',
        });
        await versionsService.publishPlanVersion(v2.planVersion.id, {
            publishedByUserId: null,
            allowZeroPrice: true, // setup drafts use 0.00 placeholder prices
            validFrom: '2026-06-01',
        });
        // v1 is now superseded. Plan has 1 live + 1 superseded.
        await assert.rejects(
            () => service.softDeletePlan(created.id),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response.code, 'PLAN_HAS_PUBLISHED_VERSIONS');
                assert.equal(err.response.publishedCount, 2);
                assert.equal(err.response.liveCount, 1);
                assert.equal(err.response.supersededCount, 1);
                return true;
            },
        );
    });

    test('softDeletePlan: only draft (nothing published) → allowed', async () => {
        const { service, repo } = makeService();
        const versionsService = new PlanVersionsService(repo, null, { strictModeCheckMode: 'warn-only' });
        const created = await service.createPlan({
            projectKey: PROJECT,
            planKey: 'DRAFT_ONLY',
            label: 'Draft Only',
        });
        await versionsService.createPlanDraft({
            planId: created.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '0.00',
            yearlyNet: '0.00',
        });
        // soft-delete allowed: no published version exists.
        await service.softDeletePlan(created.id);
        const list = await service.listPlans(PROJECT);
        assert.equal(
            list.find((p) => p.planKey === 'DRAFT_ONLY'),
            undefined,
        );
    });

    test('hardDeletePlan: without versions → plan is gone from list', async () => {
        const { service } = makeService();
        const created = await service.createPlan({
            projectKey: 'clubapp',
            planKey: 'PURGE_ME',
            label: 'Purge Me',
        });
        await service.hardDeletePlan(created.id);
        const all = await service.listPlans('clubapp');
        assert.equal(
            all.find((p) => p.planKey === 'PURGE_ME'),
            undefined,
        );
    });

    test('hardDeletePlan: with draft → 422 PLAN_HAS_DRAFTS', async () => {
        const { service, repo } = makeService();

        const versionsService = new PlanVersionsService(repo, null, { strictModeCheckMode: 'warn-only' });
        const created = await service.createPlan({
            projectKey: 'clubapp',
            planKey: 'WITH_DRAFT',
            label: 'With Draft',
        });
        await versionsService.createPlanDraft({
            planId: created.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '0.00',
            yearlyNet: '0.00',
        });
        await assert.rejects(
            () => service.hardDeletePlan(created.id),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response.code, 'PLAN_HAS_DRAFTS');
                assert.equal(err.response.draftCount, 1);
                return true;
            },
        );
    });

    test('hardDeletePlan: with published version → 422 PLAN_HAS_PUBLISHED_VERSIONS', async () => {
        const { service, repo } = makeService();

        const versionsService = new PlanVersionsService(repo, null, { strictModeCheckMode: 'warn-only' });
        const created = await service.createPlan({
            projectKey: 'clubapp',
            planKey: 'WITH_LIVE',
            label: 'With Live',
        });
        const draft = await versionsService.createPlanDraft({
            planId: created.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '0.00',
            yearlyNet: '0.00',
        });
        await versionsService.publishPlanVersion(draft.planVersion.id, {
            publishedByUserId: null,
            allowZeroPrice: true, // setup drafts use 0.00 placeholder prices
            validFrom: '2026-01-01',
        });
        await assert.rejects(
            () => service.hardDeletePlan(created.id),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response.code, 'PLAN_HAS_PUBLISHED_VERSIONS');
                assert.equal(err.response.publishedCount, 1);
                assert.equal(err.response.liveCount, 1);
                return true;
            },
        );
    });

    test('hardDeletePlan: NotFound for unknown ID', async () => {
        const { service } = makeService();
        await assert.rejects(
            () => service.hardDeletePlan('not-existing'),
            (err) => {
                assert.equal(err.status, 404);
                return true;
            },
        );
    });

    test('listPlans: scoped per projectKey', async () => {
        const { service } = makeService();
        await service.createPlan({
            projectKey: 'clubapp',
            planKey: 'A',
            label: 'A',
        });
        await service.createPlan({
            projectKey: 'demoapp',
            planKey: 'B',
            label: 'B',
        });
        const v = await service.listPlans('clubapp');
        const c = await service.listPlans('demoapp');
        assert.equal(v.length, 1);
        assert.equal(c.length, 1);
        assert.equal(v[0].planKey, 'A');
        assert.equal(c[0].planKey, 'B');
    });

    test('listPlans onlyPublished: only plans with a live version', async () => {
        const { service, repo } = makeService();
        const versionsService = new PlanVersionsService(repo, null, { strictModeCheckMode: 'warn-only' });

        // Plan with a published version.
        const live = await service.createPlan({
            projectKey: PROJECT,
            planKey: 'LIVE_PLAN',
            label: 'Live',
        });
        const draft = await versionsService.createPlanDraft({
            planId: live.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '0.00',
            yearlyNet: '0.00',
        });
        await versionsService.publishPlanVersion(draft.planVersion.id, {
            publishedByUserId: null,
            allowZeroPrice: true, // setup drafts use 0.00 placeholder prices
            validFrom: '2026-01-01',
        });

        // Plan only as draft (no live version).
        const draftOnly = await service.createPlan({
            projectKey: PROJECT,
            planKey: 'DRAFT_PLAN',
            label: 'Draft',
        });
        await versionsService.createPlanDraft({
            planId: draftOnly.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '0.00',
            yearlyNet: '0.00',
        });

        const all = await service.listPlans(PROJECT);
        assert.equal(all.length, 2);

        const published = await service.listPlans(PROJECT, { onlyPublished: true });
        assert.equal(published.length, 1);
        assert.equal(published[0].planKey, 'LIVE_PLAN');
    });

    test('listPlans onlyPublished: superseded version does not count as live', async () => {
        const { service, repo } = makeService();
        const versionsService = new PlanVersionsService(repo, null, { strictModeCheckMode: 'warn-only' });
        const plan = await service.createPlan({
            projectKey: PROJECT,
            planKey: 'SUPERSEDED_ONLY',
            label: 'Superseded',
        });
        const v1 = await versionsService.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '0.00',
            yearlyNet: '0.00',
        });
        await versionsService.publishPlanVersion(v1.planVersion.id, {
            publishedByUserId: null,
            allowZeroPrice: true, // setup drafts use 0.00 placeholder prices
            validFrom: '2026-01-01',
        });
        const v2 = await versionsService.createPlanDraft({
            planId: plan.id,
            features: ['A', 'B'],
            quotas: {},
            monthlyNet: '0.00',
            yearlyNet: '0.00',
        });
        // Supersedes v1; v2 is now the live version → plan stays published.
        await versionsService.publishPlanVersion(v2.planVersion.id, {
            publishedByUserId: null,
            allowZeroPrice: true, // setup drafts use 0.00 placeholder prices
            validFrom: '2026-06-01',
        });

        const published = await service.listPlans(PROJECT, { onlyPublished: true });
        assert.equal(published.length, 1);
        assert.equal(published[0].planKey, 'SUPERSEDED_ONLY');
    });
});
