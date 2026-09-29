import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    catalogVersionAlreadyPublished,
    catalogVersionGone,
    isPersistenceRefusal,
} from '@saasicat/core';
import { BundlesService, PlanVersionsService, PlansService } from '../dist/catalog/index.js';
import { FakeBundleRepository, FakePlanRepository } from '../dist/testing/index.js';

// Two operators, or one double click, pass the service's own check before
// either writes; the adapter's claim is what decides. These cases stage exactly
// that: the draft is unpublished when the service looks, and the adapter
// refuses because somebody got there first. The loser has to read the answer
// the check gives a request that arrives a moment later — the same status and
// code — not a 500.

const FUTURE = '2099-01-01';

async function aPlanDraft() {
    const repo = new FakePlanRepository();
    const plans = new PlansService(repo);
    const versions = new PlanVersionsService(repo, null, { strictModeCheckMode: 'warn-only' });
    const plan = await plans.createPlan({ planKey: 'STARTER', label: 'Starter' });
    const { planVersion } = await versions.createPlanDraft({
        planId: plan.id,
        features: ['A'],
        quotas: {},
        monthlyNet: '5.00',
        yearlyNet: '50.00',
    });
    return { repo, versions, draft: planVersion };
}

async function aBundleDraft() {
    const repo = new FakeBundleRepository();
    const bundles = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' });
    const bundle = await bundles.createBundle({ bundleKey: 'BANKING', label: 'Banking' });
    const { bundleVersion } = await bundles.createBundleDraft({
        bundleId: bundle.id,
        monthlyNet: '9.90',
        features: ['A'],
    });
    return { repo, bundles, draft: bundleVersion };
}

/** An `assert.rejects` validator for the answer the service's check gives. */
function answeredWith(status, code) {
    return (error) => {
        assert.equal(error.getStatus?.(), status);
        assert.equal(error.getResponse().code, code);
        return true;
    };
}

// @requirement SC-PLAN-019 — Two operators cannot publish the same draft
describe('the operator who publishes second', () => {
    test('is told the plan version is already published', async () => {
        const { repo, versions, draft } = await aPlanDraft();
        repo.publishPlanVersionDraft = async (id) => {
            throw catalogVersionAlreadyPublished('PlanVersion', id);
        };

        await assert.rejects(
            () =>
                versions.publishPlanVersion(draft.id, {
                    publishedByUserId: null,
                    validFrom: FUTURE,
                }),
            answeredWith(422, 'PLAN_VERSION_ALREADY_PUBLISHED'),
        );
    });

    test('is told the add-on version is already published', async () => {
        const { repo, bundles, draft } = await aBundleDraft();
        repo.publishDraft = async (id) => {
            throw catalogVersionAlreadyPublished('BundleVersion', id);
        };

        await assert.rejects(
            () =>
                bundles.publishBundleVersion(draft.id, {
                    publishedByUserId: null,
                    validFrom: FUTURE,
                }),
            answeredWith(422, 'BUNDLE_VERSION_ALREADY_PUBLISHED'),
        );
    });

    test('is told a version that went meanwhile is not found', async () => {
        const { repo, versions, draft } = await aPlanDraft();
        repo.publishPlanVersionDraft = async (id) => {
            throw catalogVersionGone('PlanVersion', id);
        };

        await assert.rejects(
            () =>
                versions.publishPlanVersion(draft.id, {
                    publishedByUserId: null,
                    validFrom: FUTURE,
                }),
            answeredWith(404, 'PLAN_VERSION_NOT_FOUND'),
        );
    });

    test('an adapter failure that is no refusal still reaches the caller as it was', async () => {
        const { repo, versions, draft } = await aPlanDraft();
        const failure = new Error('connection reset');
        repo.publishPlanVersionDraft = async () => {
            throw failure;
        };

        await assert.rejects(
            () =>
                versions.publishPlanVersion(draft.id, {
                    publishedByUserId: null,
                    validFrom: FUTURE,
                }),
            (error) => error === failure,
        );
    });
});

// @requirement SC-PLAN-004 — A published version is never deleted
describe('the operator who discards a draft somebody just published', () => {
    test('is told the plan version is already published', async () => {
        const { repo, versions, draft } = await aPlanDraft();
        repo.deletePlanVersionDraft = async (id) => {
            throw catalogVersionAlreadyPublished('PlanVersion', id);
        };

        await assert.rejects(
            () => versions.discardPlanDraft(draft.id),
            answeredWith(422, 'PLAN_VERSION_ALREADY_PUBLISHED'),
        );
    });

    test('is told the add-on version is already published', async () => {
        const { repo, bundles, draft } = await aBundleDraft();
        repo.deleteDraft = async (id) => {
            throw catalogVersionAlreadyPublished('BundleVersion', id);
        };

        await assert.rejects(
            () => bundles.discardBundleDraft(draft.id),
            answeredWith(422, 'BUNDLE_VERSION_ALREADY_PUBLISHED'),
        );
    });
});

// The fakes `@saasicat/nest/testing` ships stand in for an adapter in a
// consumer's tests. Where they refused differently — or published a draft a
// second time — a test of the race path would pass against a shape no shipped
// adapter has.
describe('the shipped test fakes refuse as the adapters do', () => {
    test('a plan version published once is refused the second time, by code', async () => {
        const { repo, draft } = await aPlanDraft();
        const publish = () =>
            repo.publishPlanVersionDraft(draft.id, {
                publishedByUserId: 'first',
                publishedChanges: [],
                nonRegressive: true,
                validFrom: new Date(FUTURE),
                validUntil: null,
            });
        await publish();

        await assert.rejects(publish, refusedAs('PLAN_VERSION_ALREADY_PUBLISHED'));
        await assert.rejects(
            () => repo.deletePlanVersionDraft(draft.id),
            refusedAs('PLAN_VERSION_ALREADY_PUBLISHED'),
        );
        await assert.rejects(
            () =>
                repo.publishPlanVersionDraft('no-such-version', {
                    publishedByUserId: null,
                    publishedChanges: [],
                    nonRegressive: true,
                    validFrom: new Date(FUTURE),
                    validUntil: null,
                }),
            refusedAs('PLAN_VERSION_NOT_FOUND'),
        );
    });

    test('so is an add-on version', async () => {
        const { repo, draft } = await aBundleDraft();
        const publish = () =>
            repo.publishDraft(draft.id, {
                publishedByUserId: null,
                publishedChanges: [],
                nonRegressive: true,
                validFrom: new Date(FUTURE),
                validUntil: null,
            });
        await publish();

        await assert.rejects(publish, refusedAs('BUNDLE_VERSION_ALREADY_PUBLISHED'));
        await assert.rejects(
            () => repo.deleteDraft(draft.id),
            refusedAs('BUNDLE_VERSION_ALREADY_PUBLISHED'),
        );
    });
});

function refusedAs(code) {
    return (error) => {
        assert.ok(isPersistenceRefusal(error), `a PersistenceRefusal, not ${String(error)}`);
        assert.equal(error.code, code);
        return true;
    };
}
