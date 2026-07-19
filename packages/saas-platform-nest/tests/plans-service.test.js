import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PlansService, PlanVersionsService } from '../dist/catalog/index.js';
import { FakePlanRepository } from '../dist/testing/index.js';

// PlansService — Plan-Stamm-CRUD (SPEC_V2 §11.1 M6 Pack 1).
// PlanVersion-Lifecycle ist explizit nicht Teil dieses Pakets (folgt Pack 2).

const PROJECT = 'vereinsfux';

function makeService() {
    const repo = new FakePlanRepository();
    return { service: new PlansService(repo), repo };
}

describe('PlansService — Stamm-Operationen', () => {
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

    test('createPlan: doppelter planKey → UnprocessableEntity', async () => {
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

    test('createPlan: gleicher planKey in anderem Projekt erlaubt', async () => {
        const { service } = makeService();
        await service.createPlan({
            projectKey: 'vereinsfux',
            planKey: 'STARTER',
            label: 'Vereinsfux Starter',
        });
        const autohausPro = await service.createPlan({
            projectKey: 'autohauspro',
            planKey: 'STARTER',
            label: 'AutohausPro Starter',
        });
        assert.equal(autohausPro.projectKey, 'autohauspro');
        assert.equal(autohausPro.planKey, 'STARTER');
    });

    test('updatePlan ändert label + sortOrder', async () => {
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
        // planKey bleibt — es ist nicht im UpdatePlanData-Vertrag
        assert.equal(patched.planKey, 'STD');
    });

    test('updatePlan: NotFound bei unbekannter ID', async () => {
        const { service } = makeService();
        await assert.rejects(
            () => service.updatePlan('not-existing', { label: 'X' }),
            (err) => {
                assert.equal(err.status, 404);
                return true;
            },
        );
    });

    test('softDeletePlan ohne Versionen setzt deletedAt + verschwindet aus list', async () => {
        const { service } = makeService();
        const created = await service.createPlan({
            projectKey: PROJECT,
            planKey: 'PRO',
            label: 'Professional',
        });
        await service.softDeletePlan(created.id);
        const list = await service.listPlans(PROJECT);
        assert.equal(list.length, 0);

        // getPlan liefert weiterhin (Vertragsschutz P1: Bestand sieht)
        const fetched = await service.getPlan(created.id);
        assert.notEqual(fetched.deletedAt, null);
    });

    test('softDeletePlan idempotent (zweiter Call ohne Throw)', async () => {
        const { service } = makeService();
        const created = await service.createPlan({
            projectKey: PROJECT,
            planKey: 'IDEM',
            label: 'Idempotent',
        });
        await service.softDeletePlan(created.id);
        await service.softDeletePlan(created.id); // sollte nicht werfen
    });

    test('softDeletePlan: NotFound bei unbekannter ID', async () => {
        const { service } = makeService();
        await assert.rejects(
            () => service.softDeletePlan('not-existing'),
            (err) => {
                assert.equal(err.status, 404);
                return true;
            },
        );
    });

    test('softDeletePlan: live Version → 422 PLAN_HAS_PUBLISHED_VERSIONS', async () => {
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
            allowZeroPrice: true, // Setup-Drafts nutzen 0,00-Platzhalterpreise
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

    test('softDeletePlan: superseded Version (kein live mehr) → 422 PLAN_HAS_PUBLISHED_VERSIONS', async () => {
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
            allowZeroPrice: true, // Setup-Drafts nutzen 0,00-Platzhalterpreise
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
            allowZeroPrice: true, // Setup-Drafts nutzen 0,00-Platzhalterpreise
            validFrom: '2026-06-01',
        });
        // v1 ist jetzt superseded. Plan hat 1 live + 1 superseded.
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

    test('softDeletePlan: nur Draft (kein published) → erlaubt', async () => {
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
        // Soft-delete erlaubt: kein published Version existiert.
        await service.softDeletePlan(created.id);
        const list = await service.listPlans(PROJECT);
        assert.equal(
            list.find((p) => p.planKey === 'DRAFT_ONLY'),
            undefined,
        );
    });

    test('hardDeletePlan: ohne Versionen → Plan ist weg aus list', async () => {
        const { service } = makeService();
        const created = await service.createPlan({
            projectKey: 'vereinsfux',
            planKey: 'PURGE_ME',
            label: 'Purge Me',
        });
        await service.hardDeletePlan(created.id);
        const all = await service.listPlans('vereinsfux');
        assert.equal(
            all.find((p) => p.planKey === 'PURGE_ME'),
            undefined,
        );
    });

    test('hardDeletePlan: mit Draft → 422 PLAN_HAS_DRAFTS', async () => {
        const { service, repo } = makeService();

        const versionsService = new PlanVersionsService(repo, null, { strictModeCheckMode: 'warn-only' });
        const created = await service.createPlan({
            projectKey: 'vereinsfux',
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

    test('hardDeletePlan: mit published Version → 422 PLAN_HAS_PUBLISHED_VERSIONS', async () => {
        const { service, repo } = makeService();

        const versionsService = new PlanVersionsService(repo, null, { strictModeCheckMode: 'warn-only' });
        const created = await service.createPlan({
            projectKey: 'vereinsfux',
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
            allowZeroPrice: true, // Setup-Drafts nutzen 0,00-Platzhalterpreise
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

    test('hardDeletePlan: NotFound bei unbekannter ID', async () => {
        const { service } = makeService();
        await assert.rejects(
            () => service.hardDeletePlan('not-existing'),
            (err) => {
                assert.equal(err.status, 404);
                return true;
            },
        );
    });

    test('listPlans: scoped pro projectKey', async () => {
        const { service } = makeService();
        await service.createPlan({
            projectKey: 'vereinsfux',
            planKey: 'A',
            label: 'A',
        });
        await service.createPlan({
            projectKey: 'autohauspro',
            planKey: 'B',
            label: 'B',
        });
        const v = await service.listPlans('vereinsfux');
        const c = await service.listPlans('autohauspro');
        assert.equal(v.length, 1);
        assert.equal(c.length, 1);
        assert.equal(v[0].planKey, 'A');
        assert.equal(c[0].planKey, 'B');
    });

    test('listPlans onlyPublished: nur Pläne mit live Version', async () => {
        const { service, repo } = makeService();
        const versionsService = new PlanVersionsService(repo, null, { strictModeCheckMode: 'warn-only' });

        // Plan mit published Version.
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
            allowZeroPrice: true, // Setup-Drafts nutzen 0,00-Platzhalterpreise
            validFrom: '2026-01-01',
        });

        // Plan nur als Draft (keine live Version).
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

    test('listPlans onlyPublished: superseded Version zählt nicht als live', async () => {
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
            allowZeroPrice: true, // Setup-Drafts nutzen 0,00-Platzhalterpreise
            validFrom: '2026-01-01',
        });
        const v2 = await versionsService.createPlanDraft({
            planId: plan.id,
            features: ['A', 'B'],
            quotas: {},
            monthlyNet: '0.00',
            yearlyNet: '0.00',
        });
        // Supersedet v1; v2 ist jetzt die live Version → Plan bleibt published.
        await versionsService.publishPlanVersion(v2.planVersion.id, {
            publishedByUserId: null,
            allowZeroPrice: true, // Setup-Drafts nutzen 0,00-Platzhalterpreise
            validFrom: '2026-06-01',
        });

        const published = await service.listPlans(PROJECT, { onlyPublished: true });
        assert.equal(published.length, 1);
        assert.equal(published[0].planKey, 'SUPERSEDED_ONLY');
    });
});
