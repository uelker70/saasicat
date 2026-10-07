// Harness contract between the test kit and an adapter's integration test.
//
// The kit tests RESOLVED port instances (not provider specs) so it stays
// DI-free; seeding goes through `ContractSeed` because writing fixture rows
// is schema-specific and therefore adapter-owned.

import type {
    AppliedSettingsPort,
    AuditPort,
    AuditQueryPort,
    BundleRepository,
    CheckoutOfferRepository,
    MaintenanceWindowPort,
    MfaPort,
    PaymentEventLog,
    PersistenceCapabilities,
    PlanCatalogReadSink,
    PlanRepository,
    PlanVersionRepository,
    PromoCodeHoldRepository,
    PromoCodeRedemptionRepository,
    PromoCodeRepository,
    PromoSubscriptionLookup,
    SubscriberLedgerRepository,
    SubscriberPaymentMethodRepository,
    SubscriberRepository,
    SubscriptionContractRepository,
    SubscriptionBundleRepository,
    SubscriptionNoticeRepository,
    SubscriptionUsagePort,
    SubscriptionRepository,
    TenantSubscriptionWritePort,
    FeatureWithdrawalRepository,
    TransactionRunner,
    VersionRetirementRepository,
    BundleVersionRetirementRepository,
} from '@saasicat/core';

/**
 * Port instances under test. Required members define the minimum an adapter
 * must ship to call itself a SaaSiCat persistence adapter; optional members
 * activate additional scenario groups. An absent member fails its scenarios
 * unless the contract options declare it in `gaps`, in which case they report
 * as skipped.
 */
export interface ContractAdapterInstances {
    capabilities: PersistenceCapabilities;
    transactionRunner: TransactionRunner;
    subscriptionRepository: SubscriptionRepository;
    planVersionRepository: PlanVersionRepository;
    promoCodeRepository?: PromoCodeRepository;
    promoCodeRedemptionRepository?: PromoCodeRedemptionRepository;
    /**
     * Enables the hold scenarios: a slot held for a checkout counts against the
     * limit beside the redemptions, however many checkouts race for it, and
     * ends exactly once — released, expired, or turned into the redemption on
     * the transaction it was handed over on and no other.
     */
    promoCodeHoldRepository?: PromoCodeHoldRepository;
    mfa?: MfaPort;
    audit?: AuditPort;
    auditQuery?: AuditQueryPort;
    subscriptionContractRepository?: SubscriptionContractRepository;
    /**
     * Enables the subscriber scenarios: a customer number the database
     * counts, one live subscriber per tenant however many callers create one
     * at once, and a correction that records the values it replaced. A
     * contract names its subscriber, so the contract scenarios write theirs
     * through `seed.createSubscriber` rather than through this port.
     */
    subscriberRepository?: SubscriberRepository;
    /**
     * Enables the gateway event scenarios: an event is claimed once per
     * account, a duplicate leaves the caller's transaction usable, and a claim
     * rolled back with its transaction is free for the gateway's retry.
     */
    paymentEventLog?: PaymentEventLog;
    /**
     * Enables the payment method scenarios: one payment method in use per
     * subscriber however many confirmations arrive at once, the one it
     * replaced kept as history, and a confirmation recorded twice recognised.
     * Its subscribers come from `seed.createSubscriber`.
     */
    subscriberPaymentMethodRepository?: SubscriberPaymentMethodRepository;
    /**
     * Enables the charge journal scenarios: a charge is written once however
     * often and however concurrently it is recorded, keeps its amount to the
     * cent, and is undone with the transaction it was written on. A charge
     * points at a contract line, so they also need `subscriptionContractRepository`
     * and `seed.createSubscriber`.
     */
    subscriberLedgerRepository?: SubscriberLedgerRepository;
    /**
     * Enables the checkout offer scenarios: an offer is consumed once, and a
     * consume on a transaction that rolls back leaves it open. Neither shipped
     * adapter provides one; an application that implements the port wires it
     * here.
     */
    checkoutOfferRepository?: CheckoutOfferRepository;
    /**
     * Enables the atomic plan-binding scenarios. Adapters should expose this
     * member only for a mode that promises to keep `plan` and
     * `planVersionId` consistent.
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
     * Enables the catalogue-read scenario: which version of each plan the
     * catalogue names at a moment. Needs `planRepository` to publish and end
     * the versions it reads.
     */
    planCatalogReadSink?: PlanCatalogReadSink;
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
    /**
     * Enables the applied-settings scenarios: the one row an installation keeps
     * about the configuration it runs on, and the changes noticed between
     * starts. The singleton and the guard are the parts worth a contract — two
     * adapters that upsert differently would leave one of them with two rows
     * and a reader picking one at random, and one whose write ignores the
     * fingerprint it was given lets every replica of a deployment record the
     * same change.
     */
    appliedSettings?: AppliedSettingsPort;
    /**
     * Enables the maintenance window scenarios: at most one window open however
     * many operators open one at once, and every move guarded on the stage the
     * caller read. Both are what the lock rests on — an adapter that let two
     * windows open would leave the platform reading one of them at random, and
     * one whose move ignored the stage would let an unlock and a lock issued
     * together both land.
     */
    maintenanceWindows?: MaintenanceWindowPort;
    /**
     * Enables the subscriber notice scenarios: one record per subscription,
     * kind and subject however many runs claim it at once, and a claim, a
     * confirmation and a release each guarded on the claim the caller holds.
     * That is what makes a notice once — an adapter that let two runs claim it
     * would send it twice, and one whose confirmation ignored the claim would
     * record a delivery a later run is still making.
     */
    subscriptionNotices?: SubscriptionNoticeRepository;
    /**
     * Enables the retirement announcement scenarios: an announcement kept with
     * both versions, when and by whom, and written in one transaction with the
     * notices that say what it means for each subscription. A retirement whose
     * notices could be lost would take away the cancellation right they carry.
     */
    versionRetirements?: VersionRetirementRepository;
    /**
     * Enables the add-on retirement announcement scenarios: as for a plan
     * version, kept with both versions, when and by whom, and written in one
     * transaction with the notices that say what it means for each booking.
     */
    bundleVersionRetirements?: BundleVersionRetirementRepository;
    /**
     * Enables the feature withdrawal scenarios: a withdrawal kept with its
     * reductions, a feature held to one withdrawal not lifted however many
     * operators announce at once, a lift recorded once, and the withdrawal
     * written in one transaction with the notices that say what it means for
     * each subscription. Two open withdrawals of one feature would reduce every
     * subscription twice.
     */
    featureWithdrawals?: FeatureWithdrawalRepository;
    /**
     * Enables the scenarios that list the subscriptions bound to exactly one
     * plan version, in every tenant — the subscriptions a retirement reaches —
     * and that read subscriptions by id, which an add-on retirement asks for
     * the subscription of each booking it reaches.
     */
    subscriptionUsage?: SubscriptionUsagePort;
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
        /** The version a scheduled change will bind. */
        pendingChangeVersionId?: string;
        status?: string;
        /** Defaults to the column default; set it where a scenario reads it. */
        billingCycle?: string;
        /** Defaults to null; set it where a scenario reads it. */
        startedAt?: Date;
        /**
         * Written to the JSON column as given — the stored value is what the
         * scenario asks the adapter to read, whatever its shape. Defaults to null.
         */
        customLimits?: unknown;
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
    /**
     * Overwrites a booking's `billingCycle` column with the value given.
     *
     * The column is text, and the platform writes only `MONTHLY` or `YEARLY` to
     * it; this writes what nothing else does, so the scenario can ask whether
     * the adapter reads such a value back as one of the two. Optional for the
     * reason `clearBookingRequestDate` is.
     */
    setBookingCycle?(subscriptionBundleId: string, billingCycle: string): Promise<void>;
    createPromoCode(input: {
        code: string;
        maxRedemptions: number | null;
        status?: string;
    }): Promise<{ promoCodeId: string }>;
    /**
     * A subscriber row for a contract scenario to name, linked to no tenant.
     *
     * A fixture writer for the reason `createBundleVersion` is one: the
     * subscriber repository is a subject of its own scenarios, and a contract
     * scenario that failed because of it would say the wrong thing. Optional
     * like the port it stands beside; the contract scenarios report it missing.
     */
    createSubscriber?(input: { legalName: string }): Promise<{ subscriberId: string }>;
}

export interface PersistenceContractHarness {
    adapter: ContractAdapterInstances;
    seed: ContractSeed;
    /** Empties the platform tables — runs before every scenario. */
    reset(): Promise<void>;
    /** Teardown after the last scenario (close pools etc.). */
    close?(): Promise<void>;
}

/**
 * A part of the contract an adapter may deliberately not provide.
 *
 * Each names the members its scenarios need; `contract.ts` holds the list with
 * what each one checks.
 */
export type ContractGap =
    | 'atomicPlanBinding'
    | 'atomicOnboarding'
    | 'promoCodes'
    | 'promoCodeRedemptions'
    | 'promoCodeHolds'
    | 'promoSubscriptionLookup'
    | 'planRepository'
    | 'planLifecycle'
    | 'planCatalogRead'
    | 'planRetirement'
    | 'planVersionReads'
    | 'planVersionRetirement'
    | 'planDraftPublish'
    | 'planDraftDiscard'
    | 'bundleRepository'
    | 'bundleValidity'
    | 'bundleDraftDiscard'
    | 'bundleDraftPublish'
    | 'bundleRetirement'
    | 'bundleBookings'
    | 'halfCancelledBookingSeed'
    | 'foreignBookingCycleSeed'
    | 'countByPlanVersionId'
    | 'audit'
    | 'mfa'
    | 'subscriptionContracts'
    | 'subscribers'
    | 'paymentEventLog'
    | 'subscriberPaymentMethods'
    | 'subscriberLedger'
    | 'checkoutOffers'
    | 'appliedSettings'
    | 'maintenanceWindows'
    | 'subscriptionNotices'
    | 'versionRetirements'
    | 'boundSubscriptions'
    | 'bundleVersionRetirements'
    | 'bookingsOfVersion'
    | 'bookingsMoved'
    | 'bookingsScheduled'
    | 'subscriptionsById'
    | 'featureWithdrawals'
    | 'bookingsEndedNow'
    | 'subscriptionsEndedNow';

export interface PersistenceAdapterContractOptions {
    /** Display name in the test output, e.g. `'adapter-prisma @ postgres16'`. */
    name: string;
    /** Builds the harness once for the whole suite. */
    create(): Promise<PersistenceContractHarness>;
    /**
     * The parts this adapter deliberately does not provide. Their scenarios
     * report as skipped; a part missing without being named here fails its
     * scenarios, and a part named here that the harness does provide fails
     * the suite.
     */
    gaps?: readonly ContractGap[];
}
