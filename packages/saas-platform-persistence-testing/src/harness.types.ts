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
    SubscriptionRepository,
    TenantSubscriptionWritePort,
    TransactionRunner,
} from '@saasicat/types';

/**
 * Port instances under test. Required members define the minimum an adapter
 * must ship to call itself a SaaSicat persistence adapter; optional members
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
