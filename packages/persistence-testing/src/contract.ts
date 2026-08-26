// The executable persistence contract. Every adapter runs the SAME
// scenarios against its real database — this is what makes "functionally
// equivalent adapters" a verified claim instead of prose.
//
// Scenario groups gate on adapter capabilities/slices. A gated-off group is
// registered as skipped with the reason, so coverage gaps stay visible in
// the test report.

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { TransactionContext } from '@saasicat/core';
import type {
    PersistenceAdapterContractOptions,
    PersistenceContractHarness,
} from './harness.types.js';

const LOCK_HOLD_MS = 150;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Registers the contract suite on the ambient `node:test` runner:
 *
 * ```ts
 * persistenceAdapterContract({
 *     name: 'adapter-prisma @ postgres',
 *     projectKey: 'my-app',
 *     create: () => createPrismaHarness(),
 * });
 * ```
 */
export function persistenceAdapterContract(options: PersistenceAdapterContractOptions): void {
    describe(`persistence adapter contract: ${options.name}`, () => {
        let harness: PersistenceContractHarness;

        before(async () => {
            harness = await options.create();
        });
        after(async () => {
            await harness.close?.();
        });
        beforeEach(async () => {
            await harness.reset();
        });

        // -------------------------------------------------------------
        // Subscriptions + plan-version resolution
        // -------------------------------------------------------------

        test('findByTenantId returns the tenant subscription with plan-version limits', async () => {
            const { seed, adapter } = harness;
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: { users: 5 },
                features: ['CORE'],
                published: true,
            });
            await seed.createSubscription({
                tenantId: 'tenant-a',
                plan: 'STARTER',
                planVersionId,
            });

            const record = await adapter.subscriptionRepository.findByTenantId('tenant-a');
            assert.ok(record, 'subscription expected');
            assert.equal(record.tenantId, 'tenant-a');
            assert.equal(record.plan, 'STARTER');
            assert.equal(record.planVersionId, planVersionId);
            assert.deepEqual(record.planVersion.quotas, { users: 5 });
            assert.deepEqual(record.planVersion.features, ['CORE']);
        });

        test('findByTenantId is tenant-isolated', async () => {
            const { seed, adapter } = harness;
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: {},
                features: [],
                published: true,
            });
            await seed.createSubscription({
                tenantId: 'tenant-a',
                plan: 'STARTER',
                planVersionId,
            });

            assert.equal(await adapter.subscriptionRepository.findByTenantId('tenant-b'), null);
        });

        test('findLatestLive resolves the live version, not superseded or draft', async () => {
            const { seed, adapter } = harness;
            await seed.createPlanVersion({
                planKey: 'PRO',
                version: 1,
                quotas: { users: 1 },
                features: [],
                published: true,
                superseded: true,
            });
            await seed.createPlanVersion({
                planKey: 'PRO',
                version: 2,
                quotas: { users: 2 },
                features: [],
                published: true,
            });
            await seed.createPlanVersion({
                planKey: 'PRO',
                version: 3,
                quotas: { users: 3 },
                features: [],
                published: false,
            });

            const live = await adapter.planVersionRepository.findLatestLive('PRO');
            assert.ok(live, 'live version expected');
            assert.equal(
                live.planId,
                'PRO',
                'port-facing plan identity must remain the semantic plan key',
            );
            assert.deepEqual(live.quotas, { users: 2 });
        });

        test('immediate plan change binds plan and active PlanVersion consistently', async (t) => {
            const { seed, adapter } = harness;
            if (!adapter.tenantSubscriptionWrite) {
                t.skip('adapter does not expose atomic plan-binding writes');
                return;
            }
            const oldVersion = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: { users: 2 },
                features: [],
                published: true,
            });
            const targetVersion = await seed.createPlanVersion({
                planKey: 'PRO',
                version: 1,
                quotas: { users: 20 },
                features: ['PRO'],
                published: true,
            });
            await seed.createSubscription({
                tenantId: 'tenant-plan-change',
                plan: 'STARTER',
                planVersionId: oldVersion.planVersionId,
            });

            const change = await adapter.tenantSubscriptionWrite.changePlanImmediate(
                'tenant-plan-change',
                {
                    planId: 'PRO',
                    cycle: 'YEARLY',
                    periodStart: null,
                    periodEnd: null,
                    nextStatus: null,
                    // The row has no cancellation, so this claims it.
                    expectedCanceledAt: null,
                },
            );
            assert.equal(change.claimed, true, 'the plan write did not claim the row');

            const changed =
                await adapter.subscriptionRepository.findByTenantId('tenant-plan-change');
            assert.ok(changed, 'changed subscription expected');
            assert.equal(changed.plan, 'PRO');
            assert.equal(changed.planVersionId, targetVersion.planVersionId);
            assert.equal(changed.planVersion.planId, 'PRO');
        });

        test('onboarding selection rolls plan binding and promo write back together', async (t) => {
            const { seed, adapter } = harness;
            const writer = adapter.tenantSubscriptionWrite;
            if (!writer?.applyOnboardingSelection) {
                t.skip('adapter does not expose atomic onboarding writes');
                return;
            }
            const redemptions = adapter.promoCodeRedemptionRepository;
            if (!redemptions) {
                t.skip('adapter provides no PromoCodeRedemptionRepository');
                return;
            }
            const oldVersion = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: {},
                features: [],
                published: true,
            });
            await seed.createPlanVersion({
                planKey: 'PRO',
                version: 1,
                quotas: {},
                features: [],
                published: true,
            });
            const { subscriptionId } = await seed.createSubscription({
                tenantId: 'tenant-onboarding-rollback',
                plan: 'STARTER',
                planVersionId: oldVersion.planVersionId,
            });
            const { promoCodeId } = await seed.createPromoCode({
                code: 'ONBOARDING-ROLLBACK',
                maxRedemptions: null,
            });
            const startsAt = new Date('2026-07-24T00:00:00.000Z');

            await assert.rejects(
                writer.applyOnboardingSelection(
                    'tenant-onboarding-rollback',
                    {
                        planId: 'PRO',
                        cycle: 'MONTHLY',
                        periodStart: null,
                        periodEnd: null,
                        nextStatus: null,
                        expectedCanceledAt: null,
                    },
                    async (tx, callbackSubscriptionId) => {
                        assert.equal(callbackSubscriptionId, subscriptionId);
                        await redemptions.create(
                            {
                                promoCodeId,
                                subscriptionId: callbackSubscriptionId,
                                tenantId: 'tenant-onboarding-rollback',
                                appliedValueType: 'PERCENT',
                                appliedValue: '10.00',
                                appliedDurationType: 'ONCE',
                                appliedDurationValue: null,
                                startsAt,
                                endsAt: null,
                            },
                            tx,
                        );
                        assert.ok(
                            await redemptions.findBySubscription(callbackSubscriptionId, tx),
                            'promo write must be visible inside the onboarding transaction',
                        );
                        throw new Error('promo redemption failed');
                    },
                ),
                /promo redemption failed/,
            );

            const unchanged = await adapter.subscriptionRepository.findByTenantId(
                'tenant-onboarding-rollback',
            );
            assert.ok(unchanged, 'subscription expected after rollback');
            assert.equal(unchanged.plan, 'STARTER');
            assert.equal(unchanged.planVersionId, oldVersion.planVersionId);
            assert.equal(unchanged.planVersion.planId, 'STARTER');
            assert.equal(
                await redemptions.findBySubscription(subscriptionId),
                null,
                'promo callback write must be rolled back',
            );
        });

        test('plan lifecycle keeps semantic identity and auto-succeeds validity windows', async (t) => {
            const repository = harness.adapter.planRepository;
            if (
                !repository?.createPlanVersionDraft ||
                !repository.publishPlanVersionDraft ||
                !repository.findVersionById ||
                !repository.findActivePlanVersion
            ) {
                t.skip('adapter provides no time-aware PlanRepository lifecycle');
                return;
            }
            const plan = await repository.create({
                projectKey: options.projectKey,
                planKey: 'STANDARD',
                label: 'Standard',
            });
            assert.equal(plan.projectKey, options.projectKey);
            const firstDraft = await repository.createPlanVersionDraft({
                planId: 'STANDARD',
                features: ['CORE'],
                quotas: { users: 5 },
                monthlyNet: '10.00',
                yearlyNet: '100.00',
                validFrom: '2026-01-01',
            });
            assert.equal(firstDraft.planId, 'STANDARD');
            const first = await repository.publishPlanVersionDraft(firstDraft.id, {
                publishedByUserId: null,
                publishedChanges: [],
                nonRegressive: true,
                validFrom: new Date('2026-01-01T00:00:00.000Z'),
                validUntil: null,
            });

            const secondDraft = await repository.createPlanVersionDraft({
                planId: 'STANDARD',
                baseVersionId: first.id,
                features: ['CORE', 'PLUS'],
                quotas: { users: 10 },
                monthlyNet: '15.00',
                yearlyNet: '150.00',
                validFrom: '2026-03-01',
            });
            const second = await repository.publishPlanVersionDraft(secondDraft.id, {
                publishedByUserId: null,
                publishedChanges: [],
                nonRegressive: true,
                validFrom: new Date('2026-03-01T00:00:00.000Z'),
                validUntil: null,
            });

            const succeeded = await repository.findVersionById(first.id);
            assert.ok(succeeded, 'predecessor expected');
            assert.ok(succeeded.supersededAt, 'predecessor must be superseded');
            assert.equal(succeeded.validUntil, '2026-02-28T00:00:00.000Z');
            assert.equal(succeeded.planId, 'STANDARD');
            assert.equal(
                (
                    await repository.findActivePlanVersion(
                        'STANDARD',
                        new Date('2026-02-28T23:59:59.999Z'),
                    )
                )?.id,
                first.id,
                'validUntil is day-inclusive',
            );
            assert.equal(
                (
                    await repository.findActivePlanVersion(
                        'STANDARD',
                        new Date('2026-03-01T00:00:00.000Z'),
                    )
                )?.id,
                second.id,
            );
        });

        test('bundle lifecycle roundtrips validity and auto-succeeds atomically', async (t) => {
            const repository = harness.adapter.bundleRepository;
            if (!repository?.findActiveBundleVersion) {
                t.skip('adapter provides no time-aware BundleRepository');
                return;
            }
            const bundle = await repository.create({
                projectKey: options.projectKey,
                bundleKey: 'REPORTING',
                label: 'Reporting',
            });
            assert.equal(bundle.projectKey, options.projectKey);
            const firstDraft = await repository.createDraft({
                bundleId: bundle.id,
                features: ['REPORTS'],
                quotas: {},
                validFrom: '2026-01-01',
            });
            const first = await repository.publishDraft(firstDraft.id, {
                publishedByUserId: null,
                publishedChanges: [],
                nonRegressive: true,
                validFrom: new Date('2026-01-01T00:00:00.000Z'),
                validUntil: null,
            });

            const secondDraft = await repository.createDraft({
                bundleId: bundle.id,
                baseVersionId: first.id,
                features: ['REPORTS', 'EXPORTS'],
                quotas: {},
                validFrom: '2026-03-01',
            });
            const second = await repository.publishDraft(secondDraft.id, {
                publishedByUserId: null,
                publishedChanges: [],
                nonRegressive: true,
                validFrom: new Date('2026-03-01T00:00:00.000Z'),
                validUntil: null,
            });

            const succeeded = await repository.findVersionById(first.id);
            assert.ok(succeeded, 'predecessor expected');
            assert.ok(succeeded.supersededAt, 'predecessor must be superseded');
            assert.equal(succeeded.validUntil, '2026-02-28T00:00:00.000Z');
            assert.equal(
                (
                    await repository.findActiveBundleVersion(
                        bundle.id,
                        new Date('2026-02-28T23:59:59.999Z'),
                    )
                )?.id,
                first.id,
                'validUntil is day-inclusive',
            );
            assert.equal(
                (
                    await repository.findActiveBundleVersion(
                        bundle.id,
                        new Date('2026-03-01T00:00:00.000Z'),
                    )
                )?.id,
                second.id,
            );
        });

        test('a booking keeps the rhythm and the window it was made in', async (t) => {
            // The three columns a bundle's own period lives in. Before they
            // existed a booking was billed alongside the plan by convention,
            // which is exactly what a null still means — so the scenario proves
            // both readings survive a round trip through a real store, not just
            // the populated one.
            const repository = harness.adapter.subscriptionBundleRepository;
            const { seed } = harness;
            if (!repository || !seed.createBundleVersion) {
                t.skip('adapter provides no SubscriptionBundleRepository or bundle catalog');
                return;
            }
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'PRO',
                version: 1,
                quotas: {},
                features: ['CORE'],
                published: true,
            });
            const { subscriptionId } = await seed.createSubscription({
                tenantId: 'tenant-bundle-period',
                plan: 'PRO',
                planVersionId,
                billingCycle: 'YEARLY',
            });
            const { bundleVersionId } = await seed.createBundleVersion({
                bundleKey: 'ANALYTICS',
                features: ['REPORTS'],
            });

            // A monthly bundle beside a yearly plan: the case the columns
            // exist for, and the one a convention cannot express.
            const booked = await repository.add({
                subscriptionId,
                bundleVersionId,
                startedAt: new Date('2026-02-21T00:00:00.000Z'),
                minimumTermEndsAt: null,
                billingCycle: 'MONTHLY',
                currentPeriodStart: new Date('2026-02-21T00:00:00.000Z'),
                currentPeriodEnd: new Date('2026-02-28T00:00:00.000Z'),
            });
            assert.equal(booked.billingCycle, 'MONTHLY');

            const [readBack] = await repository.listBySubscription(subscriptionId);
            assert.ok(readBack, 'the booking must be readable back');
            assert.equal(readBack.billingCycle, 'MONTHLY');
            assert.equal(
                readBack.currentPeriodEnd?.toISOString(),
                '2026-02-28T00:00:00.000Z',
                'the period end must survive the round trip',
            );
            assert.equal(readBack.currentPeriodStart?.toISOString(), '2026-02-21T00:00:00.000Z');

            // A booking made before the columns existed: every one of them null,
            // read as "billed with the plan" rather than as a broken row.
            const legacy = await repository.add({
                subscriptionId,
                bundleVersionId,
                startedAt: new Date('2026-01-01T00:00:00.000Z'),
                minimumTermEndsAt: null,
            });
            const legacyReadBack = await repository.findById(legacy.id);
            assert.ok(legacyReadBack, 'the legacy booking must be readable back');
            assert.equal(legacyReadBack.billingCycle, null);
            assert.equal(legacyReadBack.currentPeriodStart, null);
            assert.equal(legacyReadBack.currentPeriodEnd, null);
        });

        test('a second cancellation of one booking is refused, not applied', async (t) => {
            // The port has always said this method throws on an already-
            // cancelled booking. Neither adapter did: both updated by id alone,
            // so two requests that pass the service's check together both
            // wrote, and the loser moved an effective date the tenant had
            // already been told — the one field in the row that decides when
            // they stop being billed.
            const repository = harness.adapter.subscriptionBundleRepository;
            const { seed } = harness;
            if (!repository || !seed.createBundleVersion) {
                t.skip('adapter provides no SubscriptionBundleRepository or bundle catalog');
                return;
            }
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'PRO',
                version: 1,
                quotas: {},
                features: ['CORE'],
                published: true,
            });
            const { subscriptionId } = await seed.createSubscription({
                tenantId: 'tenant-double-cancel',
                plan: 'PRO',
                planVersionId,
            });
            const { bundleVersionId } = await seed.createBundleVersion({
                bundleKey: 'ANALYTICS',
                features: ['REPORTS'],
            });
            const booking = await repository.add({
                subscriptionId,
                bundleVersionId,
                startedAt: new Date('2026-01-01T00:00:00.000Z'),
                minimumTermEndsAt: null,
            });

            const first = await repository.cancel(booking.id, {
                canceledAt: new Date('2026-03-01T00:00:00.000Z'),
                canceledEffectiveAt: new Date('2026-04-01T00:00:00.000Z'),
            });
            assert.equal(first.canceledEffectiveAt?.toISOString(), '2026-04-01T00:00:00.000Z');

            await assert.rejects(
                () =>
                    repository.cancel(booking.id, {
                        canceledAt: new Date('2026-03-02T00:00:00.000Z'),
                        canceledEffectiveAt: new Date('2026-09-01T00:00:00.000Z'),
                    }),
                'a second cancellation must be refused',
            );

            const readBack = await repository.findById(booking.id);
            assert.equal(
                readBack?.canceledEffectiveAt?.toISOString(),
                '2026-04-01T00:00:00.000Z',
                'the first cancellation must still stand',
            );

            // And undoing it makes the booking cancellable again, which is what
            // separates "refused because already cancelled" from "refused".
            await repository.reactivate(booking.id);
            const again = await repository.cancel(booking.id, {
                canceledAt: new Date('2026-03-02T00:00:00.000Z'),
                canceledEffectiveAt: new Date('2026-09-01T00:00:00.000Z'),
            });
            assert.equal(again.canceledEffectiveAt?.toISOString(), '2026-09-01T00:00:00.000Z');
        });

        test("a subscription's bookings come back newest first", async (t) => {
            const repository = harness.adapter.subscriptionBundleRepository;
            const { seed } = harness;
            if (!repository || !seed.createBundleVersion) {
                t.skip('adapter provides no SubscriptionBundleRepository or bundle catalog');
                return;
            }
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'PRO',
                version: 1,
                quotas: {},
                features: ['CORE'],
                published: true,
            });
            const { subscriptionId } = await seed.createSubscription({
                tenantId: 'tenant-booking-order',
                plan: 'PRO',
                planVersionId,
            });
            // Inserted oldest-first on purpose: without an ORDER BY a store is
            // free to hand them back in insertion order, and the assertion
            // below would then pass by accident.
            for (const [key, startedAt] of [
                ['OLDEST', '2026-01-01T00:00:00.000Z'],
                ['MIDDLE', '2026-02-01T00:00:00.000Z'],
                ['NEWEST', '2026-03-01T00:00:00.000Z'],
            ] as const) {
                const { bundleVersionId } = await seed.createBundleVersion({
                    bundleKey: key,
                    features: ['REPORTS'],
                });
                await repository.add({
                    subscriptionId,
                    bundleVersionId,
                    startedAt: new Date(startedAt),
                    minimumTermEndsAt: null,
                });
            }

            const listed = await repository.listBySubscription(subscriptionId);
            assert.deepEqual(
                listed.map((row) => row.startedAt.toISOString()),
                [
                    '2026-03-01T00:00:00.000Z',
                    '2026-02-01T00:00:00.000Z',
                    '2026-01-01T00:00:00.000Z',
                ],
            );
        });

        test('a booking with no request date is active, whatever its effective date says', async (t) => {
            // The port defines activity as `canceledAt IS NULL OR
            // canceledEffectiveAt > NOW()`. A row with no request date and a
            // past effective date satisfies the first half, and an adapter that
            // requires BOTH columns to be null instead reads it as inactive —
            // so the same tenant is granted less on one store than on another.
            // The shape is incoherent data; the point is that both answer it
            // the same way.
            const repository = harness.adapter.subscriptionBundleRepository;
            const { seed } = harness;
            if (!repository || !seed.createBundleVersion) {
                t.skip('adapter provides no SubscriptionBundleRepository or bundle catalog');
                return;
            }
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'PRO',
                version: 1,
                quotas: {},
                features: ['CORE'],
                published: true,
            });
            const { subscriptionId } = await seed.createSubscription({
                tenantId: 'tenant-half-cancelled',
                plan: 'PRO',
                planVersionId,
            });
            const { bundleVersionId } = await seed.createBundleVersion({
                bundleKey: 'ANALYTICS',
                features: ['REPORTS'],
            });
            const booking = await repository.add({
                subscriptionId,
                bundleVersionId,
                startedAt: new Date('2026-01-01T00:00:00.000Z'),
                minimumTermEndsAt: null,
            });
            // Cancel, then clear only the request date — the half-written state
            // the nullable columns permit.
            await repository.cancel(booking.id, {
                canceledAt: new Date('2026-02-01T00:00:00.000Z'),
                canceledEffectiveAt: new Date('2026-03-01T00:00:00.000Z'),
            });
            const clearRequestDate = harness.seed.clearBookingRequestDate;
            if (!clearRequestDate) {
                t.skip('adapter harness cannot write the half-cancelled shape');
                return;
            }
            await clearRequestDate(booking.id);

            const active = await repository.listActiveBySubscription(
                subscriptionId,
                new Date('2026-06-01T00:00:00.000Z'),
            );
            assert.equal(active.length, 1, 'no request date means nobody asked to cancel it');
            assert.equal(
                await repository.countActiveByBundleVersionId(
                    bundleVersionId,
                    new Date('2026-06-01T00:00:00.000Z'),
                ),
                1,
            );
        });

        test('discarding a draft cannot remove a version published meanwhile', async (t) => {
            // Read-then-delete-by-id leaves a window: a publish commits in
            // between and the delete removes a published version. It has no
            // bookings yet, so no foreign key stands in the way — the catalogue
            // entry is simply gone. Simulated here by publishing between the
            // caller's decision and the call, which is the same order the race
            // produces.
            const catalog = harness.adapter.bundleRepository;
            // Bound once so the narrowing survives into the arrow below: the
            // port makes `deleteDraft` optional, and TypeScript does not carry
            // a property check across a closure boundary.
            const discardDraft = catalog?.deleteDraft?.bind(catalog);
            if (!catalog || !discardDraft) {
                t.skip('adapter provides no BundleRepository');
                return;
            }
            const bundle = await catalog.create({
                projectKey: options.projectKey,
                bundleKey: 'RACE',
                label: 'Race',
            });
            const draft = await catalog.createDraft({
                bundleId: bundle.id,
                features: ['REPORTS'],
                quotas: {},
            });
            await catalog.publishDraft(draft.id, {
                publishedByUserId: null,
                publishedChanges: [],
                nonRegressive: true,
                validFrom: new Date('2026-01-01T00:00:00.000Z'),
                validUntil: null,
            });

            await assert.rejects(
                () => discardDraft(draft.id),
                'a published version must not be discardable',
            );
            assert.ok(
                await catalog.findVersionById(draft.id),
                'and it must still be there afterwards',
            );
        });

        test('publishing one draft twice claims it once, and the windows stay adjacent', async (t) => {
            // Two publications of the same draft with different validity dates.
            // Superseding the predecessor before claiming the draft lets both
            // do work: the first closes the predecessor with its own date, the
            // second finds no unsuperseded predecessor left and overwrites the
            // successor's `validFrom` with a different one — and the stored
            // windows are then a gap or an overlap that nothing can attribute.
            const catalog = harness.adapter.bundleRepository;
            const publish = catalog?.publishDraft?.bind(catalog);
            if (!catalog || !publish) {
                t.skip('adapter provides no BundleRepository');
                return;
            }
            const bundle = await catalog.create({
                projectKey: options.projectKey,
                bundleKey: 'CLAIM',
                label: 'Claim',
            });
            const first = await catalog.createDraft({
                bundleId: bundle.id,
                features: ['A'],
                quotas: {},
            });
            await publish(first.id, {
                publishedByUserId: null,
                publishedChanges: [],
                nonRegressive: true,
                validFrom: new Date('2026-01-01T00:00:00.000Z'),
                validUntil: null,
            });
            const second = await catalog.createDraft({
                bundleId: bundle.id,
                baseVersionId: first.id,
                features: ['A', 'B'],
                quotas: {},
            });

            const publishedAt = new Date('2026-03-01T00:00:00.000Z');
            await publish(second.id, {
                publishedByUserId: null,
                publishedChanges: [],
                nonRegressive: true,
                validFrom: publishedAt,
                validUntil: null,
            });
            // The losing request, arriving with a different date.
            await assert.rejects(
                () =>
                    publish(second.id, {
                        publishedByUserId: null,
                        publishedChanges: [],
                        nonRegressive: true,
                        validFrom: new Date('2026-06-01T00:00:00.000Z'),
                        validUntil: null,
                    }),
                'a version that is already published must not be published again',
            );

            const successor = await catalog.findVersionById(second.id);
            const predecessor = await catalog.findVersionById(first.id);
            assert.equal(
                successor?.validFrom && new Date(successor.validFrom).toISOString(),
                publishedAt.toISOString(),
                'the winning date must still stand',
            );
            assert.ok(predecessor?.supersededAt, 'the predecessor must be superseded');
            if (predecessor?.validUntil) {
                // Adjacent, not overlapping: the predecessor's last day is the
                // day before the successor opens.
                const closesAt = new Date(predecessor.validUntil);
                assert.equal(
                    closesAt.toISOString().slice(0, 10),
                    '2026-02-28',
                    'the predecessor must close the day before its successor opens',
                );
            }
        });

        test('a retired bundle still occupies its key', async (t) => {
            // `findByKey` answers the database's question, and
            // `bundles_projectKey_bundleKey_key` is an unconditional unique
            // index: retiring a bundle does not free its key. Its one caller is
            // the duplicate check in `createBundle`, so an adapter that hides
            // retired rows lets that check pass and the insert then fail on the
            // constraint — a 500 where the service had `BUNDLE_ALREADY_EXISTS`
            // ready. `list` is the active-catalogue lookup, and it excludes
            // them.
            const catalog = harness.adapter.bundleRepository;
            const retire = catalog?.softDelete?.bind(catalog);
            const byKey = catalog?.findByKey?.bind(catalog);
            if (!catalog || !retire || !byKey) {
                t.skip('adapter provides no BundleRepository');
                return;
            }
            const bundle = await catalog.create({
                projectKey: options.projectKey,
                bundleKey: 'RETIRED_KEY',
                label: 'Retired',
            });
            assert.equal((await byKey(options.projectKey, 'RETIRED_KEY'))?.id, bundle.id);

            await retire(bundle.id);
            const stillThere = await byKey(options.projectKey, 'RETIRED_KEY');
            assert.equal(stillThere?.id, bundle.id, 'the key is not free again');
            assert.ok(stillThere?.deletedAt, 'and the row says it is retired');

            // The active catalogue is the other question, and `list` answers it.
            const listed = await catalog.list({ projectKey: options.projectKey });
            assert.equal(
                listed.some((row) => row.id === bundle.id),
                false,
                'a retired bundle is not in the catalogue an operator browses',
            );
        });

        test('countByPlanVersionId counts current AND pending bindings in one query', async (t) => {
            const { seed, adapter } = harness;
            if (!adapter.subscriptionRepository.countByPlanVersionId) {
                t.skip('adapter does not implement countByPlanVersionId (fail-closed fallback)');
                return;
            }
            const v1 = await seed.createPlanVersion({
                planKey: 'PRO',
                version: 1,
                quotas: {},
                features: [],
                published: true,
            });
            const v2 = await seed.createPlanVersion({
                planKey: 'PRO',
                version: 2,
                quotas: {},
                features: [],
                published: true,
            });
            await seed.createSubscription({
                tenantId: 'tenant-current',
                plan: 'PRO',
                planVersionId: v2.planVersionId,
            });
            await seed.createSubscription({
                tenantId: 'tenant-pending',
                plan: 'PRO',
                planVersionId: v1.planVersionId,
                pendingPlanVersionId: v2.planVersionId,
            });

            assert.equal(
                await adapter.subscriptionRepository.countByPlanVersionId(v2.planVersionId),
                2,
            );
        });

        // -------------------------------------------------------------
        // Transactions + locking
        // -------------------------------------------------------------

        test('transaction rollback discards writes', async (t) => {
            const { seed, adapter } = harness;
            if (!adapter.capabilities.transactions) {
                t.skip('adapter declares no transaction capability');
                return;
            }
            if (!adapter.promoCodeRedemptionRepository) {
                t.skip(
                    'adapter provides no PromoCodeRedemptionRepository (needed as tx write probe)',
                );
                return;
            }
            const redemptions = adapter.promoCodeRedemptionRepository;
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: {},
                features: [],
                published: true,
            });
            const { subscriptionId } = await seed.createSubscription({
                tenantId: 'tenant-a',
                plan: 'STARTER',
                planVersionId,
            });
            const { promoCodeId } = await seed.createPromoCode({
                code: 'ROLLBACK10',
                maxRedemptions: null,
            });

            await assert.rejects(
                adapter.transactionRunner.run(async (tx) => {
                    await redemptions.create(
                        {
                            promoCodeId,
                            subscriptionId,
                            tenantId: 'tenant-a',
                            appliedValueType: 'PERCENT',
                            appliedValue: '10.00',
                            appliedDurationType: 'ONCE',
                            appliedDurationValue: null,
                            startsAt: new Date(),
                            endsAt: null,
                        },
                        tx,
                    );
                    throw new Error('boom — roll back');
                }),
            );

            assert.equal(
                await redemptions.findBySubscription(subscriptionId),
                null,
                'write must be rolled back',
            );
        });

        test('findByTenantIdLocked serializes concurrent transactions on the same tenant', async (t) => {
            const { seed, adapter } = harness;
            if (!adapter.capabilities.transactions || !adapter.capabilities.pessimisticLocking) {
                t.skip('adapter declares no pessimistic-locking capability');
                return;
            }
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: { users: 1 },
                features: [],
                published: true,
            });
            await seed.createSubscription({
                tenantId: 'tenant-a',
                plan: 'STARTER',
                planVersionId,
            });

            const sections: Array<{ enter: number; exit: number }> = [];
            const critical = (tx: TransactionContext) =>
                adapter.subscriptionRepository
                    .findByTenantIdLocked('tenant-a', tx)
                    .then(async () => {
                        const enter = Date.now();
                        await sleep(LOCK_HOLD_MS);
                        sections.push({ enter, exit: Date.now() });
                    });

            await Promise.all([
                adapter.transactionRunner.run(critical),
                adapter.transactionRunner.run(critical),
            ]);

            assert.equal(sections.length, 2);
            sections.sort((a, b) => a.enter - b.enter);
            assert.ok(
                sections[1].enter >= sections[0].exit,
                `critical sections overlap: [${sections[0].enter}, ${sections[0].exit}] vs ` +
                    `[${sections[1].enter}, ${sections[1].exit}] — row lock not effective`,
            );
        });

        // -------------------------------------------------------------
        // Promo codes — atomic availability
        // -------------------------------------------------------------

        test('concurrent claimSlot grants exactly maxRedemptions slots', async (t) => {
            const { seed, adapter } = harness;
            if (!adapter.promoCodeRepository) {
                t.skip('adapter provides no PromoCodeRepository');
                return;
            }
            const promoCodes = adapter.promoCodeRepository;
            const { promoCodeId } = await seed.createPromoCode({
                code: 'LAST-SLOT',
                maxRedemptions: 1,
            });

            const attempts = await Promise.all(
                Array.from({ length: 5 }, () =>
                    adapter.transactionRunner.run((tx) => promoCodes.claimSlot(promoCodeId, tx)),
                ),
            );

            assert.equal(attempts.filter(Boolean).length, 1, 'exactly one claim must win');
            const code = await promoCodes.findById(promoCodeId);
            assert.equal(code?.redemptionsCount, 1);
        });

        test('claimSlot / markExhaustedIfFull / releaseSlot lifecycle', async (t) => {
            const { seed, adapter } = harness;
            if (!adapter.promoCodeRepository) {
                t.skip('adapter provides no PromoCodeRepository');
                return;
            }
            const promoCodes = adapter.promoCodeRepository;
            const { promoCodeId } = await seed.createPromoCode({
                code: 'CYCLE',
                maxRedemptions: 1,
            });

            assert.equal(await promoCodes.claimSlot(promoCodeId), true);
            assert.equal(await promoCodes.claimSlot(promoCodeId), false, 'code is full');

            await promoCodes.markExhaustedIfFull(promoCodeId);
            assert.equal((await promoCodes.findById(promoCodeId))?.status, 'EXHAUSTED');

            await promoCodes.releaseSlot(promoCodeId);
            const released = await promoCodes.findById(promoCodeId);
            assert.equal(released?.status, 'ACTIVE');
            assert.equal(released?.redemptionsCount, 0);
        });

        test('a subscription cannot redeem twice (unique guard)', async (t) => {
            const { seed, adapter } = harness;
            if (!adapter.promoCodeRedemptionRepository) {
                t.skip('adapter provides no PromoCodeRedemptionRepository');
                return;
            }
            const redemptions = adapter.promoCodeRedemptionRepository;
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: {},
                features: [],
                published: true,
            });
            const { subscriptionId } = await seed.createSubscription({
                tenantId: 'tenant-a',
                plan: 'STARTER',
                planVersionId,
            });
            const { promoCodeId } = await seed.createPromoCode({
                code: 'ONCE-ONLY',
                maxRedemptions: null,
            });
            const redemption = {
                promoCodeId,
                subscriptionId,
                tenantId: 'tenant-a',
                appliedValueType: 'PERCENT' as const,
                appliedValue: '10.00',
                appliedDurationType: 'ONCE' as const,
                appliedDurationValue: null,
                startsAt: new Date(),
                endsAt: null,
            };

            await redemptions.create(redemption);
            await assert.rejects(
                redemptions.create(redemption),
                'second redemption for the same subscription must fail',
            );
        });

        // -------------------------------------------------------------
        // Audit + MFA
        // -------------------------------------------------------------

        test('audit write → query roundtrip with actorTag filters', async (t) => {
            const { adapter } = harness;
            if (!adapter.audit || !adapter.auditQuery) {
                t.skip('adapter provides no AuditPort/AuditQueryPort pair');
                return;
            }
            await adapter.audit.write({
                actor: {
                    userId: 'admin-1',
                    email: 'ops@example.com',
                    source: 'cli',
                    context: 'host1',
                },
                entity: 'Tenant',
                entityId: 'tenant-a',
                action: 'TENANT_SUSPEND',
                changes: { reason: 'test' },
            });
            await adapter.audit.write({
                actor: {
                    userId: 'admin-2',
                    email: 'web@example.com',
                    source: 'web',
                    context: 'sess9',
                },
                entity: 'PromoCode',
                entityId: 'promo-1',
                action: 'PROMO_CODE_CREATE',
            });

            const all = await adapter.auditQuery.list({});
            assert.equal(all.length, 2);

            const byAction = await adapter.auditQuery.list({ action: 'TENANT_SUSPEND' });
            assert.equal(byAction.length, 1);
            assert.equal(byAction[0].entityId, 'tenant-a');
            assert.equal(byAction[0].actorTag, 'cli:ops@example.com:host1');
            assert.equal(byAction[0].userId, 'admin-1');

            const cliOnly = await adapter.auditQuery.list({ actorTag: 'cli:*' });
            assert.equal(cliOnly.length, 1);
            assert.equal(cliOnly[0].action, 'TENANT_SUSPEND');
        });

        test('MFA secret roundtrip', async (t) => {
            const { adapter } = harness;
            if (!adapter.mfa) {
                t.skip('adapter provides no MfaPort');
                return;
            }
            assert.equal(await adapter.mfa.getSecret('admin-1'), null);
            assert.equal(await adapter.mfa.isEnabled('admin-1'), false);

            await adapter.mfa.setSecret('admin-1', 'JBSWY3DPEHPK3PXP');
            assert.equal(await adapter.mfa.getSecret('admin-1'), 'JBSWY3DPEHPK3PXP');
            assert.equal(await adapter.mfa.isEnabled('admin-1'), true);

            await adapter.mfa.setSecret('admin-1', null);
            assert.equal(await adapter.mfa.getSecret('admin-1'), null);
            assert.equal(await adapter.mfa.isEnabled('admin-1'), false);
        });

        // -------------------------------------------------------------
        // Promo subscription lookup
        // -------------------------------------------------------------
        //
        // The read a promo code is validated against. It answers by
        // subscription id rather than by tenant, which is what makes returning
        // the wrong row possible — and a wrong row here decides that a discount
        // applies to a subscription it was not meant for.
        //
        // The scenarios below are written against that: several subscriptions
        // exist in every one of them, because an adapter that ignores its
        // predicate is correct for a table with a single row.

        test('finds the subscription the id names, not merely a subscription', async (t) => {
            const { adapter, seed } = harness;
            if (!adapter.promoSubscriptionLookup) {
                t.skip('adapter provides no PromoSubscriptionLookup');
                return;
            }
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: { users: 5 },
                features: ['CORE'],
                published: true,
            });
            const first = await seed.createSubscription({
                tenantId: 'tenant-a',
                plan: 'STARTER',
                planVersionId,
            });
            const second = await seed.createSubscription({
                tenantId: 'tenant-b',
                plan: 'STARTER',
                planVersionId,
            });

            const found = await adapter.promoSubscriptionLookup.findById(second.subscriptionId);
            assert.ok(found, 'the lookup found nothing for an id that exists');
            assert.equal(found.id, second.subscriptionId);
            assert.equal(found.tenantId, 'tenant-b', 'it returned another tenant’s subscription');
            assert.notEqual(found.id, first.subscriptionId);
        });

        test('returns null for an id that does not exist', async (t) => {
            const { adapter, seed } = harness;
            if (!adapter.promoSubscriptionLookup) {
                t.skip('adapter provides no PromoSubscriptionLookup');
                return;
            }
            // With a row present, so that "returns null" cannot be satisfied by
            // an empty table.
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: {},
                features: [],
                published: true,
            });
            await seed.createSubscription({ tenantId: 'tenant-a', plan: 'STARTER', planVersionId });

            assert.equal(
                await adapter.promoSubscriptionLookup.findById(
                    '00000000-0000-4000-8000-000000000000',
                ),
                null,
            );
        });

        test('carries the fields a promo rule reads: cycle and start date', async (t) => {
            const { adapter, seed } = harness;
            if (!adapter.promoSubscriptionLookup) {
                t.skip('adapter provides no PromoSubscriptionLookup');
                return;
            }
            // A promo code may be restricted to a billing cycle, or to
            // subscriptions started before a date. Both come from here, so both
            // have to survive the round trip — a null `startedAt` is a real
            // state and must not arrive as a date.
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'PRO',
                version: 1,
                quotas: {},
                features: [],
                published: true,
            });
            const startedAt = new Date('2026-03-04T05:06:07.000Z');
            const dated = await seed.createSubscription({
                tenantId: 'tenant-a',
                plan: 'PRO',
                planVersionId,
                billingCycle: 'MONTHLY',
                startedAt,
            });
            const undated = await seed.createSubscription({
                tenantId: 'tenant-b',
                plan: 'PRO',
                planVersionId,
            });

            const withDate = await adapter.promoSubscriptionLookup.findById(dated.subscriptionId);
            assert.equal(withDate?.plan, 'PRO');
            assert.equal(withDate?.billingCycle, 'MONTHLY');
            assert.equal(withDate?.startedAt?.toISOString(), startedAt.toISOString());

            const withoutDate = await adapter.promoSubscriptionLookup.findById(
                undated.subscriptionId,
            );
            assert.equal(withoutDate?.startedAt, null, 'an unset start date came back as a date');
        });

        test('reads inside a transaction, so validation and redemption agree', async (t) => {
            const { adapter, seed } = harness;
            if (!adapter.promoSubscriptionLookup) {
                t.skip('adapter provides no PromoSubscriptionLookup');
                return;
            }
            // Redeeming a code validates and writes in one transaction. A
            // lookup that ignored the handed-in context would read outside it
            // and could answer from a state the transaction has already moved
            // past.
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: {},
                features: [],
                published: true,
            });
            const { subscriptionId } = await seed.createSubscription({
                tenantId: 'tenant-a',
                plan: 'STARTER',
                planVersionId,
            });

            const seen = await adapter.transactionRunner.run(async (tx) =>
                adapter.promoSubscriptionLookup!.findById(subscriptionId, tx),
            );
            assert.equal(seen?.id, subscriptionId);
            assert.equal(seen?.tenantId, 'tenant-a');
        });

        // -------------------------------------------------------------
        // Roadmap scenarios — always visible, skipped until the slice ships
        // -------------------------------------------------------------

        test('immutable subscription contracts (append-only, terminate-only)', (t) => {
            if (!harness.adapter.subscriptionContractRepository) {
                t.skip('adapter provides no SubscriptionContractRepository — scenario pending');
                return;
            }
            assert.fail(
                'SubscriptionContractRepository present but the contract kit has no scenario yet — extend the kit',
            );
        });
    });
}
