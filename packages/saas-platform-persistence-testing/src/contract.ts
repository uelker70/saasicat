// The executable persistence contract. Every adapter runs the SAME
// scenarios against its real database — this is what makes "functionally
// equivalent adapters" a verified claim instead of prose.
//
// Scenario groups gate on adapter capabilities/slices. A gated-off group is
// registered as skipped with the reason, so coverage gaps stay visible in
// the test report.

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { TransactionContext } from '@saasicat/types';
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

            await adapter.tenantSubscriptionWrite.changePlanImmediate('tenant-plan-change', {
                planId: 'PRO',
                cycle: 'YEARLY',
                periodStart: null,
                periodEnd: null,
                nextStatus: null,
            });

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
