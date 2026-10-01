// EntitlementService — Slice B: NestJS service with DI, LRU cache,
// repository ports + transactional `enforceLimit`.
//
// Slice A (aggregation.ts + plan-resolution.ts) provides the pure functions;
// this service orchestrates them with the consumer adapters (Subscription/
// PlanVersion repositories, TransactionRunner) and an in-memory cache.

import {
    Inject,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
    Optional,
} from '@nestjs/common';
import type {
    BundleRepository,
    DiscoverySnapshot,
    PlanCatalog,
    PlanVersionRepository,
    SubscriptionBundleRepository,
    SubscriptionContractRecord,
    SubscriptionContractRepository,
    SubscriptionRecord,
    SubscriptionRepository,
    TransactionContext,
    TransactionRunner,
} from '@saasicat/core';
import { BILLING_ERROR_CODES } from '@saasicat/core';
import { BUNDLE_REPOSITORY_TOKEN } from '../catalog/catalog.tokens.js';
import { PLAN_CATALOG_SOURCE_TOKEN } from '../billing/plan-catalog.module.js';
import type { PlanCatalogSource } from '../billing/plan-catalog-source.js';
import { SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN } from '../billing/subscription-bundles.tokens.js';
import { SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN } from '../subscription-contract/subscription-contract.tokens.js';
import { DISCOVERY_SNAPSHOT_TOKEN } from '../discovery/discovery.tokens.js';
import { codedError } from '../errors/coded-error.js';
import { cancellationHasLanded, cancellationLandsAt } from './landed-cancellation.js';
import {
    aggregateLimits,
    contractBundleVersionIds,
    contractLimits,
    filterPlannedOnlyFeatures,
    isCancellationDeclared,
    mergeSubscriptionBundlesIntoLimits,
} from './aggregation.js';
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
} from './entitlement.tokens.js';
import type { EffectiveLimits, SubscriptionBundleSnapshot } from './entitlement.types.js';
import { subscriptionNotFound } from '../billing/subscription-not-found.js';

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 1_000;

interface CacheEntry {
    value: EffectiveLimits;
    expiresAt: number;
}

/** Limits, and the first date still to come on which they change by themselves. */
interface LimitsAnswer {
    limits: EffectiveLimits;
    /** The earliest end still to come among the add-ons counted, or null. */
    nextBookingEnd: Date | null;
    /** The add-ons left out of `limits` because their cancellation is declared. */
    leftOutBundleVersionIds: string[];
}

/** What a contract frozen at a moment records as its entitlements. */
export interface ContractLimits {
    limits: EffectiveLimits;
    /**
     * The add-ons left out of `limits` because their cancellation is declared.
     * The contract names them in its snapshot, so that their bookings grant
     * them until their effective date and a reader knows the snapshot does not.
     */
    leftOutBundleVersionIds: string[];
}

interface AnswerOptions {
    /**
     * Answers what a contract frozen now records: the add-ons whose
     * cancellation is declared left out, and the contract in force not read —
     * a successor is measured without the agreement it replaces.
     */
    freezing?: boolean;
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
        @Inject(PLAN_CATALOG_SOURCE_TOKEN) private readonly catalogs: PlanCatalogSource,
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

    /**
     * The tenant's effective limits, answered from the cache for up to
     * `CACHE_TTL_MS`. A caller that has already read the catalogue for its own
     * operation passes it as `catalog`: the answer is then computed against
     * that reading and kept out of the cache in both directions — not taken
     * from it, and not written to it, since a reading the caller holds may be
     * older than the one everybody else should be answered from.
     */
    async computeLimits(
        tenantId: string,
        now = new Date(),
        catalog?: PlanCatalog,
    ): Promise<EffectiveLimits> {
        if (!catalog) {
            const cached = this.readCache(tenantId, now.getTime());
            if (cached) return cached;
        }

        const sub = await this.requireSubscription(tenantId);
        if (catalog) return (await this.answerFor(sub, now, catalog)).limits;
        const answer = await this.answerFor(sub, now, await this.catalogs.current());
        // A cached answer may not outlive the cancellation it was computed
        // before — the subscription's or an add-on's. Every other thing that
        // changes these limits is a mutation, and every mutation invalidates
        // the entry; a date arriving is not a mutation, so nothing would have
        // cleared it and the old features would be granted for up to a further
        // minute past the end.
        this.writeCache(
            tenantId,
            answer.limits,
            now.getTime(),
            firstAfter(now, [cancellationLandsAt(sub), answer.nextBookingEnd]),
        );
        return answer.limits;
    }

    /**
     * What a contract frozen at `now` records as its entitlements: what
     * `computeLimits` would grant with no contract in force, less the add-ons
     * whose cancellation is declared. The contract in force is not read, so a
     * successor can be composed — and shown — before the one it replaces ends.
     *
     * Those are granted until their effective date by the booking rather than
     * by the contract (`mergeSubscriptionBundlesIntoLimits`), so their end
     * needs nobody to write the contract again. Frozen into the snapshot, they
     * would be granted for as long as the contract runs. Never cached, like
     * `computeLimits` with a catalogue.
     */
    async computeContractLimits(
        tenantId: string,
        now: Date,
        catalog: PlanCatalog,
    ): Promise<ContractLimits> {
        const sub = await this.requireSubscription(tenantId);
        const { limits, leftOutBundleVersionIds } = await this.answerFor(
            sub,
            now,
            catalog,
            undefined,
            { freezing: true },
        );
        return { limits, leftOutBundleVersionIds };
    }

    /**
     * The features a contract of the tenant covering exactly `bundleVersionIds`
     * records when frozen now, and the plan version they are read from — or
     * `null` where the tenant has no subscription. They are the plan version
     * the subscription is bound to and those add-on versions, each as its row
     * reads today, with the subscription's own arrangement — aliased and
     * filtered the way every grant is.
     *
     * The add-ons are the ones the caller names, not the bookings running now:
     * a vocabulary carried into a contract changes what the add-ons it already
     * covers are called, not which add-ons it covers. Quotas are not asked
     * for, for the same reason.
     */
    async contractFeaturesFor(
        tenantId: string,
        bundleVersionIds: Iterable<string>,
        catalog: PlanCatalog,
    ): Promise<{ planVersionId: string; features: Set<string> } | null> {
        const sub = await this.subscriptions.findByTenantId(tenantId);
        if (!sub) return null;
        const features = new Set<string>(sub.planVersion.features);
        for (const id of bundleVersionIds) {
            const version = this.bundles ? await this.bundles.findVersionById(id) : null;
            if (!version) {
                throw new Error(
                    `The contract covers add-on version '${id}', which cannot be read` +
                        (this.bundles ? '.' : ': no BundleRepository is configured.'),
                );
            }
            for (const feature of version.features) features.add(feature);
        }
        for (const feature of sub.customLimits?.features ?? []) features.add(feature);
        return {
            planVersionId: sub.planVersionId,
            features: this.asGrantable(catalog, { plan: sub.plan, quotas: {}, features }).features,
        };
    }

    /**
     * `features` with every successor a `replaces` declaration carries them to —
     * what a contract holding them is granted beyond its own keys.
     */
    withReplacements(features: ReadonlySet<string>): Set<string> {
        return new Set(
            this.replaceFeatureAliases({ plan: '', quotas: {}, features: new Set(features) })
                .features,
        );
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
        return (await this.answerFor(sub, now, await this.catalogs.current(), tx)).limits;
    }

    private async requireSubscription(tenantId: string): Promise<SubscriptionRecord> {
        const sub = await this.subscriptions.findByTenantId(tenantId);
        if (!sub) {
            throw subscriptionNotFound(tenantId);
        }
        return sub;
    }

    /**
     * `deriveLimits` against a catalogue already read. The catalogue decides
     * which features are `plannedOnly`, and it is read outside any transaction
     * a caller holds, so that checking a limit does not wait for a second
     * connection while the subscription row is locked.
     */
    private async answerFor(
        sub: SubscriptionRecord,
        now: Date,
        catalog: PlanCatalog,
        tx?: TransactionContext,
        options: AnswerOptions = {},
    ): Promise<LimitsAnswer> {
        // A cancellation that has taken effect ends everything below it, and
        // this is the only place that can say so: no repository filters a
        // cancelled subscription out, and the renewal decision stops the
        // billing period without touching what the tenant may do.
        //
        // Before the contract, not after. A contract is the frozen agreement of
        // the subscription that signed it (see the freeze after a plan change),
        // so it cannot outlive the subscription — a tenant whose cancellation
        // has landed keeps nothing by having agreed to something earlier.
        //
        // Bundles and custom limits are not merged into the floor either. They
        // were bought on top of a subscription that has ended.
        if (cancellationHasLanded(sub, now)) {
            const floor = this.resolutionConfig?.canceledEntitlementPlan;
            if (floor === undefined) {
                // The plan is what they had, and nothing comes with it. Naming
                // the plan keeps `effectivePlan` readable on a page that has to
                // say which contract ended; the empty sets are the answer.
                return {
                    limits: { plan: sub.plan, quotas: {}, features: new Set() },
                    nextBookingEnd: null,
                    leftOutBundleVersionIds: [],
                };
            }
            const floorVersion = await this.findPlanVersionOnSale(floor, now, tx);
            const limits = this.asGrantable(
                catalog,
                aggregateLimits(
                    {
                        plan: floor,
                        planVersion: floorVersion,
                        subscriptionBundles: [],
                        customLimits: null,
                    },
                    catalog,
                    now,
                ),
            );
            return { limits, nextBookingEnd: null, leftOutBundleVersionIds: [] };
        }

        const bundles = await this.loadSubscriptionBundleSnapshots(sub.id, now, tx);
        const leftOut = options.freezing ? bundles.filter(isCancellationDeclared) : [];
        const counted = bundles.filter((booking) => !leftOut.includes(booking));
        const leftOutBundleVersionIds = leftOut.map((booking) => booking.bundleVersionId);
        const nextBookingEnd = firstAfter(
            now,
            counted.map((booking) => booking.canceledEffectiveAt),
        );

        const contract = options.freezing
            ? null
            : await this.findActiveContract(sub.tenantId, now, tx);
        if (contract) {
            // Bundles booked after the contract was signed take effect
            // immediately — otherwise the purchase stays without consequence
            // until something re-freezes the contract.
            const covered = contractBundleVersionIds(contract);
            const limits = this.asGrantable(
                catalog,
                mergeSubscriptionBundlesIntoLimits(
                    contractLimits(contract),
                    counted,
                    covered,
                    catalog,
                    now,
                ),
            );
            // Nothing is left out here: only a freeze leaves an add-on out,
            // and a freeze does not read the contract it replaces.
            return { limits, nextBookingEnd, leftOutBundleVersionIds: [] };
        }

        const effectivePlan = resolveEntitlementPlan(sub, this.resolutionConfig ?? {}, now);
        const planVersion =
            effectivePlan === sub.plan
                ? sub.planVersion
                : await this.findPlanVersionOnSale(effectivePlan, now, tx);

        const limits = this.asGrantable(
            catalog,
            aggregateLimits(
                {
                    plan: effectivePlan,
                    planVersion,
                    subscriptionBundles: counted,
                    customLimits: sub.customLimits ?? null,
                },
                catalog,
                now,
            ),
        );
        return { limits, nextBookingEnd, leftOutBundleVersionIds };
    }

    /**
     * The last thing every path does, so that no path can skip it.
     *
     * Two steps, in this order. Grandfathering (#39): granted old feature keys
     * transitively grant their successors from the `replaces` chains of the
     * discovery snapshot — a no-op without a snapshot or without replaces
     * declarations. Then `plannedOnly` features come out.
     *
     * The filter sits here rather than in each branch because it used to sit
     * in each branch and one of them did not have it: limits read from a
     * frozen contract were handed over as they stood, so a feature the
     * catalogue says has no code behind it was granted to whoever had signed
     * before it was marked. A successor pulled in by an alias could arrive the
     * same way. `SC-ENTL-003` says "never … wherever it comes from", and one
     * place is what makes that answerable.
     */
    private asGrantable(catalog: PlanCatalog, limits: EffectiveLimits): EffectiveLimits {
        return {
            ...limits,
            features: filterPlannedOnlyFeatures(
                this.replaceFeatureAliases(limits).features,
                catalog,
            ),
        };
    }

    /**
     * Grandfathering (#39): granted old feature keys transitively grant
     * their successors from the `replaces` chains of the discovery snapshot.
     * A no-op without a snapshot or without replaces declarations.
     */
    private replaceFeatureAliases(limits: EffectiveLimits): EffectiveLimits {
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

    private async findActiveContract(
        tenantId: string,
        now: Date,
        tx?: TransactionContext,
    ): Promise<SubscriptionContractRecord | null> {
        if (!this.subscriptionContracts) return null;
        return this.subscriptionContracts.findActiveByTenantId(tenantId, now, tx);
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
        tx?: TransactionContext,
    ): Promise<SubscriptionBundleSnapshot[]> {
        if (!this.subscriptionBundles || !this.bundles) return [];
        const active = await this.subscriptionBundles.listActiveBySubscription(
            subscriptionId,
            now,
            tx,
        );
        if (active.length === 0) return [];
        return Promise.all(
            active.map(async (booking) => {
                const bv = await this.bundles!.findVersionById(booking.bundleVersionId, tx);
                if (!bv) {
                    // Hard fail: an active booking points to a BundleVersion
                    // that no longer exists — data inconsistency, should never
                    // happen (BundleVersion is a Restrict FK).
                    throw new Error(
                        `BundleVersion '${booking.bundleVersionId}' from an active subscription bundle not found`,
                    );
                }
                return {
                    bundleKey: bv.bundleKey,
                    bundleVersionId: booking.bundleVersionId,
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

        const catalog = await this.catalogs.current();
        return this.tx.run(async (tx) => {
            const sub = await this.subscriptions.findByTenantIdLocked(input.tenantId, tx);
            if (!sub) {
                throw subscriptionNotFound(input.tenantId);
            }

            const { limits } = await this.answerFor(sub, now, catalog, tx);
            const max = limits.quotas[input.dimension];
            if (max === undefined) {
                // Misconfiguration, not user input: the call site names a
                // dimension the plan catalog does not declare. Stays a 500 —
                // a coded body now, but no status change for consumers.
                throw new InternalServerErrorException(
                    codedError(BILLING_ERROR_CODES.QUOTA_DIMENSION_UNKNOWN, {
                        dimension: input.dimension,
                    }),
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
     * Plan fallback for TRIAL/PENDING_SALES: the version of the plan on sale
     * at `asOf`, as a booking made then would bind it.
     */
    private async findPlanVersionOnSale(planId: string, asOf: Date, tx?: TransactionContext) {
        const v = await this.planVersions.findActive(planId, asOf, tx);
        if (!v) {
            const asOfDate = asOf.toISOString().slice(0, 10);
            throw new NotFoundException({
                code: BILLING_ERROR_CODES.NO_ACTIVE_PLAN_VERSION,
                message: `No version of plan ${planId} is on sale as of ${asOfDate}.`,
                params: { planId, asOf: asOfDate },
            });
        }
        return v;
    }

    private readCache(tenantId: string, nowMs: number): EffectiveLimits | null {
        const entry = this.cache.get(tenantId);
        if (!entry) return null;
        // `<=`, so that an entry capped at a cancellation's effective moment is
        // already gone AT that moment — which is the moment the entitlements
        // end. For an ordinary TTL entry this moves the expiry by one
        // millisecond and means nothing.
        if (entry.expiresAt <= nowMs) {
            this.cache.delete(tenantId);
            return null;
        }
        // LRU: move the hit entry to the end of the insert order.
        this.cache.delete(tenantId);
        this.cache.set(tenantId, entry);
        return entry.value;
    }

    private writeCache(
        tenantId: string,
        value: EffectiveLimits,
        nowMs: number,
        expiresNotAfter: Date | null = null,
    ): void {
        if (this.cache.has(tenantId)) this.cache.delete(tenantId);
        const ttlExpiry = nowMs + CACHE_TTL_MS;
        const boundary = expiresNotAfter?.getTime() ?? Infinity;
        this.cache.set(tenantId, {
            value,
            expiresAt: boundary > nowMs ? Math.min(ttlExpiry, boundary) : ttlExpiry,
        });
        // Eviction: drop the oldest entry until the cache limit is met.
        while (this.cache.size > CACHE_MAX_ENTRIES) {
            const oldest = this.cache.keys().next().value;
            if (oldest === undefined) break;
            this.cache.delete(oldest);
        }
    }
}

/** The earliest of `dates` that is still to come at `now`, or null. */
function firstAfter(now: Date, dates: ReadonlyArray<Date | null>): Date | null {
    let first: Date | null = null;
    for (const date of dates) {
        if (date === null || date <= now) continue;
        if (first === null || date < first) first = date;
    }
    return first;
}
