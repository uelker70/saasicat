// The plan catalogue as an operator uses it, and the tenant writes beside it.
//
// The shared persistence contract publishes twice and checks the validity
// window. That leaves most of both repositories unvisited: listing what is on
// sale, renaming a plan, retiring one, numbering the next draft, refusing to
// edit a version somebody already published, scheduling a change, accepting a
// pending version twice, and cancelling twice. Every one of those is something
// a person does, and each has a wrong answer worth pinning as well as a right
// one.
//
// Requires SAASICAT_TEST_DATABASE_URL pointing at a DISPOSABLE database.

import { after, before, beforeEach, describe, test } from 'node:test';
import { eq } from 'drizzle-orm';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
    DrizzlePlanRepository,
    DrizzleTenantSubscriptionWrite,
    saasicatSchema,
} from '../../dist/index.js';
import { openDisposableDatabase } from './support/disposable-database.mjs';

const PROJECT = 'plan-catalogue-probe';
const OTHER_PROJECT = 'someone-elses-project';

let pool;
let db;
let plans;
let tenantWrite;

before(async () => {
    ({ pool, db } = await openDisposableDatabase({ max: 4 }));
    plans = new DrizzlePlanRepository(db, { validityWindows: true });
    tenantWrite = new DrizzleTenantSubscriptionWrite(db);
});

after(async () => {
    await pool.end();
});

beforeEach(async () => {
    await pool.query('TRUNCATE TABLE subscriptions, plan_versions, plans RESTART IDENTITY CASCADE');
});

const createPlan = (overrides = {}) =>
    plans.create({
        projectKey: PROJECT,
        planKey: `STANDARD_${randomUUID().slice(0, 8)}`,
        label: 'Standard',
        ...overrides,
    });

const draftFor = (planKey, overrides = {}) =>
    plans.createPlanVersionDraft({
        planId: planKey,
        features: ['CORE'],
        quotas: { users: 5 },
        monthlyNet: '19.90',
        yearlyNet: '199.00',
        ...overrides,
    });

const publish = (versionId, validFrom) =>
    plans.publishPlanVersionDraft(versionId, {
        publishedByUserId: null,
        publishedChanges: [],
        nonRegressive: true,
        validFrom,
        validUntil: null,
    });

describe('the plans an operator has on sale', () => {
    test('a plan is found by its key, and only inside its own project', async () => {
        const plan = await createPlan();
        assert.equal((await plans.findByKey(PROJECT, plan.planKey))?.id, plan.id);
        // The same key in another project is a different plan. Answering with
        // this one would leak one tenant's catalogue into another's.
        assert.equal(await plans.findByKey(OTHER_PROJECT, plan.planKey), null);
    });

    test('listing is ordered by sort order, then by key', async () => {
        const late = await createPlan({ planKey: 'AAA', sortOrder: 9, label: 'Sorted last' });
        const early = await createPlan({ planKey: 'ZZZ', sortOrder: 1, label: 'Sorted first' });
        const listed = await plans.list({ projectKey: PROJECT });
        assert.deepEqual(
            listed.map((row) => row.id),
            [early.id, late.id],
        );
    });

    test('a retired plan drops out of the list, and comes back when asked for', async () => {
        const plan = await createPlan();
        await plans.softDelete(plan.id);
        assert.deepEqual(await plans.list({ projectKey: PROJECT }), []);
        assert.deepEqual(
            (await plans.list({ projectKey: PROJECT, excludeDeleted: false })).map((r) => r.id),
            [plan.id],
        );
        // And it is no longer offered by key either — a retired plan must not
        // be bookable through a link somebody kept.
        assert.equal(await plans.findByKey(PROJECT, plan.planKey), null);
    });

    test('onlyPublished hides a plan whose versions are all still drafts', async () => {
        const unsold = await createPlan();
        await draftFor(unsold.planKey);
        assert.deepEqual(await plans.list({ projectKey: PROJECT, onlyPublished: true }), []);

        const sold = await createPlan();
        const draft = await draftFor(sold.planKey);
        await publish(draft.id, new Date('2026-01-01T00:00:00.000Z'));
        assert.deepEqual(
            (await plans.list({ projectKey: PROJECT, onlyPublished: true })).map((r) => r.id),
            [sold.id],
        );
    });

    test('onlyPublished does not let another project vouch for this one', async () => {
        // `plan_versions.planId` holds the plan KEY and no project, while
        // `plans` is unique per (projectKey, planKey) — so two projects may use
        // the same key and their versions are indistinguishable from the
        // version table alone. Treating either project's published version as
        // evidence puts one tenant's draft into another's catalogue.
        //
        // The two plans share one version lineage, and the schema says so:
        // `plan_versions_draft_per_plan` is unique on the key alone, so the
        // second project cannot even open a draft while the first one's is
        // open. Publishing theirs first is the only order that reaches the
        // state, and it is the state a real catalogue lands in.
        const SHARED_KEY = `SHARED_${randomUUID().slice(0, 8)}`;
        await plans.create({
            projectKey: OTHER_PROJECT,
            planKey: SHARED_KEY,
            label: 'Theirs, published',
        });
        const theirs = await draftFor(SHARED_KEY);
        await publish(theirs.id, new Date('2026-01-01T00:00:00.000Z'));
        await plans.create({ projectKey: PROJECT, planKey: SHARED_KEY, label: 'Ours, a draft' });
        await draftFor(SHARED_KEY);

        assert.deepEqual(
            await plans.list({ projectKey: PROJECT, onlyPublished: true }),
            [],
            "an ambiguous key fails closed rather than borrowing the other project's publication",
        );
    });

    test('renaming a plan touches what was named and nothing else', async () => {
        const plan = await createPlan({ description: 'Original', icon: 'star' });
        const renamed = await plans.update(plan.id, { label: 'Renamed' });
        assert.equal(renamed.label, 'Renamed');
        assert.equal(renamed.description, 'Original', 'an unnamed field stays as it was');
        assert.equal(renamed.icon, 'star');
        // An explicit null is a value, not an omission.
        assert.equal((await plans.update(plan.id, { description: null })).description, null);
    });

    test('renaming a plan that is gone says so instead of writing nothing', async () => {
        await assert.rejects(plans.update(randomUUID(), { label: 'Nobody' }), /not found/);
    });

    test('deleting a plan twice is not an error', async () => {
        const plan = await createPlan();
        await plans.hardDelete(plan.id);
        await plans.hardDelete(plan.id);
        assert.equal(await plans.findById(plan.id), null);
    });
});

describe('the versions behind a plan', () => {
    test('drafts are numbered in order, and listed that way', async () => {
        const plan = await createPlan();
        const first = await draftFor(plan.planKey);
        await publish(first.id, new Date('2026-01-01T00:00:00.000Z'));
        const second = await draftFor(plan.planKey);
        assert.equal(first.version, 1);
        assert.equal(second.version, 2);
        assert.deepEqual(
            (await plans.listVersions(plan.planKey)).map((v) => v.version),
            [1, 2],
        );
    });

    test('the current draft is the unpublished one, and there is none once it ships', async () => {
        const plan = await createPlan();
        const draft = await draftFor(plan.planKey);
        assert.equal((await plans.findCurrentDraft(plan.planKey))?.id, draft.id);
        await publish(draft.id, new Date('2026-01-01T00:00:00.000Z'));
        assert.equal(await plans.findCurrentDraft(plan.planKey), null);
    });

    test('the latest live version is the newest unsuperseded one', async () => {
        const plan = await createPlan();
        const first = await draftFor(plan.planKey);
        await publish(first.id, new Date('2026-01-01T00:00:00.000Z'));
        const second = await draftFor(plan.planKey);
        await publish(second.id, new Date('2026-03-01T00:00:00.000Z'));
        assert.equal((await plans.findLatestLivePlanVersion(plan.planKey))?.id, second.id);
    });

    test('a terminated version is not live any more', async () => {
        const plan = await createPlan();
        const only = await draftFor(plan.planKey);
        await publish(only.id, new Date('2026-01-01T00:00:00.000Z'));
        await plans.terminate(only.id, new Date('2026-02-01T00:00:00.000Z'));
        // `terminate` sets an end date without a successor to supersede it, so
        // an adapter reading only `supersededAt` would still call this live.
        assert.equal(await plans.findLatestLivePlanVersion(plan.planKey), null);
        assert.equal(
            await plans.findActivePlanVersion(plan.planKey, new Date('2026-06-01T00:00:00.000Z')),
            null,
        );
    });

    test('a draft can be edited, and a published version cannot', async () => {
        const plan = await createPlan();
        const draft = await draftFor(plan.planKey);
        const edited = await plans.updatePlanVersionDraft(draft.id, {
            monthlyNet: '24.90',
            changeNote: 'Price rise',
        });
        assert.equal(edited.monthlyNet, '24.90');
        assert.equal(edited.changeNote, 'Price rise');
        assert.deepEqual(edited.features, ['CORE'], 'an unnamed field stays as it was');

        await publish(draft.id, new Date('2026-01-01T00:00:00.000Z'));
        // The prices a tenant signed under must not move underneath them.
        await assert.rejects(
            plans.updatePlanVersionDraft(draft.id, { monthlyNet: '99.00' }),
            /already published/,
        );
        assert.equal((await plans.findVersionById(draft.id))?.monthlyNet, '24.90');
    });

    test('a draft can be discarded, a published version cannot, and a missing one is a no-op', async () => {
        const plan = await createPlan();
        const draft = await draftFor(plan.planKey);
        await plans.deletePlanVersionDraft(draft.id);
        assert.equal(await plans.findVersionById(draft.id), null);
        // Already gone: nothing to do, and not an error.
        await plans.deletePlanVersionDraft(draft.id);

        const published = await draftFor(plan.planKey);
        await publish(published.id, new Date('2026-01-01T00:00:00.000Z'));
        await assert.rejects(
            plans.deletePlanVersionDraft(published.id),
            /already published/,
            'a published version is what somebody is on — it cannot be discarded',
        );
        assert.ok(await plans.findVersionById(published.id));
    });

    test('publishing the same draft twice fails the second time', async () => {
        const plan = await createPlan();
        const draft = await draftFor(plan.planKey);
        await publish(draft.id, new Date('2026-01-01T00:00:00.000Z'));
        await assert.rejects(
            publish(draft.id, new Date('2026-02-01T00:00:00.000Z')),
            /already published/,
        );
    });
});

describe("a tenant's own writes", () => {
    const TENANT = 'tenant-catalogue-probe';

    async function livePlan(planKey, validFrom = new Date('2026-01-01T00:00:00.000Z')) {
        const plan = await plans.create({ projectKey: PROJECT, planKey, label: planKey });
        const draft = await draftFor(planKey);
        const version = await publish(draft.id, validFrom);
        return { plan, version };
    }

    async function seedSubscription(planKey, versionId, overrides = {}) {
        const id = randomUUID();
        await db.insert(saasicatSchema.subscriptions).values({
            id,
            tenantId: TENANT,
            plan: planKey,
            planVersionId: versionId,
            billingCycle: 'MONTHLY',
            status: 'ACTIVE',
            startedAt: new Date('2026-01-01T00:00:00.000Z'),
            isPilot: false,
            updatedAt: new Date(),
            ...overrides,
        });
        return id;
    }

    test('a scheduled change is written, and only while the row is uncancelled', async () => {
        const { version } = await livePlan('SCHED_A');
        await livePlan('SCHED_B');
        await seedSubscription('SCHED_A', version.id);

        const scheduled = await tenantWrite.schedulePlanChange(TENANT, {
            pendingPlan: 'SCHED_B',
            pendingBillingCycle: 'YEARLY',
            pendingEffectiveAt: new Date('2026-04-01T00:00:00.000Z'),
            expectedCanceledAt: null,
        });
        assert.equal(scheduled.claimed, true);

        // The caller decided against a cancellation that has since arrived: the
        // change must not land in a term that is already ending.
        await tenantWrite.cancelSubscription(TENANT, {
            canceledAt: new Date('2026-02-01T00:00:00.000Z'),
            effectiveAt: new Date('2026-03-01T00:00:00.000Z'),
            terminateNow: false,
        });
        const late = await tenantWrite.schedulePlanChange(TENANT, {
            pendingPlan: 'SCHED_B',
            pendingBillingCycle: 'MONTHLY',
            pendingEffectiveAt: new Date('2026-05-01T00:00:00.000Z'),
            expectedCanceledAt: null,
        });
        assert.equal(late.claimed, false, 'the premise moved, so the write is refused');
    });

    test('an immediate change binds the plan and refuses once a cancellation lands', async () => {
        const { version } = await livePlan('IMM_A');
        const target = await livePlan('IMM_B');
        await seedSubscription('IMM_A', version.id);

        const changed = await tenantWrite.changePlanImmediate(TENANT, {
            planId: 'IMM_B',
            cycle: 'MONTHLY',
            periodStart: new Date('2026-02-15T00:00:00.000Z'),
            periodEnd: new Date('2026-03-15T00:00:00.000Z'),
            nextStatus: null,
            expectedCanceledAt: null,
        });
        assert.equal(changed.claimed, true);
        assert.equal(changed.plan, 'IMM_B');

        const [row] = await db
            .select()
            .from(saasicatSchema.subscriptions)
            .where(eq(saasicatSchema.subscriptions.tenantId, TENANT));
        assert.equal(row.planVersionId, target.version.id, 'the version follows the plan');
        assert.equal(row.billingAnchorDay, 15, 'the billing day comes from the window it opened');

        await tenantWrite.cancelSubscription(TENANT, {
            canceledAt: new Date('2026-02-20T00:00:00.000Z'),
            effectiveAt: new Date('2026-03-15T00:00:00.000Z'),
            terminateNow: false,
        });
        const refused = await tenantWrite.changePlanImmediate(TENANT, {
            planId: 'IMM_A',
            cycle: 'MONTHLY',
            periodStart: null,
            periodEnd: null,
            nextStatus: null,
            expectedCanceledAt: null,
        });
        assert.equal(refused.claimed, false);
        assert.equal(refused.plan, 'IMM_B', 'and the stored plan is untouched');
    });

    test('changing to a plan with no live version says so rather than binding nothing', async () => {
        const { version } = await livePlan('IMM_ONLY');
        await plans.create({ projectKey: PROJECT, planKey: 'DRAFT_ONLY', label: 'Draft only' });
        await draftFor('DRAFT_ONLY');
        await seedSubscription('IMM_ONLY', version.id);
        await assert.rejects(
            tenantWrite.changePlanImmediate(TENANT, {
                planId: 'DRAFT_ONLY',
                cycle: 'MONTHLY',
                periodStart: null,
                periodEnd: null,
                nextStatus: null,
                expectedCanceledAt: null,
            }),
            /No active PlanVersion/,
        );
    });

    test('an immediate change stays on its own connection when a version is pending', async () => {
        // The change runs in a transaction, so it holds a connection for its
        // whole length. Any lookup it makes on the way — here: does the pending
        // version still belong to the plan being moved to — has to run on that
        // same connection. Drawing a second one waits for a connection the
        // transaction itself is holding, and on a one-connection pool that wait
        // never ends.
        //
        // A pool of exactly one makes the deadlock certain rather than likely,
        // which is the difference between a test and a coin toss.
        const { pool: singlePool, db: singleDb } = await openDisposableDatabase({
            max: 1,
            rebuild: false,
            // Fail fast rather than wait forever: an unbounded wait would hang
            // the run and take the cleanup with it.
            connectionTimeoutMillis: 2000,
        });
        try {
            const { version } = await livePlan('PEND_A');
            const other = await livePlan('PEND_B');
            await seedSubscription('PEND_A', version.id, {
                // Pending, and belonging to a different plan than the one being
                // moved to — the branch that makes the lookup happen at all.
                pendingPlanVersionId: other.version.id,
                pendingPlanVersionEffectiveAt: new Date('2026-05-01T00:00:00.000Z'),
            });

            const writer = new DrizzleTenantSubscriptionWrite(singleDb);
            const changed = await writer.changePlanImmediate(TENANT, {
                planId: 'PEND_A',
                cycle: 'MONTHLY',
                periodStart: null,
                periodEnd: null,
                nextStatus: null,
                expectedCanceledAt: null,
            });
            assert.equal(changed.claimed, true);

            const [row] = await db
                .select()
                .from(saasicatSchema.subscriptions)
                .where(eq(saasicatSchema.subscriptions.tenantId, TENANT));
            assert.equal(
                row.pendingPlanVersionId,
                null,
                'a pending version belonging to another plan is cleared by the move',
            );
        } finally {
            await singlePool.end();
        }
    });

    test('accepting a pending version is idempotent, and reports the second call as such', async () => {
        const { version } = await livePlan('ACC_A');
        const pending = await livePlan('ACC_B', new Date('2026-05-01T00:00:00.000Z'));
        await seedSubscription('ACC_A', version.id, {
            pendingPlanVersionId: pending.version.id,
            pendingPlanVersionEffectiveAt: new Date('2026-05-01T00:00:00.000Z'),
        });

        const first = await tenantWrite.acceptPendingPlanVersion(
            TENANT,
            'user-1',
            new Date('2026-04-01T00:00:00.000Z'),
        );
        assert.equal(first.accepted, true);
        assert.equal(first.alreadyAccepted, false);
        assert.equal(first.effectiveAt?.getTime(), new Date('2026-05-01T00:00:00.000Z').getTime());

        // A double click is not a second acceptance.
        const second = await tenantWrite.acceptPendingPlanVersion(
            TENANT,
            'user-1',
            new Date('2026-04-02T00:00:00.000Z'),
        );
        assert.equal(second.alreadyAccepted, true);
        assert.equal(
            second.acceptedAt?.getTime(),
            new Date('2026-04-01T00:00:00.000Z').getTime(),
            'the first acceptance is the one that stands',
        );
    });

    test('accepting when nothing is pending says so', async () => {
        const { version } = await livePlan('ACC_NONE');
        await seedSubscription('ACC_NONE', version.id);
        await assert.rejects(
            tenantWrite.acceptPendingPlanVersion(TENANT, 'user-1', new Date()),
            /No pending PlanVersion/,
        );
    });

    test('a second cancellation returns the first one instead of replacing it', async () => {
        const { version } = await livePlan('CAN_A');
        await seedSubscription('CAN_A', version.id);

        const onTime = await tenantWrite.cancelSubscription(TENANT, {
            canceledAt: new Date('2026-02-01T00:00:00.000Z'),
            effectiveAt: new Date('2026-03-01T00:00:00.000Z'),
            terminateNow: false,
        });
        assert.equal(onTime.alreadyCanceled, false);
        assert.equal(onTime.status, 'ACTIVE', 'a cancellation inside the term keeps running');

        // The expensive case: a second declaration recomputed against a later
        // `now` would land a whole period further out.
        const late = await tenantWrite.cancelSubscription(TENANT, {
            canceledAt: new Date('2026-02-02T00:00:00.000Z'),
            effectiveAt: new Date('2026-04-01T00:00:00.000Z'),
            terminateNow: false,
        });
        assert.equal(late.alreadyCanceled, true);
        assert.equal(
            late.canceledEffectiveAt?.getTime(),
            new Date('2026-03-01T00:00:00.000Z').getTime(),
            'the date the first declaration bought is the one that stands',
        );
    });

    test('an operator ending a contract on the spot flips the status', async () => {
        const { version } = await livePlan('CAN_NOW');
        await seedSubscription('CAN_NOW', version.id);
        const ended = await tenantWrite.cancelSubscription(TENANT, {
            canceledAt: new Date('2026-02-01T00:00:00.000Z'),
            effectiveAt: new Date('2026-02-01T00:00:00.000Z'),
            terminateNow: true,
            minimumTermUntil: new Date('2026-02-01T00:00:00.000Z'),
        });
        assert.equal(ended.status, 'CANCELED');
    });
});
