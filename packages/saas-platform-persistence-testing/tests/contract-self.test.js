import { persistenceAdapterContract } from '../dist/index.js';

// Self-test of the contract kit: an in-memory reference adapter with correct
// semantics must pass the suite. Lock scenarios gate off via
// `pessimisticLocking: false` (in-memory cannot emulate row locks — the
// same reason the nest fakes must not be used to "verify" adapters).

function createMemoryHarness() {
    let idCounter = 0;
    const nextId = (prefix) => `${prefix}-${++idCounter}`;
    let state;
    const freshState = () => ({
        planVersions: [],
        subscriptions: [],
        promoCodes: [],
        redemptions: [],
        audits: [],
        mfa: new Map(),
    });

    const transactionRunner = {
        async run(fn) {
            const snapshot = structuredClone(state);
            try {
                return await fn({ memoryTx: true });
            } catch (err) {
                state = snapshot;
                throw err;
            }
        },
    };

    const subscriptionRepository = {
        async findByTenantId(tenantId) {
            const row = state.subscriptions.find((s) => s.tenantId === tenantId) ?? null;
            if (!row) return null;
            const pv = state.planVersions.find((v) => v.id === row.planVersionId);
            return {
                id: row.id,
                tenantId: row.tenantId,
                plan: row.plan,
                status: row.status,
                planVersionId: row.planVersionId,
                planVersion: { planId: pv.planId, quotas: pv.quotas, features: pv.features },
            };
        },
        async findByTenantIdLocked(tenantId) {
            return this.findByTenantId(tenantId);
        },
        async countByPlanVersionId(planVersionId) {
            return state.subscriptions.filter(
                (s) =>
                    s.planVersionId === planVersionId || s.pendingPlanVersionId === planVersionId,
            ).length;
        },
    };

    const planVersionRepository = {
        async findLatestLive(planId) {
            const live = state.planVersions
                .filter((v) => v.planId === planId && v.publishedAt && !v.supersededAt)
                .sort((a, b) => b.version - a.version)[0];
            return live
                ? { planId: live.planId, quotas: live.quotas, features: live.features }
                : null;
        },
    };

    const tenantSubscriptionWrite = {
        async changePlanImmediate(tenantId, input) {
            const row = state.subscriptions.find(
                (subscription) => subscription.tenantId === tenantId,
            );
            if (!row) throw new Error(`No subscription for tenant ${tenantId}.`);
            const target = state.planVersions
                .filter(
                    (version) =>
                        version.planId === input.planId &&
                        version.publishedAt &&
                        !version.supersededAt,
                )
                .sort((a, b) => b.version - a.version)[0];
            if (!target) throw new Error(`No active PlanVersion for plan ${input.planId}.`);
            row.plan = input.planId;
            row.planVersionId = target.id;
            row.pendingPlanVersionId = null;
            return { plan: row.plan, billingCycle: input.cycle };
        },
        async applyOnboardingSelection(tenantId, input, redeemPromo) {
            return transactionRunner.run(async (tx) => {
                const changed = await tenantSubscriptionWrite.changePlanImmediate(tenantId, {
                    ...input,
                    trialEndsAt: null,
                });
                const row = state.subscriptions.find(
                    (subscription) => subscription.tenantId === tenantId,
                );
                const promoRedemption = redeemPromo ? await redeemPromo(tx, row.id) : null;
                return {
                    ...changed,
                    subscriptionId: row.id,
                    promoRedemption,
                };
            });
        },
        async schedulePlanChange() {},
        async acceptPendingPlanVersion() {
            return {
                accepted: true,
                acceptedAt: new Date(),
                effectiveAt: null,
                alreadyAccepted: false,
            };
        },
        async cancelSubscription() {
            return { canceledAt: new Date(), status: 'CANCELED' };
        },
    };

    const promoCodeRepository = {
        async findById(id) {
            const row = state.promoCodes.find((c) => c.id === id);
            return row ? { ...row } : null;
        },
        async claimSlot(id) {
            const row = state.promoCodes.find((c) => c.id === id);
            if (!row || row.status !== 'ACTIVE') return false;
            if (row.maxRedemptions !== null && row.redemptionsCount >= row.maxRedemptions) {
                return false;
            }
            row.redemptionsCount += 1;
            return true;
        },
        async markExhaustedIfFull(id) {
            const row = state.promoCodes.find((c) => c.id === id);
            if (
                row &&
                row.status === 'ACTIVE' &&
                row.maxRedemptions !== null &&
                row.redemptionsCount >= row.maxRedemptions
            ) {
                row.status = 'EXHAUSTED';
            }
        },
        async releaseSlot(id) {
            const row = state.promoCodes.find((c) => c.id === id);
            if (!row) return;
            row.redemptionsCount = Math.max(row.redemptionsCount - 1, 0);
            if (row.status === 'EXHAUSTED') row.status = 'ACTIVE';
        },
    };

    const promoCodeRedemptionRepository = {
        async findBySubscription(subscriptionId) {
            return state.redemptions.find((r) => r.subscriptionId === subscriptionId) ?? null;
        },
        async create(data) {
            if (state.redemptions.some((r) => r.subscriptionId === data.subscriptionId)) {
                throw new Error('unique violation: one redemption per subscription');
            }
            const row = {
                id: nextId('red'),
                status: 'ACTIVE',
                redeemedAt: new Date(),
                reversedAt: null,
                ...data,
            };
            state.redemptions.push(row);
            return row;
        },
    };

    const audit = {
        async write(input) {
            state.audits.push({
                id: nextId('audit'),
                tenantId: null,
                userId: input.actor.userId,
                userEmail: input.actor.email,
                entity: input.entity,
                entityId: input.entityId,
                action: input.action,
                changes: input.changes ?? null,
                actorTag: `${input.actor.source}:${input.actor.email}:${input.actor.context}`,
                ipAddress: null,
                userAgent: null,
                createdAt: new Date().toISOString(),
            });
        },
    };

    const auditQuery = {
        async list(filter) {
            return state.audits.filter((entry) => {
                if (filter.action && entry.action !== filter.action) return false;
                if (filter.actorTag) {
                    if (filter.actorTag.endsWith('*')) {
                        if (!entry.actorTag.startsWith(filter.actorTag.slice(0, -1))) return false;
                    } else if (entry.actorTag !== filter.actorTag) {
                        return false;
                    }
                }
                return true;
            });
        },
    };

    const mfa = {
        async getSecret(userId) {
            return state.mfa.get(userId) ?? null;
        },
        async setSecret(userId, secret) {
            if (secret === null) state.mfa.delete(userId);
            else state.mfa.set(userId, secret);
        },
        async isEnabled(userId) {
            return state.mfa.has(userId);
        },
    };

    const seed = {
        async createPlanVersion(input) {
            const row = {
                id: nextId('pv'),
                planId: input.planKey,
                version: input.version,
                quotas: input.quotas,
                features: input.features,
                publishedAt: input.published ? new Date() : null,
                supersededAt: input.superseded ? new Date() : null,
            };
            state.planVersions.push(row);
            return { planVersionId: row.id };
        },
        async createSubscription(input) {
            const row = {
                id: nextId('sub'),
                tenantId: input.tenantId,
                plan: input.plan,
                status: input.status ?? 'ACTIVE',
                planVersionId: input.planVersionId,
                pendingPlanVersionId: input.pendingPlanVersionId ?? null,
            };
            state.subscriptions.push(row);
            return { subscriptionId: row.id };
        },
        async createPromoCode(input) {
            const row = {
                id: nextId('promo'),
                code: input.code,
                status: input.status ?? 'ACTIVE',
                maxRedemptions: input.maxRedemptions,
                redemptionsCount: 0,
            };
            state.promoCodes.push(row);
            return { promoCodeId: row.id };
        },
    };

    return {
        adapter: {
            capabilities: {
                transactions: true,
                pessimisticLocking: false,
                rowLevelSecurity: false,
                advisoryLocks: false,
            },
            transactionRunner,
            subscriptionRepository,
            planVersionRepository,
            promoCodeRepository,
            promoCodeRedemptionRepository,
            audit,
            auditQuery,
            mfa,
            tenantSubscriptionWrite,
        },
        seed,
        async reset() {
            state = freshState();
        },
    };
}

persistenceAdapterContract({
    name: 'in-memory reference adapter (self-test)',
    projectKey: 'memory-contract',
    create: async () => createMemoryHarness(),
});
