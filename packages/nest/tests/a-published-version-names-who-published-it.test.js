// A version that reaches customers names the operator who made it so: the
// version row carries the publisher, and the audit log carries the action with
// who, from where and when. The same holds for ending a plan version and for
// the author of a draft. Controllers are instantiated directly — they map a
// request onto a service call and an audit entry, and that mapping is what is
// asserted here; how the actor is derived from a request is `WebAuditLogger`'s
// and tested with it.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { UnprocessableEntityException } from '@nestjs/common';

import {
    buildBundlesController,
    buildBundleVersionsController,
    buildPlansController,
    buildPlanVersionsController,
} from '../dist/catalog/index.js';
import { PLATFORM_CORE_MANIFEST_CONTRIBUTION } from '../dist/admin/index.js';

const VERSION_ID = '00000000-0000-0000-0000-000000000001';
const PARENT_ID = '00000000-0000-0000-0000-000000000002';
const OPERATOR = { sub: 'operator-1', email: 'operator@example.test' };

/** A request as the operator's session leaves it. */
const signedIn = (user = OPERATOR) => ({ user, headers: {} });

/** The audit helper, as the catalog module provides it, recording what it was asked. */
function fakeAudit() {
    return {
        logged: [],
        resolveUserId(req) {
            return req.user?.sub ?? null;
        },
        async logFromRequest(req, entity, entityId, action, changes) {
            this.logged.push({ userId: req.user?.sub, entity, entityId, action, changes });
        },
    };
}

/** A service that answers each named method with `answer`, recording its arguments. */
function fakeService(answers) {
    const calls = {};
    const service = {};
    for (const [method, answer] of Object.entries(answers)) {
        service[method] = async (...args) => {
            calls[method] = args;
            if (answer instanceof Error) throw answer;
            return answer;
        };
    }
    return { service, calls };
}

const PUBLISHED_PLAN = {
    id: VERSION_ID,
    planId: 'STARTER',
    version: 3,
    validFrom: '2026-12-01T00:00:00.000Z',
    validUntil: null,
    nonRegressive: false,
    endsAt: null,
};

const PUBLISHED_BUNDLE = {
    id: VERSION_ID,
    bundleKey: 'EXTRA_STORAGE',
    version: 2,
    validFrom: '2026-12-01T00:00:00.000Z',
    validUntil: null,
    nonRegressive: true,
};

// @requirement SC-AUD-001 — Every administrative action records who did it, from where, and when
describe('publishing and ending a version names who did it', () => {
    test('a plan version records its publisher and is audited with what was chosen', async () => {
        const audit = fakeAudit();
        const { service, calls } = fakeService({
            publishPlanVersion: { planVersion: PUBLISHED_PLAN, warnings: [] },
        });
        const Controller = buildPlanVersionsController([]);
        const controller = new Controller(service, audit);

        await controller.publish(
            VERSION_ID,
            { validFrom: '2026-12-01', forceRegressive: true },
            signedIn(),
        );

        assert.equal(calls.publishPlanVersion[1].publishedByUserId, 'operator-1');
        assert.deepEqual(audit.logged, [
            {
                userId: 'operator-1',
                entity: 'PlanVersion',
                entityId: VERSION_ID,
                action: 'PLAN_VERSION_PUBLISH',
                changes: {
                    planId: 'STARTER',
                    version: 3,
                    validFrom: '2026-12-01T00:00:00.000Z',
                    validUntil: null,
                    nonRegressive: false,
                    forceRegressive: true,
                    allowZeroPrice: false,
                },
            },
        ]);
    });

    test('an add-on version records its publisher and is audited with what was chosen', async () => {
        const audit = fakeAudit();
        const { service, calls } = fakeService({
            publishBundleVersion: { bundleVersion: PUBLISHED_BUNDLE, warnings: [] },
        });
        const Controller = buildBundleVersionsController([]);
        const controller = new Controller(service, audit);

        await controller.publish(
            VERSION_ID,
            { validFrom: '2026-12-01', allowZeroPrice: true },
            signedIn(),
        );

        assert.equal(calls.publishBundleVersion[1].publishedByUserId, 'operator-1');
        assert.deepEqual(audit.logged, [
            {
                userId: 'operator-1',
                entity: 'BundleVersion',
                entityId: VERSION_ID,
                action: 'BUNDLE_VERSION_PUBLISH',
                changes: {
                    bundleKey: 'EXTRA_STORAGE',
                    version: 2,
                    validFrom: '2026-12-01T00:00:00.000Z',
                    validUntil: null,
                    nonRegressive: true,
                    forceRegressive: false,
                    allowZeroPrice: true,
                },
            },
        ]);
    });

    test('ending a plan version is audited with the day it ends and the end it replaced', async () => {
        const audit = fakeAudit();
        const before = { ...PUBLISHED_PLAN, endsAt: '2027-06-30T00:00:00.000Z' };
        const ended = { ...PUBLISHED_PLAN, endsAt: '2027-03-31T00:00:00.000Z' };
        const { service, calls } = fakeService({
            getPlanVersion: before,
            terminatePlanVersion: ended,
        });
        const Controller = buildPlanVersionsController([]);
        const controller = new Controller(service, audit);

        await controller.terminate(VERSION_ID, { endsAt: '2027-03-31' }, signedIn());

        assert.equal(calls.terminatePlanVersion[0], VERSION_ID);
        assert.deepEqual(audit.logged, [
            {
                userId: 'operator-1',
                entity: 'PlanVersion',
                entityId: VERSION_ID,
                action: 'PLAN_VERSION_TERMINATE',
                changes: {
                    planId: 'STARTER',
                    version: 3,
                    endsAt: '2027-03-31T00:00:00.000Z',
                    previousEndsAt: '2027-06-30T00:00:00.000Z',
                },
            },
        ]);
    });

    test('a refused publish or end leaves no audit entry behind', async () => {
        const refusal = new UnprocessableEntityException({ code: 'PLAN_VERSION_NOT_DRAFT' });
        const cases = [
            [
                buildPlanVersionsController,
                'publishPlanVersion',
                (c) => c.publish(VERSION_ID, {}, signedIn()),
            ],
            [
                buildBundleVersionsController,
                'publishBundleVersion',
                (c) => c.publish(VERSION_ID, {}, signedIn()),
            ],
            [
                buildPlanVersionsController,
                'terminatePlanVersion',
                (c) => c.terminate(VERSION_ID, { endsAt: '2027-03-31' }, signedIn()),
            ],
        ];
        for (const [build, method, act] of cases) {
            const audit = fakeAudit();
            const { service } = fakeService({ getPlanVersion: PUBLISHED_PLAN, [method]: refusal });
            const Controller = build([]);
            await assert.rejects(act(new Controller(service, audit)), refusal);
            assert.deepEqual(
                audit.logged,
                [],
                `${method}: nothing happened, so nothing is audited`,
            );
        }
    });

    test('without a signed-in user the publisher stays empty rather than invented', async () => {
        const audit = fakeAudit();
        const { service, calls } = fakeService({
            publishPlanVersion: { planVersion: PUBLISHED_PLAN, warnings: [] },
        });
        const Controller = buildPlanVersionsController([]);
        await new Controller(service, audit).publish(VERSION_ID, {}, { headers: {} });

        assert.equal(calls.publishPlanVersion[1].publishedByUserId, null);
    });
});

// @requirement SC-AUD-001 — Every administrative action records who did it, from where, and when
describe('a draft names who started it', () => {
    test('for a plan', async () => {
        const audit = fakeAudit();
        const { service, calls } = fakeService({ createPlanDraft: { planVersion: {} } });
        const Controller = buildPlansController([]);
        const controller = new Controller({}, service, audit);

        await controller.createDraft(PARENT_ID, { features: [], quotas: {} }, signedIn());

        assert.equal(calls.createPlanDraft[0].createdByUserId, 'operator-1');
    });

    test('for an add-on', async () => {
        const audit = fakeAudit();
        const { service, calls } = fakeService({ createBundleDraft: { bundleVersion: {} } });
        const Controller = buildBundlesController([]);
        const controller = new Controller(service, audit);

        await controller.createDraft(PARENT_ID, { features: [], quotas: {} }, signedIn());

        assert.equal(calls.createBundleDraft[0].createdByUserId, 'operator-1');
    });
});

describe('the audit page can name every action these routes write', () => {
    test('each one is declared with a label', () => {
        const declared = new Map(
            PLATFORM_CORE_MANIFEST_CONTRIBUTION.audit.actions.map((a) => [a.key, a.label]),
        );
        for (const key of [
            'PLAN_VERSION_PUBLISH',
            'PLAN_VERSION_TERMINATE',
            'BUNDLE_VERSION_PUBLISH',
        ]) {
            assert.ok(declared.get(key), `${key} is written but the manifest does not declare it`);
        }
    });
});
