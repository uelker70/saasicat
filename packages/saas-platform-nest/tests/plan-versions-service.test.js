import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PlanVersionsService, PlansService } from '../dist/catalog/index.js';
import { FakePlanRepository, FakeSubscriptionRepository } from '../dist/testing/index.js';

// PlanVersionsService — PlanVersion-Lifecycle (SPEC_V2 §11.1 M6 Pack 2a).
// Strict-Mode-Check ist in Pack 2a inactive (`warnings` ist immer leer);
// kommt mit Pack 2c.

const PROJECT = 'clubapp';

async function setupWithPlan(planKey = 'STARTER', subscriptions = null) {
    const repo = new FakePlanRepository();
    const stem = new PlansService(repo);
    const versions = new PlanVersionsService(repo, null, { strictModeCheckMode: 'warn-only' }, subscriptions);
    const plan = await stem.createPlan({
        projectKey: PROJECT,
        planKey,
        label: planKey,
    });
    return { repo, stem, versions, plan, subscriptions };
}

describe('PlanVersionsService — Lifecycle', () => {
    test('createPlanDraft + listPlanVersions liefert v1 mit publishedAt=null', async () => {
        const { versions, plan } = await setupWithPlan();
        const result = await versions.createPlanDraft({
            planId: plan.id,
            features: ['MEMBER_MGMT'],
            quotas: { members: 100 },
            monthlyNet: '9.90',
            yearlyNet: '99.00',
            changeNote: 'Initial v1',
        });
        assert.equal(result.planVersion.version, 1);
        assert.equal(result.planVersion.publishedAt, null);
        assert.equal(result.planVersion.planId, 'STARTER');
        assert.deepEqual(result.warnings, []);

        const list = await versions.listPlanVersions(plan.id);
        assert.equal(list.length, 1);
        assert.equal(list[0].id, result.planVersion.id);
    });

    test('createPlanDraft: zweite Draft → UnprocessableEntity (max 1 Draft)', async () => {
        const { versions, plan } = await setupWithPlan();
        await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await assert.rejects(
            () =>
                versions.createPlanDraft({
                    planId: plan.id,
                    features: ['B'],
                    quotas: {},
                    monthlyNet: '6.00',
                    yearlyNet: '60.00',
                }),
            (err) => {
                assert.equal(err.status, 422);
                return true;
            },
        );
    });

    test('createPlanDraft: unbekannter Plan → NotFound', async () => {
        const { versions } = await setupWithPlan();
        await assert.rejects(
            () =>
                versions.createPlanDraft({
                    planId: 'not-existing-uuid',
                    features: [],
                    quotas: {},
                    monthlyNet: '1.00',
                    yearlyNet: '10.00',
                }),
            (err) => {
                assert.equal(err.status, 404);
                return true;
            },
        );
    });

    test('updatePlanDraft: ändert features + quotas', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: { members: 50 },
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        const updated = await versions.updatePlanDraft(draft.planVersion.id, {
            features: ['A', 'B'],
            quotas: { members: 100 },
            monthlyNet: '7.00',
        });
        assert.deepEqual(updated.planVersion.features, ['A', 'B']);
        assert.equal(updated.planVersion.quotas.members, 100);
        assert.equal(updated.planVersion.monthlyNet, '7.00');
    });

    test('createPlanDraft: bundles default auf [] wenn nicht geliefert', async () => {
        const { versions, plan } = await setupWithPlan();
        const result = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        assert.deepEqual(result.planVersion.bundles, []);
    });

    test('createPlanDraft + updatePlanDraft: bundles werden persistiert', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A', 'B'],
            bundles: ['COMMUNICATION_PRO'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        assert.deepEqual(draft.planVersion.bundles, ['COMMUNICATION_PRO']);

        const updated = await versions.updatePlanDraft(draft.planVersion.id, {
            bundles: ['COMMUNICATION_PRO', 'FINANCE_PLUS'],
        });
        assert.deepEqual(updated.planVersion.bundles, ['COMMUNICATION_PRO', 'FINANCE_PLUS']);
        // features bleiben unverändert, wenn nur bundles geliefert werden
        assert.deepEqual(updated.planVersion.features, ['A', 'B']);

        const list = await versions.listPlanVersions(plan.id);
        assert.deepEqual(list[0].bundles, ['COMMUNICATION_PRO', 'FINANCE_PLUS']);
    });

    test('updatePlanDraft: published Version → UnprocessableEntity', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: [],
            quotas: {},
            monthlyNet: '1.00',
            yearlyNet: '10.00',
        });
        await versions.publishPlanVersion(draft.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        await assert.rejects(
            () =>
                versions.updatePlanDraft(draft.planVersion.id, {
                    features: ['NEW'],
                }),
            (err) => {
                assert.equal(err.status, 422);
                return true;
            },
        );
    });

    test('publishPlanVersion: erste Version → publishedAt + nonRegressive=true', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        const published = await versions.publishPlanVersion(draft.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        assert.notEqual(published.planVersion.publishedAt, null);
        assert.equal(published.planVersion.nonRegressive, true);
        assert.equal(published.planVersion.validFrom?.slice(0, 10), '2026-01-01');
    });

    test('publishPlanVersion: Preis 0,00 → 422 PLAN_VERSION_ZERO_PRICE (Seed-Platzhalter-Schutz)', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '0.00',
            yearlyNet: '0.00',
        });
        await assert.rejects(
            () =>
                versions.publishPlanVersion(draft.planVersion.id, {
                    publishedByUserId: null,
                    validFrom: '2026-01-01',
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response.code, 'PLAN_VERSION_ZERO_PRICE');
                return true;
            },
        );
        // allowZeroPrice erlaubt den Sonderfall (z.B. ENTERPRISE):
        const published = await versions.publishPlanVersion(draft.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
            allowZeroPrice: true,
        });
        assert.notEqual(published.planVersion.publishedAt, null);
    });

    test('publishPlanVersion: zweite Version setzt vorherige auf supersededAt', async () => {
        const { versions, plan } = await setupWithPlan();
        // v1 → publish
        const v1 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(v1.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        // v2 (additiv → nonRegressive)
        const v2 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A', 'B'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
            changeNote: 'Add B',
        });
        const published2 = await versions.publishPlanVersion(v2.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-06-01',
        });
        assert.notEqual(published2.planVersion.publishedAt, null);

        const list = await versions.listPlanVersions(plan.id);
        const v1After = list.find((v) => v.id === v1.planVersion.id);
        assert.notEqual(v1After.supersededAt, null, 'v1 muss superseded sein');
        // Auto-Sukzession: validUntil(v1) = validFrom(v2) - 1 Tag = 2026-05-31.
        assert.equal(v1After.validUntil?.slice(0, 10), '2026-05-31');
        const v2After = list.find((v) => v.id === v2.planVersion.id);
        assert.equal(v2After.supersededAt, null, 'v2 muss live sein');
        assert.equal(v2After.validUntil, null, 'v2 ist letzte Version → unbegrenzt');
    });

    test('publishPlanVersion: validFrom muss strikt nach Vorgänger liegen → 422', async () => {
        const { versions, plan } = await setupWithPlan();
        const v1 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(v1.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-06-01',
        });
        const v2 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A', 'B'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
            changeNote: 'Add B',
        });
        await assert.rejects(
            () =>
                versions.publishPlanVersion(v2.planVersion.id, {
                    publishedByUserId: null,
                    validFrom: '2026-06-01', // == Vorgänger, nicht strikt nach
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'PLAN_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS');
                return true;
            },
        );
    });

    test('publishPlanVersion: ohne validFrom → 422 PLAN_VERSION_VALID_FROM_REQUIRED', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await assert.rejects(
            () =>
                versions.publishPlanVersion(draft.planVersion.id, {
                    publishedByUserId: null,
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'PLAN_VERSION_VALID_FROM_REQUIRED');
                return true;
            },
        );
    });

    test('publishPlanVersion: regressive Version (Feature entfernt) → 422 ohne forceRegressive', async () => {
        const { versions, plan } = await setupWithPlan();
        const v1 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A', 'B'],
            quotas: { users: 10 },
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(v1.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        // v2 ohne Feature B → regressiv
        const v2 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: { users: 10 },
            monthlyNet: '5.00',
            yearlyNet: '50.00',
            changeNote: 'Remove B',
        });
        await assert.rejects(
            () =>
                versions.publishPlanVersion(v2.planVersion.id, {
                    publishedByUserId: null,
                    validFrom: '2026-06-01',
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'PLAN_VERSION_REGRESSION');
                return true;
            },
        );
    });

    test('publishPlanVersion: forceRegressive lässt regressive Version durch', async () => {
        const { versions, plan } = await setupWithPlan();
        const v1 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A', 'B'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(v1.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        const v2 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
            changeNote: 'Force-Remove B',
        });
        const published = await versions.publishPlanVersion(v2.planVersion.id, {
            publishedByUserId: null,
            forceRegressive: true,
            validFrom: '2026-06-01',
        });
        assert.notEqual(published.planVersion.publishedAt, null);
        // changes-Liste enthält das removed Feature
        assert.ok(
            (published.planVersion.publishedChanges ?? []).length > 0,
            'publishedChanges sollte den Diff enthalten',
        );
    });

    test('getPlanVersion: NotFound bei unbekannter ID', async () => {
        const { versions } = await setupWithPlan();
        await assert.rejects(
            () => versions.getPlanVersion('not-existing'),
            (err) => {
                assert.equal(err.status, 404);
                return true;
            },
        );
    });

    test('discardPlanDraft: Draft → entfernt, listPlanVersions liefert leere Liste', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.discardPlanDraft(draft.planVersion.id);
        const list = await versions.listPlanVersions(plan.id);
        assert.equal(list.length, 0);
    });

    test('discardPlanDraft: published Version → 422 PLAN_VERSION_ALREADY_PUBLISHED', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(draft.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        await assert.rejects(
            () => versions.discardPlanDraft(draft.planVersion.id),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response.code, 'PLAN_VERSION_ALREADY_PUBLISHED');
                return true;
            },
        );
    });

    test('discardPlanDraft: NotFound bei unbekannter ID', async () => {
        const { versions } = await setupWithPlan();
        await assert.rejects(
            () => versions.discardPlanDraft('00000000-0000-0000-0000-000000000000'),
            (err) => {
                assert.equal(err.status, 404);
                return true;
            },
        );
    });

    // ── SPEC_V2 §4.2.1 Regel 3 — lückenlose Sukzession ──
    test('publishPlanVersion: gapless wenn Vorgänger validUntil hat — Nachfolger muss am Folgetag starten', async () => {
        const { versions, plan } = await setupWithPlan();
        const v1 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(v1.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
            validUntil: '2026-05-31',
        });
        const v2 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A', 'B'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        // 2026-06-15 hinterlässt 14-Tage-Lücke — muss blockiert werden.
        await assert.rejects(
            () =>
                versions.publishPlanVersion(v2.planVersion.id, {
                    publishedByUserId: null,
                    validFrom: '2026-06-15',
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response.code, 'PLAN_VERSION_VALID_FROM_NOT_GAPLESS');
                assert.equal(err.response.requiredValidFrom, '2026-06-01');
                return true;
            },
        );
        // 2026-06-01 ist der korrekte nahtlose Anschluss.
        const published = await versions.publishPlanVersion(v2.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-06-01',
        });
        assert.equal(published.planVersion.validFrom?.slice(0, 10), '2026-06-01');
    });

    // ── terminate (Plan-Version mit endsAt beenden) ──
    test('terminatePlanVersion: live Version bekommt endsAt gesetzt', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(draft.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const terminated = await versions.terminatePlanVersion(draft.planVersion.id, future);
        assert.equal(terminated.endsAt, future.toISOString());
        // supersededAt darf NICHT gesetzt sein (kein Auto-Sukzessions-Pfad).
        assert.equal(terminated.supersededAt, null);
        assert.notEqual(terminated.publishedAt, null);
    });

    test('terminatePlanVersion: idempotent — zweiter Aufruf überschreibt', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(draft.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        const future1 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const future2 = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
        await versions.terminatePlanVersion(draft.planVersion.id, future1);
        const second = await versions.terminatePlanVersion(draft.planVersion.id, future2);
        assert.equal(second.endsAt, future2.toISOString());
    });

    test('terminatePlanVersion: Datum in Vergangenheit → 422 PLAN_TERMINATE_DATE_NOT_FUTURE', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(draft.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        const past = new Date(Date.now() - 60 * 1000);
        await assert.rejects(
            () => versions.terminatePlanVersion(draft.planVersion.id, past),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response.code, 'PLAN_TERMINATE_DATE_NOT_FUTURE');
                return true;
            },
        );
    });

    test('terminatePlanVersion: Draft (publishedAt=null) → 422 PLAN_VERSION_NOT_LIVE', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await assert.rejects(
            () => versions.terminatePlanVersion(draft.planVersion.id, future),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response.code, 'PLAN_VERSION_NOT_LIVE');
                return true;
            },
        );
    });

    test('terminatePlanVersion: superseded Version → 422 PLAN_VERSION_NOT_LIVE', async () => {
        const { versions, plan } = await setupWithPlan();
        const v1 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(v1.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        const v2 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A', 'B'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(v2.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-06-01',
        });
        // v1 ist jetzt superseded.
        const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await assert.rejects(
            () => versions.terminatePlanVersion(v1.planVersion.id, future),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response.code, 'PLAN_VERSION_NOT_LIVE');
                return true;
            },
        );
    });

    test('terminatePlanVersion: NotFound bei unbekannter ID', async () => {
        const { versions } = await setupWithPlan();
        const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await assert.rejects(
            () => versions.terminatePlanVersion('not-existing', future),
            (err) => {
                assert.equal(err.status, 404);
                return true;
            },
        );
    });

    test('publishPlanVersion: gapless-Check nicht aktiv, wenn Vorgänger kein validUntil hat (auto-Sukzession)', async () => {
        const { versions, plan } = await setupWithPlan();
        const v1 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(v1.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
            // kein validUntil → null
        });
        const v2 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A', 'B'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        // Beliebige Lücke ist erlaubt; Auto-Sukzession setzt
        // v1.validUntil = v2.validFrom - 1 Tag.
        const published = await versions.publishPlanVersion(v2.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-09-15',
        });
        assert.equal(published.planVersion.validFrom?.slice(0, 10), '2026-09-15');
    });
});

describe('PlanVersionsService — published-but-future editing (Pack 2c)', () => {
    // Tag in der fernen Zukunft, damit Tests unabhängig vom Real-Datum
    // immer im „validFrom > now"-Bereich landen.
    const FUTURE = '2099-01-01';
    const FUTURE_NEXT = '2099-06-01';

    test('updatePlanDraft erlaubt published-but-future Version (latest, 0 Subs)', async () => {
        const subs = new FakeSubscriptionRepository();
        const { versions, plan } = await setupWithPlan('STARTER', subs);
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: { users: 10 },
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        const published = await versions.publishPlanVersion(draft.planVersion.id, {
            publishedByUserId: null,
            validFrom: FUTURE,
        });
        // 0 Subs → editierbar trotz publishedAt != null
        const updated = await versions.updatePlanDraft(published.planVersion.id, {
            monthlyNet: '6.00',
        });
        assert.equal(updated.planVersion.monthlyNet, '6.00');
        assert.notEqual(updated.planVersion.publishedAt, null, 'published-Status bleibt erhalten');
    });

    test('updatePlanDraft blockt published-but-future Version mit Subscription', async () => {
        const subs = new FakeSubscriptionRepository();
        const { versions, plan } = await setupWithPlan('STARTER', subs);
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        const published = await versions.publishPlanVersion(draft.planVersion.id, {
            publishedByUserId: null,
            validFrom: FUTURE,
        });
        subs.setPlanVersionCount(published.planVersion.id, 1);
        await assert.rejects(
            () => versions.updatePlanDraft(published.planVersion.id, { monthlyNet: '7.00' }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'PLAN_VERSION_NOT_EDITABLE');
                return true;
            },
        );
    });

    test('updatePlanDraft blockt published Version, die nicht latest-in-chain ist', async () => {
        const subs = new FakeSubscriptionRepository();
        const { versions, plan } = await setupWithPlan('STARTER', subs);
        const v1 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        const v1Published = await versions.publishPlanVersion(v1.planVersion.id, {
            publishedByUserId: null,
            validFrom: FUTURE,
        });
        const v2 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A', 'B'],
            quotas: {},
            // Preis und Features additiv → nonRegressive, kein
            // forceRegressive nötig (Pack 2c Vertrags-Diff).
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(v2.planVersion.id, {
            publishedByUserId: null,
            validFrom: FUTURE_NEXT,
        });
        // v1 ist published-future-active aber NICHT latest-in-chain
        // (v2 ist drüber) → muss eingefroren bleiben, sonst werden v2 +
        // dessen Diff zu v1 inkonsistent.
        await assert.rejects(
            () => versions.updatePlanDraft(v1Published.planVersion.id, { monthlyNet: '8.00' }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'PLAN_VERSION_NOT_EDITABLE');
                return true;
            },
        );
    });

    test('listPlanVersions annotiert isLatestInChain + subscriptionCount auf der letzten Version', async () => {
        const subs = new FakeSubscriptionRepository();
        const { versions, plan } = await setupWithPlan('STARTER', subs);
        const v1 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        const v1Published = await versions.publishPlanVersion(v1.planVersion.id, {
            publishedByUserId: null,
            validFrom: FUTURE,
        });
        subs.setPlanVersionCount(v1Published.planVersion.id, 3);

        const list = await versions.listPlanVersions(plan.id);
        const v1Row = list.find((v) => v.id === v1Published.planVersion.id);
        assert.equal(v1Row.isLatestInChain, true);
        assert.equal(v1Row.subscriptionCount, 3);
    });

    test('updatePlanDraft fail-closed ohne SubscriptionRepository', async () => {
        // Ohne registriertes SubscriptionRepository soll der Service eine
        // published-but-future Version NICHT editierbar machen — sonst
        // schmuggelt sich eine produktive Konfiguration vorbei.
        const { versions, plan } = await setupWithPlan('STARTER');
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        const published = await versions.publishPlanVersion(draft.planVersion.id, {
            publishedByUserId: null,
            validFrom: FUTURE,
        });
        await assert.rejects(
            () => versions.updatePlanDraft(published.planVersion.id, { monthlyNet: '6.00' }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'PLAN_VERSION_NOT_EDITABLE');
                return true;
            },
        );
    });
});
