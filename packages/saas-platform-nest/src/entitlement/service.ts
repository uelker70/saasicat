// EntitlementService — Slice B: NestJS-Service mit DI, LRU-Cache,
// Repository-Ports + transactional `enforceLimit`.
//
// Slice A (aggregation.ts + plan-resolution.ts) liefert die Pure-Functions;
// dieser Service orchestriert sie mit den Konsumenten-Adaptern (Subscription/
// PlanVersion-Repositories, TransactionRunner) und einem In-Memory-Cache.

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
    /** Tenant, gegen dessen Subscription geprüft wird. */
    tenantId: string;
    /** Quota-Key aus saas.yaml (`users`, `vehicles`, `storageGb`, …). */
    dimension: string;
    /**
     * Zähler für aktuell verbrauchte Einheiten innerhalb der Transaktion.
     * Konsument zählt z. B. `users WHERE tenantId AND deletedAt IS NULL`.
     */
    currentUsage: (tx: TransactionContext, tenantId: string) => Promise<number>;
    /**
     * Fügt die neue Row(s) ein. Wird nur ausgeführt, wenn das Limit nach
     * Inkrement nicht überschritten wird.
     */
    insert: (tx: TransactionContext) => Promise<T>;
    /**
     * Inkrement, das durch `insert` zur Nutzung dazukommt. Default 1
     * (USERS/VEHICLES — eine Row pro Insert). Bei STORAGE-Inserts kann der
     * Caller variable GB-Werte durchreichen, damit auch eine 10-GB-Datei
     * gegen ein 1-GB-Limit blockt.
     */
    delta?: number;
    /** Override für Tests; Default `new Date()`. */
    now?: Date;
}

@Injectable()
export class EntitlementService {
    // Map preserviert Insert-Order — bei Hit wird der Eintrag entfernt und
    // neu eingefügt (LRU). TTL ist Sicherheitsnetz für vergessene
    // Invalidationen — 60s reicht, weil Limits sich in der Regel nur durch
    // Mutationen ändern, nicht durch Zeit (Pending-Plan-Effektiv-Datum ist
    // tagestäglich).
    private readonly cache = new Map<string, CacheEntry>();

    // #39 — replaces-Alias-Index, lazy aus dem Boot-statischen Snapshot
    // gebaut; wirft bei replaces-Zyklen (klarer Fehler statt Endlosschleife).
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
        // P11.7.3 — SubscriptionBundle-Aggregation. Optional, damit Apps
        // ohne Bundle-Buchungen den Service unverändert weiter nutzen.
        @Optional()
        @Inject(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN)
        private readonly subscriptionBundles: SubscriptionBundleRepository | null = null,
        @Optional()
        @Inject(BUNDLE_REPOSITORY_TOKEN)
        private readonly bundles: BundleRepository | null = null,
        @Optional()
        @Inject(SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN)
        private readonly subscriptionContracts: SubscriptionContractRepository | null = null,
        // #39 — replaces-Aliase: Verträge mit altem Feature-Key liefern das
        // neue Feature. Optional, damit Apps ohne DiscoveryModule den Service
        // unverändert weiter nutzen (dann keine Alias-Auflösung).
        @Optional()
        @Inject(DISCOVERY_SNAPSHOT_TOKEN)
        private readonly discoverySnapshot: DiscoverySnapshot | null = null,
    ) {}

    // ---------------------------------------------------------------------
    // Lese-Pfad — für FeatureGuard, Sidebar-Hooks, GET /billing/entitlement
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
     * Räumt den Cache-Eintrag eines Tenants. MUSS aufgerufen werden, sobald
     * eine Mutation Subscription, Bundle-Buchung oder PlanVersion-Bindung
     * verändert — sonst bleiben FeatureGuard und Sidebar bis zu 60s auf
     * altem Stand.
     */
    invalidateTenant(tenantId: string): void {
        this.cache.delete(tenantId);
    }

    /** Räumt den kompletten Cache. Nur für Tests / Bootstrap. */
    invalidateAll(): void {
        this.cache.clear();
    }

    /**
     * Aggregator-Pfad — auch direkt aufrufbar von Konsumenten, die schon
     * eine `SubscriptionRecord` (z. B. innerhalb einer Transaktion) haben.
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
     * Bestandsschutz (#39): gewährte alte Feature-Keys gewähren transitiv
     * ihre Nachfolger aus den `replaces`-Ketten des Discovery-Snapshots.
     * Ohne Snapshot oder ohne replaces-Deklarationen ein No-op.
     */
    private withReplacedFeatureAliases(limits: EffectiveLimits): EffectiveLimits {
        if (!this.discoverySnapshot) return limits;
        if (!this.replacedByIndex) {
            this.replacedByIndex = buildReplacedByIndex(this.discoverySnapshot.features);
        }
        if (this.replacedByIndex.size === 0) return limits;
        return { ...limits, features: expandReplacedFeatures(limits.features, this.replacedByIndex) };
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
     * Lädt die aktiven Bundle-Buchungen einer Subscription und löst pro
     * Eintrag die `BundleVersion`-Features/Quotas auf. Ohne registriertes
     * `SubscriptionBundleRepository` oder `BundleRepository` liefert die
     * Methode eine leere Liste — Apps ohne Bundle-Schema bleiben damit
     * unverändert (Plan-only-Aggregation).
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
                    // Hard-Fail: eine aktive Buchung zeigt auf eine nicht
                    // mehr existierende BundleVersion — Daten-Inkonsistenz,
                    // sollte nie passieren (BundleVersion ist Restrict-FK).
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
    // Schreibe-/Verbrauchs-Pfad — Row-Lock + Count + Insert in derselben
    // Transaktion. Schützt gegen Race-Conditions bei konkurrierenden
    // Anlagen am gleichen Tenant.
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
            // -1 = unbegrenzt (Catalog-Konvention).
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
     * Plan-Fallback bei TRIAL/PENDING_SALES: liefert die zu `asOf` aktive
     * PlanVersion (SPEC_V2 §4.2). Wenn das Repo `findActive` nicht
     * implementiert, fallen wir auf `findLatestLive` zurück (Backward-Compat
     * für Adapter ohne `validFrom`-Spalten).
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
        // LRU: Hit-Eintrag ans Ende der Insert-Order schieben.
        this.cache.delete(tenantId);
        this.cache.set(tenantId, entry);
        return entry.value;
    }

    private writeCache(tenantId: string, value: EffectiveLimits, nowMs: number): void {
        if (this.cache.has(tenantId)) this.cache.delete(tenantId);
        this.cache.set(tenantId, { value, expiresAt: nowMs + CACHE_TTL_MS });
        // Eviction: ältesten Eintrag droppen, bis Cache-Grenze eingehalten.
        while (this.cache.size > CACHE_MAX_ENTRIES) {
            const oldest = this.cache.keys().next().value;
            if (oldest === undefined) break;
            this.cache.delete(oldest);
        }
    }
}
