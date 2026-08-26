// Harness contract between the test kit and an adapter's integration test.
//
// The kit tests RESOLVED port instances (not provider specs) so it stays
// DI-free; seeding goes through `ContractSeed` because writing fixture rows
// is schema-specific and therefore adapter-owned.

import type {
    AuditPort,
    AuditQueryPort,
    BundleRepository,
    MfaPort,
    PersistenceCapabilities,
    PlanRepository,
    PlanVersionRepository,
    PromoCodeRedemptionRepository,
    PromoCodeRepository,
    PromoSubscriptionLookup,
    SubscriptionContractRepository,
    SubscriptionBundleRepository,
    SubscriptionRepository,
    TenantSubscriptionWritePort,
    TransactionRunner,
} from '@saasicat/core';

/**
 * Port instances under test. Required members define the minimum an adapter
 * must ship to call itself a SaaSiCat persistence adapter; optional members
 * activate additional scenario groups (absent → the group reports as
 * skipped, never silently).
 */
export interface ContractAdapterInstances {
    capabilities: PersistenceCapabilities;
    transactionRunner: TransactionRunner;
    subscriptionRepository: SubscriptionRepository;
    planVersionRepository: PlanVersionRepository;
    promoCodeRepository?: PromoCodeRepository;
    promoCodeRedemptionRepository?: PromoCodeRedemptionRepository;
    mfa?: MfaPort;
    audit?: AuditPort;
    auditQuery?: AuditQueryPort;
    subscriptionContractRepository?: SubscriptionContractRepository;
    /**
     * Enables the atomic plan-binding scenarios. Adapters should expose this
     * member only for a mode that promises to keep `plan`,
     * `planVersionId` and pending-version state consistent.
     */
    tenantSubscriptionWrite?: TenantSubscriptionWritePort;
    /** Enables BundleVersion validity-window and auto-succession scenarios. */
    bundleRepository?: BundleRepository;
    /**
     * Enables the booking scenarios — the junction a tenant's bundles hang off.
     *
     * Separate from `bundleRepository`, which is the catalog: one answers what
     * may be sold, the other what a tenant actually bought and for which
     * period. `adapter-drizzle` has neither yet.
     */
    subscriptionBundleRepository?: SubscriptionBundleRepository;
    /** Enables PlanVersion lifecycle, identity and validity-window scenarios. */
    planRepository?: PlanRepository;
    /**
     * Enables the promo subscription lookup scenarios.
     *
     * Worth its own entry rather than being folded into
     * `subscriptionRepository`: this is the read a promo code is validated
     * against, so a wrong row here decides that a discount applies to a
     * subscription it was not meant for. It answers by subscription id, not by
     * tenant, which is what makes selecting the wrong row possible at all.
     */
    promoSubscriptionLookup?: PromoSubscriptionLookup;
}

/** Fixture writers — implemented per adapter against its own schema. */
export interface ContractSeed {
    createPlanVersion(input: {
        planKey: string;
        version: number;
        quotas: Record<string, number>;
        features: string[];
        published: boolean;
        superseded?: boolean;
    }): Promise<{ planVersionId: string }>;
    createSubscription(input: {
        tenantId: string;
        plan: string;
        planVersionId: string;
        pendingPlanVersionId?: string;
        status?: string;
        /** Defaults to the column default; set it where a scenario reads it. */
        billingCycle?: string;
        /** Defaults to null; set it where a scenario reads it. */
        startedAt?: Date;
    }): Promise<{ subscriptionId: string }>;
    /**
     * A published BundleVersion to book against.
     *
     * A fixture writer rather than a call into `bundleRepository`: the catalog
     * repository is a subject of the suite, not a tool for setting up someone
     * else's scenario, and a booking scenario that failed because the catalog
     * did would say the wrong thing.
     *
     * Optional because an adapter may not carry the catalog tables at all —
     * `adapter-drizzle` does not. A required writer nobody can implement is a
     * contract that lies about what conformance means; the booking scenarios
     * gate on this and report the gap as a skip instead.
     */
    createBundleVersion?(input: {
        bundleKey: string;
        features: string[];
    }): Promise<{ bundleVersionId: string }>;
    /**
     * Clears a booking's `canceledAt` while leaving `canceledEffectiveAt`.
     *
     * A shape no repository method produces, and one the nullable columns
     * nonetheless permit — so the adapters have to agree on how to read it.
     * Optional: a harness that cannot reach its store directly says so and the
     * scenario skips, rather than the scenario inventing a way in.
     */
    clearBookingRequestDate?(subscriptionBundleId: string): Promise<void>;
    createPromoCode(input: {
        code: string;
        maxRedemptions: number | null;
        status?: string;
    }): Promise<{ promoCodeId: string }>;
}

export interface PersistenceContractHarness {
    adapter: ContractAdapterInstances;
    seed: ContractSeed;
    /** Empties the platform tables — runs before every scenario. */
    reset(): Promise<void>;
    /** Teardown after the last scenario (close pools etc.). */
    close?(): Promise<void>;
}

export interface PersistenceAdapterContractOptions {
    /** Display name in the test output, e.g. `'adapter-prisma @ postgres16'`. */
    name: string;
    /** Project identity used by catalog lifecycle scenarios. */
    projectKey: string;
    /** Builds the harness once for the whole suite. */
    create(): Promise<PersistenceContractHarness>;
}
