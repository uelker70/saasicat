// EntitlementService — Slice B: NestJS service with DI, LRU cache,
// repository ports + transactional `enforceLimit`.
//
// Slice A (aggregation.ts + plan-resolution.ts) provides the pure functions;
// this service orchestrates them with the consumer adapters (Subscription/
// PlanVersion repositories, TransactionRunner) and an in-memory cache.

import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type {
    BundleRepository,
    DiscoverySnapshot,
    PlanCatalog,
    PlanVersionRepository,
    SubscriptionBundleRepository,
    SubscriptionContractRepository,
    SubscriptionRecord,
    SubscriptionRepository,
    TransactionContext,
    TransactionRunner,
} from '@saasicat/types';
import { BUNDLE_REPOSITORY_TOKEN } from '../catalog/tokens.js';
import { PLAN_CATALOG_TOKEN } from '../billing/plan-catalog.module.js';
import { SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN } from '../billing/subscription-bundles.tokens.js';
import { SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN } from '../subscription-contract/tokens.js';
import { DISCOVERY_SNAPSHOT_TOKEN } from '../discovery/tokens.js';
import { aggregateContractLineItemEntitlements, aggregateLimits } from './aggregation.js';
import {
    buildReplacedByIndex,
    expandReplacedFeatures,
    type ReplacedByIndex,
} from './feature-aliases.js';
import { LimitExceededError } from './limit-exceeded-error.js';
import { resolveEntitlementPlan, type EntitlementResolutionConfig } from './plan-resolution.js';
import {
    ENTITLEMENT_RESOLUTION_CONFIG_TOKEN,
    PLAN_VERSION_REPOSITORY_TOKEN,
    SUBSCRIPTION_REPOSITORY_TOKEN,
    TRANSACTION_RUNNER_TOKEN,
} from './tokens.js';
import type { EffectiveLimits, SubscriptionBundleSnapshot } from './types.js';

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 1_000;

interface CacheEntry {
    value: EffectiveLimits;
    expiresAt: number;
}

export interface EnforceLimitInput<T> {
    /** Tenant whose subscription is checked. */
    tenantId: string;
    /** Quota key from saas.yaml (`users`, `vehicles`, `storageGb`, …). */
    dimension: string;
    /**
     * Counter for the units currently consumed within the transaction.
     * The consumer counts e.g. `users WHERE tenantId AND deletedAt IS NULL`.
     */
    currentUsage: (tx: TransactionContext, tenantId: string) => Promise<number>;
    /**
     * Inserts the new row(s). Only executed when the limit is not exceeded
     * after the increment.
     */
    insert: (tx: TransactionContext) => Promise<T>;
    /**
     * Increment that `insert` adds to the usage. Default 1
     * (USERS/VEHICLES — one row per insert). For STORAGE inserts the caller
     * can pass variable GB values through, so that even a 10 GB file blocks
     * against a 1 GB limit.
     */
    delta?: number;
    /** Override for tests; default `new Date()`. */
    now?: Date;
}

@Injectable()
export class EntitlementService {
    // Map preserves insert order — on a hit the entry is removed and
    // re-inserted (LRU). The TTL is a safety net for forgotten
    // invalidations — 60s is enough, because limits generally only change
    // through mutations, not through time (a pending plan's effective date
    // is day-granular).
    private readonly cache = new Map<string, CacheEntry>();

    // #39 — replaces alias index, built lazily from the boot-static snapshot;
    // throws on replaces cycles (a clear error instead of an infinite loop).
    private replacedByIndex: ReplacedByIndex | null = null;

    constructor(
        @Inject(PLAN_CATALOG_TOKEN) private readonly catalog: PlanCatalog,
        @Inject(SUBSCRIPTION_REPOSITORY_TOKEN)
        private readonly subscriptions: SubscriptionRepository,
        @Inject(PLAN_VERSION_REPOSITORY_TOKEN)
        private readonly planVersions: PlanVersionRepository,
        @Inject(TRANSACTION_RUNNER_TOKEN)
        private readonly tx: TransactionRunner,
        @Optional()
        @Inject(ENTITLEMENT_RESOLUTION_CONFIG_TOKEN)
        private readonly resolutionConfig: EntitlementResolutionConfig | null = null,
        // P11.7.3 — SubscriptionBundle aggregation. Optional, so that apps
        // without bundle bookings keep using the service unchanged.
        @Optional()
        @Inject(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN)
        private readonly subscriptionBundles: SubscriptionBundleRepository | null = null,
        @Optional()
        @Inject(BUNDLE_REPOSITORY_TOKEN)
        private readonly bundles: BundleRepository | null = null,
        @Optional()
        @Inject(SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN)
        private readonly subscriptionContracts: SubscriptionContractRepository | null = null,
        // #39 — replaces aliases: contracts with an old feature key also
        // grant the new feature. Optional, so that apps without a
        // DiscoveryModule keep using the service unchanged (then no alias
        // resolution).
        @Optional()
        @Inject(DISCOVERY_SNAPSHOT_TOKEN)
        private readonly discoverySnapshot: DiscoverySnapshot | null = null,
    ) {}

    // ---------------------------------------------------------------------
    // Read path — for FeatureGuard, sidebar hooks, GET /billing/entitlement
    // ---------------------------------------------------------------------

    async computeLimits(tenantId: string, now = new Date()): Promise<EffectiveLimits> {
        const cached = this.readCache(tenantId, now.getTime());
        if (cached) return cached;

        const sub = await this.subscriptions.findByTenantId(tenantId);
        if (!sub) {
            throw new NotFoundException(`Keine Subscription für Tenant ${tenantId}`);
        }
        const limits = await this.deriveLimits(sub, now);
        this.writeCache(tenantId, limits, now.getTime());
        return limits;
    }

    /**
     * Clears a tenant's cache entry. MUST be called as soon as a mutation
     * changes the subscription, a bundle booking, or a PlanVersion binding —
     * otherwise FeatureGuard and the sidebar stay on stale state for up to
     * 60s.
     */
    invalidateTenant(tenantId: string): void {
        this.cache.delete(tenantId);
    }

    /** Clears the entire cache. Only for tests / bootstrap. */
    invalidateAll(): void {
        this.cache.clear();
    }

    /**
     * Aggregator path — also callable directly by consumers that already
     * have a `SubscriptionRecord` (e.g. within a transaction).
     */
    async deriveLimits(
        sub: SubscriptionRecord,
        now: Date,
        tx?: TransactionContext,
    ): Promise<EffectiveLimits> {
        const contractLimits = await this.deriveLimitsFromContract(sub.tenantId, now);
        if (contractLimits) return this.withReplacedFeatureAliases(contractLimits);

        const effectivePlan = resolveEntitlementPlan(sub, this.resolutionConfig ?? {}, now);
        const planVersion =
            effectivePlan === sub.plan
                ? sub.planVersion
                : await this.findActivePlanVersionOrFallback(effectivePlan, now, tx);

        const subscriptionBundles = await this.loadSubscriptionBundleSnapshots(sub.id, now);

        return this.withReplacedFeatureAliases(
            aggregateLimits(
                {
                    plan: effectivePlan,
                    planVersion,
                    subscriptionBundles,
                    customLimits: sub.customLimits ?? null,
                },
                this.catalog,
                now,
            ),
        );
    }

    /**
     * Grandfathering (#39): granted old feature keys transitively grant
     * their successors from the `replaces` chains of the discovery snapshot.
     * A no-op without a snapshot or without replaces declarations.
     */
    private withReplacedFeatureAliases(limits: EffectiveLimits): EffectiveLimits {
        if (!this.discoverySnapshot) return limits;
        if (!this.replacedByIndex) {
            this.replacedByIndex = buildReplacedByIndex(this.discoverySnapshot.features);
        }
        if (this.replacedByIndex.size === 0) return limits;
        return {
            ...limits,
            features: expandReplacedFeatures(limits.features, this.replacedByIndex),
        };
    }

    private async deriveLimitsFromContract(
        tenantId: string,
        now: Date,
    ): Promise<EffectiveLimits | null> {
        if (!this.subscriptionContracts) return null;
        const contract = await this.subscriptionContracts.findActiveByTenantId(tenantId, now);
        if (!contract) return null;
        if (contract.entitlementSnapshot) {
            return {
                plan: contract.entitlementSnapshot.plan,
                quotas: { ...contract.entitlementSnapshot.quotas },
                features: new Set(contract.entitlementSnapshot.features),
            };
        }
        return aggregateContractLineItemEntitlements(contract.lineItems);
    }

    /**
     * Loads a subscription's active bundle bookings and resolves the
     * `BundleVersion` features/quotas per entry. Without a registered
     * `SubscriptionBundleRepository` or `BundleRepository` the method
     * returns an empty list — apps without a bundle schema stay unchanged
     * (plan-only aggregation).
     */
    private async loadSubscriptionBundleSnapshots(
        subscriptionId: string,
        now: Date,
    ): Promise<SubscriptionBundleSnapshot[]> {
        if (!this.subscriptionBundles || !this.bundles) return [];
        const active = await this.subscriptionBundles.listActiveBySubscription(subscriptionId, now);
        if (active.length === 0) return [];
        return Promise.all(
            active.map(async (booking) => {
                const bv = await this.bundles!.findVersionById(booking.bundleVersionId);
                if (!bv) {
                    // Hard fail: an active booking points to a BundleVersion
                    // that no longer exists — data inconsistency, should never
                    // happen (BundleVersion is a Restrict FK).
                    throw new Error(
                        `BundleVersion '${booking.bundleVersionId}' aus aktiver SubscriptionBundle nicht gefunden`,
                    );
                }
                return {
                    bundleKey: bv.bundleKey,
                    features: bv.features,
                    quotas: bv.quotas,
                    canceledEffectiveAt: booking.canceledEffectiveAt,
                } satisfies SubscriptionBundleSnapshot;
            }),
        );
    }

    // ---------------------------------------------------------------------
    // Write/consumption path — row lock + count + insert in the same
    // transaction. Protects against race conditions on concurrent creations
    // for the same tenant.
    // ---------------------------------------------------------------------

    async enforceLimit<T>(input: EnforceLimitInput<T>): Promise<T> {
        const now = input.now ?? new Date();
        const delta = input.delta ?? 1;

        return this.tx.run(async (tx) => {
            const sub = await this.subscriptions.findByTenantIdLocked(input.tenantId, tx);
            if (!sub) {
                throw new NotFoundException(`Keine Subscription für Tenant ${input.tenantId}`);
            }

            const limits = await this.deriveLimits(sub, now, tx);
            const max = limits.quotas[input.dimension];
            if (max === undefined) {
                throw new Error(
                    `Quota-Dimension "${input.dimension}" nicht im PlanCatalog (${this.catalog.projectKey}).`,
                );
            }

            const used = await input.currentUsage(tx, input.tenantId);
            // -1 = unlimited (catalog convention).
            if (max !== -1 && used + delta > max) {
                throw new LimitExceededError(input.dimension, max, used);
            }

            return input.insert(tx);
        });
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    /**
     * Plan fallback for TRIAL/PENDING_SALES: returns the PlanVersion active
     * as of `asOf` (SPEC_V2 §4.2). If the repo does not implement
     * `findActive`, we fall back to `findLatestLive` (backward compat for
     * adapters without `validFrom` columns).
     */
    private async findActivePlanVersionOrFallback(
        planId: string,
        asOf: Date,
        tx?: TransactionContext,
    ) {
        const v = this.planVersions.findActive
            ? await this.planVersions.findActive(planId, asOf, tx)
            : await this.planVersions.findLatestLive(planId, tx);
        if (!v) {
            throw new NotFoundException(
                `Keine zu ${asOf.toISOString().slice(0, 10)} aktive PlanVersion für ${planId} — ` +
                    `weder validFrom-window erfüllt noch latest-live verfügbar.`,
            );
        }
        return v;
    }

    private readCache(tenantId: string, nowMs: number): EffectiveLimits | null {
        const entry = this.cache.get(tenantId);
        if (!entry) return null;
        if (entry.expiresAt < nowMs) {
            this.cache.delete(tenantId);
            return null;
        }
        // LRU: move the hit entry to the end of the insert order.
        this.cache.delete(tenantId);
        this.cache.set(tenantId, entry);
        return entry.value;
    }

    private writeCache(tenantId: string, value: EffectiveLimits, nowMs: number): void {
        if (this.cache.has(tenantId)) this.cache.delete(tenantId);
        this.cache.set(tenantId, { value, expiresAt: nowMs + CACHE_TTL_MS });
        // Eviction: drop the oldest entry until the cache limit is met.
        while (this.cache.size > CACHE_MAX_ENTRIES) {
            const oldest = this.cache.keys().next().value;
            if (oldest === undefined) break;
            this.cache.delete(oldest);
        }
    }
}
