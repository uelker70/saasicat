// @requirement SC-COMP-011

import { ACTIVE_SUBSCRIPTION_CONTRACT_STATUSES } from '@saasicat/core';
import { persistenceAdapterContract } from '../dist/index.js';

// Self-test of the contract kit: an in-memory reference adapter with correct
// semantics must pass the suite. Lock scenarios gate off via
// `pessimisticLocking: false` (in-memory cannot emulate row locks — the
// same reason the nest fakes must not be used to "verify" adapters).

// A fixed instant: this harness has no clock of its own, and a timestamp that
// moves between two reads is a difference no scenario asked for.
const FIXED_NOW = new Date('2026-01-01T00:00:00.000Z');

function createMemoryHarness() {
    let idCounter = 0;
    const nextId = (prefix) => `${prefix}-${++idCounter}`;
    let state;
    const freshState = () => ({
        plans: [],
        planVersions: [],
        subscriptions: [],
        bundles: [],
        bundleVersions: [],
        subscriptionBundles: [],
        promoCodes: [],
        redemptions: [],
        audits: [],
        mfa: new Map(),
        contracts: [],
        contractLines: [],
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
            // The contract's own claim: the write takes the row only while the
            // cancellation is what the caller read. This reference store keeps
            // the field as `null` unless something set it, which is what the
            // real column does.
            if ((row.canceledAt ?? null) !== (input.expectedCanceledAt ?? null)) {
                return { plan: row.plan, billingCycle: row.billingCycle, claimed: false };
            }
            row.plan = input.planId;
            row.planVersionId = target.id;
            row.pendingPlanVersionId = null;
            return { plan: row.plan, billingCycle: input.cycle, claimed: true };
        },
        async applyOnboardingSelection(tenantId, input, redeemPromo) {
            return transactionRunner.run(async (tx) => {
                const changed = await tenantSubscriptionWrite.changePlanImmediate(tenantId, {
                    ...input,
                    trialEndsAt: null,
                    expectedCanceledAt: null,
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

    // The booking junction. Dumb persistence on purpose: what a booking may
    // commit to is decided above it, and an adapter that decided any of it
    // would stop being interchangeable with the ones that do not.
    const subscriptionBundleRepository = {
        async add(data) {
            const row = {
                id: nextId('sb'),
                subscriptionId: data.subscriptionId,
                bundleVersionId: data.bundleVersionId,
                startedAt: data.startedAt,
                minimumTermEndsAt: data.minimumTermEndsAt ?? null,
                billingCycle: data.billingCycle ?? null,
                currentPeriodStart: data.currentPeriodStart ?? null,
                currentPeriodEnd: data.currentPeriodEnd ?? null,
                canceledAt: null,
                canceledEffectiveAt: null,
            };
            state.subscriptionBundles.push(row);
            return { ...row };
        },
        async listBySubscription(subscriptionId) {
            return state.subscriptionBundles
                .filter((row) => row.subscriptionId === subscriptionId)
                .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
                .map((row) => ({ ...row }));
        },
        async findById(id) {
            const row = state.subscriptionBundles.find((candidate) => candidate.id === id);
            return row ? { ...row } : null;
        },
        async listActiveBySubscription(subscriptionId, now = new Date()) {
            return state.subscriptionBundles
                .filter(
                    (row) =>
                        row.subscriptionId === subscriptionId &&
                        (row.canceledAt === null || row.canceledEffectiveAt > now),
                )
                .map((row) => ({ ...row }));
        },
        async cancel(id, { canceledAt, canceledEffectiveAt }) {
            // Refuses an already-cancelled booking, as the port says and both
            // real adapters now do. A reference implementation that is lenient
            // where they are strict is not a reference.
            const row = state.subscriptionBundles.find(
                (candidate) => candidate.id === id && candidate.canceledAt === null,
            );
            if (!row) throw new Error(`SubscriptionBundle '${id}' not found or already cancelled`);
            row.canceledAt = canceledAt;
            row.canceledEffectiveAt = canceledEffectiveAt;
            return { ...row };
        },
        async reactivate(id) {
            const row = state.subscriptionBundles.find((candidate) => candidate.id === id);
            if (!row) throw new Error(`SubscriptionBundle '${id}' not found`);
            row.canceledAt = null;
            row.canceledEffectiveAt = null;
            return { ...row };
        },
        async countActiveByBundleVersionId(bundleVersionId, now = new Date()) {
            return state.subscriptionBundles.filter(
                (row) =>
                    row.bundleVersionId === bundleVersionId &&
                    (row.canceledAt === null || row.canceledEffectiveAt > now),
            ).length;
        },
    };

    // The catalogue behind the bookings. Enough of it for the scenarios that
    // exercise discarding and publishing; `findActiveBundleVersion` is
    // deliberately absent, so the validity-window scenario still gates off by
    // capability rather than being answered by an implementation that does not
    // maintain windows.
    // The same statuses the adapters look a live contract up under. Imported
    // rather than restated: a status added to the list must reach this
    // reference too, or the self-test stops describing what the adapters do.
    const ACTIVE_CONTRACT_STATUSES = [...ACTIVE_SUBSCRIPTION_CONTRACT_STATUSES];
    const inWindow = (row, asOf) =>
        row.effectiveFrom <= asOf && (row.effectiveUntil === null || row.effectiveUntil > asOf);
    const byNewestFirst = (a, b) => b.effectiveFrom - a.effectiveFrom || b.createdAt - a.createdAt;
    const withLines = (row) => ({
        ...row,
        lineItems: state.contractLines
            .filter((line) => line.contractId === row.id)
            .map((line) => ({ ...line })),
    });

    // Contracts, append-only. There is no `update` here on purpose: the port
    // has none, and an implementation that quietly offered one would let a
    // scenario pass against a shape no real adapter can produce.
    const subscriptionContractRepository = {
        async create(data) {
            const contractId = nextId('contract');
            state.contracts.push({
                id: contractId,
                tenantId: data.tenantId,
                status: data.status ?? 'active',
                effectiveFrom: data.effectiveFrom,
                effectiveUntil: data.effectiveUntil ?? null,
                originalOfferId: data.originalOfferId ?? null,
                originalPlanVersionId: data.originalPlanVersionId ?? null,
                originalBundleVersionIds: data.originalBundleVersionIds ?? [],
                entitlementSnapshot: data.entitlementSnapshot ?? null,
                priceSnapshot: data.priceSnapshot,
                promotionSnapshots: data.promotionSnapshots ?? [],
                promoCodeSnapshots: data.promoCodeSnapshots ?? [],
                termsSnapshot: data.termsSnapshot ?? null,
                createdAt: FIXED_NOW,
                updatedAt: FIXED_NOW,
            });
            for (const item of data.lineItems) {
                state.contractLines.push({
                    ...item,
                    id: nextId('line'),
                    contractId,
                    createdAt: FIXED_NOW,
                });
            }
            return subscriptionContractRepository.findById(contractId);
        },
        async findById(contractId) {
            const row = state.contracts.find((candidate) => candidate.id === contractId);
            return row ? withLines(row) : null;
        },
        async findActiveByTenantId(tenantId, asOf = FIXED_NOW) {
            const live = state.contracts
                .filter(
                    (row) =>
                        row.tenantId === tenantId &&
                        ACTIVE_CONTRACT_STATUSES.includes(row.status) &&
                        inWindow(row, asOf),
                )
                .sort(byNewestFirst);
            return live[0] ? withLines(live[0]) : null;
        },
        async list(filter) {
            return state.contracts
                .filter(
                    (row) =>
                        (!filter.tenantId || row.tenantId === filter.tenantId) &&
                        (!filter.status || row.status === filter.status) &&
                        (!filter.asOf || inWindow(row, filter.asOf)),
                )
                .sort(byNewestFirst)
                .map(withLines);
        },
        async terminate(contractId, data) {
            const row = state.contracts.find((candidate) => candidate.id === contractId);
            if (!row) throw new Error(`SubscriptionContract '${contractId}' not found.`);
            row.effectiveUntil = data.effectiveUntil;
            if (data.status !== null) row.status = data.status;
            row.updatedAt = FIXED_NOW;
            return withLines(row);
        },
    };

    // The plan stem, which the contract's identity scenarios need. Only the
    // stem: the version lifecycle is `planVersionRepository`'s, and offering a
    // half of it here would make those scenarios pass against a shape no real
    // adapter has.
    const planRepository = {
        async create(data) {
            // `plans_planKey_key` in memory — a key is taken once for the whole
            // installation, retired rows included.
            if (state.plans.some((candidate) => candidate.planKey === data.planKey)) {
                throw new Error(`planKey '${data.planKey}' is already taken.`);
            }
            const row = {
                id: nextId('plan'),
                planKey: data.planKey,
                label: data.label,
                description: data.description ?? null,
                icon: data.icon ?? null,
                sortOrder: data.sortOrder ?? 0,
                createdAt: FIXED_NOW,
                updatedAt: FIXED_NOW,
                deletedAt: null,
            };
            state.plans.push(row);
            return { ...row };
        },
        async findById(planId) {
            const row = state.plans.find((candidate) => candidate.id === planId);
            return row ? { ...row } : null;
        },
        async findByKey(planKey) {
            // Retired rows included, as for bundles: the unique index does not
            // exclude them, and this answers the database's question.
            const row = state.plans.find((candidate) => candidate.planKey === planKey);
            return row ? { ...row } : null;
        },
        async list(filter) {
            const excludeDeleted = filter.excludeDeleted ?? true;
            return state.plans
                .filter((row) => !excludeDeleted || row.deletedAt === null)
                .map((row) => ({ ...row }));
        },
        async update(planId, data) {
            const row = state.plans.find((candidate) => candidate.id === planId);
            if (!row) throw new Error(`Plan '${planId}' not found.`);
            Object.assign(row, data, { updatedAt: FIXED_NOW });
            return { ...row };
        },
        async softDelete(planId) {
            const row = state.plans.find((candidate) => candidate.id === planId);
            if (row) row.deletedAt = FIXED_NOW;
        },
    };

    const bundleRepository = {
        async create(data) {
            // The unique index, in memory: a key is taken once for the whole
            // installation, retired rows included.
            if (state.bundles.some((candidate) => candidate.bundleKey === data.bundleKey)) {
                throw new Error(`bundleKey '${data.bundleKey}' is already taken.`);
            }
            const row = {
                id: nextId('bundle'),
                bundleKey: data.bundleKey,
                label: data.label,
                description: data.description ?? null,
                icon: data.icon ?? null,
                sortOrder: data.sortOrder ?? 0,
                i18n: data.i18n ?? {},
                createdAt: FIXED_NOW,
                updatedAt: FIXED_NOW,
                deletedAt: null,
            };
            state.bundles.push(row);
            return { ...row };
        },
        async findById(bundleId) {
            const row = state.bundles.find((candidate) => candidate.id === bundleId);
            return row ? { ...row } : null;
        },
        async findByKey(bundleKey) {
            // Retired rows included: the unique index does not exclude them, and
            // this method answers the database's question.
            const row = state.bundles.find((candidate) => candidate.bundleKey === bundleKey);
            return row ? { ...row } : null;
        },
        async list(filter) {
            const excludeDeleted = filter.excludeDeleted ?? true;
            return state.bundles
                .filter((row) => !excludeDeleted || row.deletedAt === null)
                .map((row) => ({ ...row }));
        },
        async softDelete(bundleId) {
            const row = state.bundles.find((candidate) => candidate.id === bundleId);
            if (row) row.deletedAt = FIXED_NOW;
        },
        async createDraft(data) {
            const versions = state.bundleVersions.filter((v) => v.bundleId === data.bundleId);
            const row = {
                id: nextId('bv'),
                bundleId: data.bundleId,
                version: versions.length + 1,
                features: [...data.features],
                quotas: data.quotas ?? {},
                publishedAt: null,
                supersededAt: null,
                validFrom: null,
                validUntil: null,
            };
            state.bundleVersions.push(row);
            return { ...row };
        },
        async findVersionById(versionId) {
            const row = state.bundleVersions.find((candidate) => candidate.id === versionId);
            return row ? { ...row } : null;
        },
        async publishDraft(versionId, meta) {
            // Claimed before the predecessor is touched, as both real adapters
            // do: a second publication of one draft must lose before it changes
            // anything, or the two windows end up a gap or an overlap.
            const row = state.bundleVersions.find(
                (candidate) => candidate.id === versionId && candidate.publishedAt === null,
            );
            if (!row) {
                throw new Error(`BundleVersion '${versionId}' not found or already published.`);
            }
            for (const other of state.bundleVersions) {
                if (other.bundleId !== row.bundleId || other.id === versionId) continue;
                if (!other.publishedAt || other.supersededAt) continue;
                other.supersededAt = FIXED_NOW;
                const closesAt = new Date(meta.validFrom);
                closesAt.setUTCDate(closesAt.getUTCDate() - 1);
                other.validUntil = closesAt;
            }
            row.publishedAt = FIXED_NOW;
            row.validFrom = meta.validFrom;
            row.validUntil = meta.validUntil;
            row.supersededAt = null;
            return { ...row };
        },
        async deleteDraft(versionId) {
            const index = state.bundleVersions.findIndex(
                (candidate) => candidate.id === versionId && candidate.publishedAt === null,
            );
            if (index >= 0) {
                state.bundleVersions.splice(index, 1);
                return;
            }
            // Gone is the state the caller wanted; published is a refusal they
            // have to see. Same distinction both real adapters make.
            if (!state.bundleVersions.some((candidate) => candidate.id === versionId)) return;
            throw new Error(
                `BundleVersion '${versionId}' is already published and cannot be discarded.`,
            );
        },
    };

    const seed = {
        async clearBookingRequestDate(subscriptionBundleId) {
            const row = state.subscriptionBundles.find(
                (candidate) => candidate.id === subscriptionBundleId,
            );
            if (row) row.canceledAt = null;
        },
        async createBundleVersion(input) {
            const row = {
                id: nextId('bv'),
                bundleKey: input.bundleKey,
                features: [...input.features],
                quotas: {},
                publishedAt: new Date(),
            };
            state.bundleVersions.push(row);
            return { bundleVersionId: row.id };
        },
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
                billingCycle: input.billingCycle ?? 'YEARLY',
                startedAt: input.startedAt ?? null,
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

    /**
     * The reference implementation of the promo subscription lookup.
     *
     * Deliberately written the correct way — by id, from the whole set — so
     * that the contract's scenarios pass here. They exist because the same
     * read done wrong decides that a discount applies to a subscription it was
     * not meant for, and a table with one row cannot tell the two apart.
     */
    const promoSubscriptionLookup = {
        async findById(subscriptionId) {
            const row = state.subscriptions.find((s) => s.id === subscriptionId);
            if (!row) return null;
            return {
                id: row.id,
                tenantId: row.tenantId,
                plan: row.plan,
                billingCycle: row.billingCycle,
                startedAt: row.startedAt,
            };
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
            promoSubscriptionLookup,
            subscriptionBundleRepository,
            planRepository,
            bundleRepository,
            subscriptionContractRepository,
        },
        seed,
        async reset() {
            state = freshState();
        },
    };
}

persistenceAdapterContract({
    name: 'in-memory reference adapter (self-test)',
    create: async () => createMemoryHarness(),
});
