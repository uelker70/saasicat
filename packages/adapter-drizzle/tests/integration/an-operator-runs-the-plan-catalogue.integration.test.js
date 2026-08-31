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

// @requirement SC-PLAN-017 — Publishing happens in the administration, never in a seed
// @requirement SC-PLAN-022 — Everything wrong with an uploaded catalogue is reported at once

import { after, before, beforeEach, describe, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
    DrizzlePlanRepository,
    DrizzleSubscriptionUsageAdapter,
    DrizzleTenantSubscriptionWrite,
    saasicatSchema,
} from '../../dist/index.js';
import { openDisposableDatabase } from './support/disposable-database.mjs';

let pool;
let db;
let plans;
let tenantWrite;
let usage;

before(async () => {
    ({ pool, db } = await openDisposableDatabase({ max: 4 }));
    plans = new DrizzlePlanRepository(db, { validityWindows: true });
    tenantWrite = new DrizzleTenantSubscriptionWrite(db);
    usage = new DrizzleSubscriptionUsageAdapter(db);
});

after(async () => {
    await pool.end();
});

beforeEach(async () => {
    await pool.query('TRUNCATE TABLE subscriptions, plan_versions, plans RESTART IDENTITY CASCADE');
});

const createPlan = (overrides = {}) =>
    plans.create({
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
    test('a plan is found by its key, and a key nobody took is not', async () => {
        const plan = await createPlan();
        assert.equal((await plans.findByKey(plan.planKey))?.id, plan.id);
        assert.equal(await plans.findByKey('NOBODY_TOOK_THIS'), null);
    });

    test('listing is ordered by sort order, then by key', async () => {
        const late = await createPlan({ planKey: 'AAA', sortOrder: 9, label: 'Sorted last' });
        const early = await createPlan({ planKey: 'ZZZ', sortOrder: 1, label: 'Sorted first' });
        const listed = await plans.list({});
        assert.deepEqual(
            listed.map((row) => row.id),
            [early.id, late.id],
        );
    });

    test('a retired plan drops out of the list, and comes back when asked for', async () => {
        const plan = await createPlan();
        await plans.softDelete(plan.id);
        assert.deepEqual(await plans.list({}), []);
        assert.deepEqual(
            (await plans.list({ excludeDeleted: false })).map((r) => r.id),
            [plan.id],
        );
    });

    test('onlyPublished hides a plan whose versions are all still drafts', async () => {
        const unsold = await createPlan();
        await draftFor(unsold.planKey);
        assert.deepEqual(await plans.list({ onlyPublished: true }), []);

        const sold = await createPlan();
        const draft = await draftFor(sold.planKey);
        await publish(draft.id, new Date('2026-01-01T00:00:00.000Z'));
        assert.deepEqual(
            (await plans.list({ onlyPublished: true })).map((r) => r.id),
            [sold.id],
        );
    });

    test('a plan key cannot be claimed twice, so no version lineage is shared', async () => {
        // The defect this replaces: `plans` used to be unique per (project,
        // plan key) while `plan_versions.planId` held the key alone, so two
        // plans sharing a key shared one version lineage — and
        // `plan_versions_draft_per_plan`, unique on the key, then blocked the
        // second one from even opening a draft. The key is now the whole
        // identity, enforced where it belongs: on `plans`.
        const SHARED_KEY = `SHARED_${randomUUID().slice(0, 8)}`;
        await plans.create({ planKey: SHARED_KEY, label: 'Theirs, published' });
        const theirs = await draftFor(SHARED_KEY);
        await publish(theirs.id, new Date('2026-01-01T00:00:00.000Z'));

        await assert.rejects(
            plans.create({ planKey: SHARED_KEY, label: 'Ours, a draft' }),
            'the second claim on a plan key is refused by the database',
        );
        assert.deepEqual(
            (await plans.list({ onlyPublished: true })).map((row) => row.planKey),
            [SHARED_KEY],
            'and the one plan that owns the key keeps its published version',
        );
    });

    test('a retired plan still occupies its key', async () => {
        // `plans_planKey_key` is unconditional, so a soft delete does not free
        // the key. `findByKey` is the duplicate check in `createPlan`, and an
        // adapter that hid retired rows would turn a 409 into a constraint
        // violation.
        const plan = await createPlan();
        await plans.softDelete(plan.id);

        const stillThere = await plans.findByKey(plan.planKey);
        assert.equal(stillThere?.id, plan.id, 'the key is not free again');
        assert.ok(stillThere?.deletedAt, 'and the row says it is retired');
        assert.deepEqual(await plans.list({}), []);
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

    test('a draft can be edited, and only the named fields move', async () => {
        const plan = await createPlan();
        const draft = await draftFor(plan.planKey);
        const edited = await plans.updatePlanVersionDraft(draft.id, {
            monthlyNet: '24.90',
            changeNote: 'Price rise',
        });
        assert.equal(edited.monthlyNet, '24.90');
        assert.equal(edited.changeNote, 'Price rise');
        assert.deepEqual(edited.features, ['CORE'], 'an unnamed field stays as it was');
    });

    test('a version published for a future date can still be corrected', async () => {
        // `PlanVersionsService.updatePlanDraft` allows exactly this: published,
        // latest in its chain, no subscription bound, `validFrom` still ahead.
        // An operator correcting a price before it takes effect is the whole
        // point of scheduling one, and the adapter must not be the thing that
        // refuses it.
        const plan = await createPlan();
        const draft = await draftFor(plan.planKey);
        const scheduled = await publish(draft.id, new Date('2027-01-01T00:00:00.000Z'));
        const corrected = await plans.updatePlanVersionDraft(scheduled.id, {
            monthlyNet: '21.90',
        });
        assert.equal(corrected.monthlyNet, '21.90');
        assert.equal((await plans.findVersionById(scheduled.id))?.monthlyNet, '21.90');
    });

    test('editing a version that is gone says so', async () => {
        await assert.rejects(
            plans.updatePlanVersionDraft(randomUUID(), { monthlyNet: '9.90' }),
            /not found/,
        );
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
        const plan = await plans.create({ planKey, label: planKey });
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
        await plans.create({ planKey: 'DRAFT_ONLY', label: 'Draft only' });
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

// What the adapter actually asks the database to do.
//
// Both writes below used to decide from a row they had read a moment earlier,
// which is a window another writer can step into. The repairs close the window
// rather than narrow it — one statement stops naming a column it has no opinion
// about, the other takes the row it decides from — so the property to pin is
// the statement itself, and the SQL is where that is observable.
//
// Recorded from a real run against the real database: these are the statements
// PostgreSQL received, not a rehearsal of them.
describe('the statements a tenant write sends', () => {
    const TENANT = 'tenant-statement-probe';

    async function recordStatements(run) {
        const statements = [];
        const recordingPool = {
            query(...args) {
                statements.push(typeof args[0] === 'string' ? args[0] : args[0].text);
                return pool.query(...args);
            },
            connect: (...args) => pool.connect(...args),
            end: () => {},
        };
        await run(drizzle(recordingPool));
        return statements;
    }

    async function seed(status = 'TRIAL', extra = {}) {
        const plan = await plans.create({
            planKey: `STMT_${randomUUID().slice(0, 8)}`,
            label: 'Statement probe',
        });
        const draft = await draftFor(plan.planKey);
        const version = await publish(draft.id, new Date('2026-01-01T00:00:00.000Z'));
        await db.insert(saasicatSchema.subscriptions).values({
            id: randomUUID(),
            tenantId: TENANT,
            plan: plan.planKey,
            planVersionId: version.id,
            billingCycle: 'MONTHLY',
            status,
            startedAt: new Date('2026-01-01T00:00:00.000Z'),
            isPilot: false,
            updatedAt: new Date(),
            ...extra,
        });
        return { plan, version };
    }

    const updates = (statements) =>
        statements.filter((sql) => sql.trim().toLowerCase().startsWith('update "subscriptions"'));

    test('an ordinary cancellation never names the status column', async () => {
        await seed('TRIAL');
        const statements = await recordStatements((recording) =>
            new DrizzleTenantSubscriptionWrite(recording).cancelSubscription(TENANT, {
                canceledAt: new Date('2026-02-01T00:00:00.000Z'),
                effectiveAt: new Date('2026-03-01T00:00:00.000Z'),
                terminateNow: false,
            }),
        );
        const [update] = updates(statements);
        assert.ok(update, 'the cancellation must issue an update');
        assert.equal(
            update.includes('"status"'),
            false,
            'restating the status this call read would undo whatever changed it in between',
        );
        assert.ok(update.includes('"canceledAt"'), 'and it still records the dates');
    });

    test('ending a contract on the spot does name it', async () => {
        await seed('ACTIVE');
        const statements = await recordStatements((recording) =>
            new DrizzleTenantSubscriptionWrite(recording).cancelSubscription(TENANT, {
                canceledAt: new Date('2026-02-01T00:00:00.000Z'),
                effectiveAt: new Date('2026-02-01T00:00:00.000Z'),
                terminateNow: true,
            }),
        );
        assert.ok(updates(statements)[0].includes('"status"'));
        const [row] = await db
            .select()
            .from(saasicatSchema.subscriptions)
            .where(eq(saasicatSchema.subscriptions.tenantId, TENANT));
        assert.equal(row.status, 'CANCELED');
    });

    test('an immediate change locks the row it decides from', async () => {
        const target = await seed('ACTIVE');
        const statements = await recordStatements((recording) =>
            new DrizzleTenantSubscriptionWrite(recording).changePlanImmediate(TENANT, {
                planId: target.plan.planKey,
                cycle: 'MONTHLY',
                periodStart: null,
                periodEnd: null,
                nextStatus: null,
                expectedCanceledAt: null,
            }),
        );
        const read = statements.find(
            (sql) =>
                sql.trim().toLowerCase().startsWith('select') &&
                sql.includes('from "subscriptions"'),
        );
        assert.ok(read, 'the change reads the subscription it is about to rewrite');
        assert.ok(
            read.toLowerCase().includes('for update'),
            'everything below that read decides from it — an unlocked row can move in between',
        );
        assert.ok(
            statements.some((sql) => sql.trim().toLowerCase() === 'begin'),
            'and the lock only means something inside a transaction',
        );
    });
});

// What the tenant's own billing page reads.
describe('the subscription a tenant is shown', () => {
    const TENANT = 'tenant-usage-probe';

    async function livePlanVersion(planKey, validFrom = new Date('2026-01-01T00:00:00.000Z')) {
        await plans.create({ planKey, label: planKey });
        const draft = await draftFor(planKey);
        return publish(draft.id, validFrom);
    }

    test('a tenant with no subscription reads as none, not as an error', async () => {
        assert.equal(await usage.findForTenant('nobody-at-all'), null);
    });

    test('the dates and the plan version a person is shown all come back', async () => {
        const version = await livePlanVersion('USAGE_A');
        await db.insert(saasicatSchema.subscriptions).values({
            id: randomUUID(),
            tenantId: TENANT,
            plan: 'USAGE_A',
            planVersionId: version.id,
            billingCycle: 'YEARLY',
            status: 'ACTIVE',
            startedAt: new Date('2026-01-01T00:00:00.000Z'),
            currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
            currentPeriodEnd: new Date('2027-01-01T00:00:00.000Z'),
            minimumTermUntil: new Date('2027-01-01T00:00:00.000Z'),
            billingAnchorDay: 1,
            trialEndsAt: new Date('2026-01-15T00:00:00.000Z'),
            isPilot: false,
            updatedAt: new Date(),
        });

        const record = await usage.findForTenant(TENANT);
        assert.ok(record);
        assert.equal(record.plan, 'USAGE_A');
        assert.equal(record.billingCycle, 'YEARLY');
        assert.equal(record.status, 'ACTIVE');
        assert.equal(record.billingAnchorDay, 1);
        assert.equal(
            record.currentPeriodEnd?.getTime(),
            new Date('2027-01-01T00:00:00.000Z').getTime(),
        );
        assert.equal(
            record.minimumTermUntil?.getTime(),
            new Date('2027-01-01T00:00:00.000Z').getTime(),
            'the commitment is what the cancellation rules measure against',
        );
        assert.equal(record.planVersion.id, version.id);
        assert.equal(record.planVersion.planId, 'USAGE_A');
        // Nothing pending, and that reads as nothing rather than as a shape
        // full of nulls.
        assert.equal(record.pendingPlanVersion, null);
        assert.equal(record.pendingPlanVersionEffectiveAt, null);
        assert.equal(record.pendingPlanVersionAccepted, false);
    });

    test('a pending version comes with what a person needs to decide', async () => {
        const current = await livePlanVersion('USAGE_FROM');
        const pending = await livePlanVersion('USAGE_TO', new Date('2026-06-01T00:00:00.000Z'));
        await db.insert(saasicatSchema.subscriptions).values({
            id: randomUUID(),
            tenantId: TENANT,
            plan: 'USAGE_FROM',
            planVersionId: current.id,
            billingCycle: 'MONTHLY',
            status: 'ACTIVE',
            startedAt: new Date('2026-01-01T00:00:00.000Z'),
            isPilot: false,
            pendingPlanVersionId: pending.id,
            pendingPlanVersionEffectiveAt: new Date('2026-06-01T00:00:00.000Z'),
            updatedAt: new Date(),
        });

        const record = await usage.findForTenant(TENANT);
        assert.equal(record?.pendingPlanVersion?.id, pending.id);
        assert.equal(
            record?.pendingPlanVersion?.nonRegressive,
            true,
            'whether the change takes anything away is the question being answered',
        );
        assert.equal(
            record?.pendingPlanVersionEffectiveAt?.getTime(),
            new Date('2026-06-01T00:00:00.000Z').getTime(),
        );
    });

    test('the version a subscription is billed for cannot be deleted underneath it', async () => {
        // The adapter throws when the version is missing, and this is why that
        // branch is not reachable here: the canonical schema refuses to orphan
        // a subscription. Asserting the constraint says what actually holds —
        // a test that deleted the row to reach the throw would be describing a
        // state this schema cannot produce.
        const version = await livePlanVersion('USAGE_ORPHAN');
        await db.insert(saasicatSchema.subscriptions).values({
            id: randomUUID(),
            tenantId: TENANT,
            plan: 'USAGE_ORPHAN',
            planVersionId: version.id,
            billingCycle: 'MONTHLY',
            status: 'ACTIVE',
            startedAt: new Date('2026-01-01T00:00:00.000Z'),
            isPilot: false,
            updatedAt: new Date(),
        });
        await assert.rejects(
            pool.query('DELETE FROM plan_versions WHERE id = $1', [version.id]),
            /violates.*foreign key constraint/,
        );
        assert.ok(await usage.findForTenant(TENANT), 'and the tenant still reads their plan');
    });
});
