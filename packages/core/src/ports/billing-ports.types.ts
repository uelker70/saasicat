import type { TransactionContext } from './core-ports.types.js';
import type { CustomLimits } from '../custom-limits.js';
import type { PromoCodeRedemptionRecord } from './promo-ports.types.js';
import type {
    CancelSubscriptionBundleData,
    CreateSubscriptionBundleData,
    SubscriptionBundleRecord,
} from '../subscription.types.js';
import type {
    NewSubscriptionContractData,
    RunningContractIssuers,
    SubscriptionContractFilter,
    SubscriptionContractRecord,
    SupersedeSubscriptionContractData,
    TerminateSubscriptionContractData,
} from '../subscription-contract.types.js';
import type {
    CreateSubscriberData,
    SubscriberContactChange,
    SubscriberCorrectionData,
    SubscriberCorrectionRecord,
    SubscriberCorrectionResult,
    RecordedVatIdCheck,
    SubscriberBusinessStatusData,
    SubscriberBusinessStatusResult,
    SubscriberRecord,
    SubscriberTaxOriginChangeRecord,
    SubscriberVatIdCheckRecord,
    SubscriberWithCurrentCheck,
} from '../subscriber.types.js';
import type { VatIdCheck } from '../tax.types.js';
import type { NewSubscriberCharge, SubscriberChargeRecord } from '../subscriber-ledger.types.js';
import type {
    NewSubscriptionInvoice,
    SubscriptionInvoiceRecord,
} from '../subscription-invoice.types.js';

// -----------------------------------------------------------------------------
// Billing repository and tenant self-service ports
// -----------------------------------------------------------------------------

/**
 * Snapshot form of a `Subscription` row for the EntitlementService
 * computation. The consumer maps its Prisma structure onto this form.
 */
export interface SubscriptionRecord {
    id: string;
    tenantId: string;
    plan: string;
    status: string;
    isPilot?: boolean;
    trialEntitlementPlan?: string | null;
    pendingPlan?: string | null;
    pendingEffectiveAt?: Date | null;
    customLimits?: CustomLimits | null;
    planVersionId: string;
    planVersion: PlanVersionRecord;
    /**
     * When a cancellation was declared, and when it takes effect.
     *
     * Required, and required together, because entitlement resolution ends a
     * subscription by reading them: without the second date it cannot tell a
     * subscription that ends next January from one that ended last January, and
     * it grants the latter everything. Nothing else in the platform would
     * notice — no repository filters a cancelled subscription out, and stopping
     * the billing period is a different decision from ending what a tenant may
     * do.
     *
     * `null` on both means no cancellation. On a row written before the two
     * fields separated, `canceledAt` carries the effective date and
     * `canceledEffectiveAt` is genuinely null; every reader in the platform
     * applies `canceledEffectiveAt ?? canceledAt` for that reason.
     */
    canceledAt: Date | null;
    canceledEffectiveAt: Date | null;
}

/** Snapshot of a `PlanVersion` row. */
export interface PlanVersionRecord {
    planId: string;
    quotas: Record<string, number>;
    features: string[];
}

/**
 * Read adapter for subscriptions. The consumer implementation loads from its
 * own `Subscription` table incl. eager-loaded `planVersion`
 * and maps to `SubscriptionRecord`.
 */
export interface SubscriptionRepository {
    /** Returns a tenant's subscription or null. */
    findByTenantId(tenantId: string): Promise<SubscriptionRecord | null>;
    /**
     * Like `findByTenantId`, but within the transaction with a row lock
     * (`SELECT ... FOR UPDATE`). Used by the transactional `enforceLimit`
     * path to serialize concurrent creations on the same tenant.
     */
    findByTenantIdLocked(
        tenantId: string,
        tx: TransactionContext,
    ): Promise<SubscriptionRecord | null>;

    /**
     * Counts subscriptions that bind a specific PlanVersion — both
     * via the active `planVersionId` and via the version a scheduled change will
     * bind (`pendingChangeVersionId`).
     * Needed by the `PlanVersionsService` for the editability decision:
     * a published-but-future PlanVersion stays correctable only as long
     * as no booking references it.
     *
     * Optional for backwards-compat reasons — if an adapter does not
     * implement the method, the service defensively treats the version as
     * frozen (fail-closed). Implementation hint: count in a single
     * COUNT(*) over the subscription table with an OR over the two
     * FK columns — not in two separate queries, to avoid race conditions.
     *
     * Counts across every tenant. The platform calls it inside
     * `RlsBypassPort`; an implementation on a tenant-scoped client has to see
     * every tenant's rows there. Whether the frame lifts the policy for this
     * query is up to the application's bypass and the database layer behind it
     * — one that lifts only reads such as `find*` leaves a `count` filtered, and
     * then the implementation lifts the policy itself. A subscriber hidden from
     * the count counts as nobody, which opens the version for editing.
     */
    countByPlanVersionId?(planVersionId: string): Promise<number>;

    /**
     * Counts active (= not-canceled, or cancellation still in the future)
     * SubscriptionBundle entries that bind a specific BundleVersion.
     * Bundles are versioned and marketed independently (analogous to
     * plans); the `BundlesService` needs the count for the editability
     * decision of a published-but-future BundleVersion.
     *
     * Implementation since P11.7.3: direct COUNT on
     * `subscription_bundles WHERE bundleVersionId = ? AND
     * (canceledAt IS NULL OR canceledEffectiveAt > NOW())`. Apps without
     * a SubscriptionBundle schema (or without the platform migration) can
     * still return 0; the editability feature is then no longer
     * fail-closed against bookings, but still latest-in-chain +
     * validFrom-future.
     *
     * Optional — if not implemented, the service defensively treats the
     * version as frozen (fail-closed).
     *
     * Counts across every tenant, inside `RlsBypassPort`, and has to see every
     * tenant's rows there, as `countByPlanVersionId` does.
     */
    countByBundleVersionId?(bundleVersionId: string): Promise<number>;

    /**
     * Counts active subscriptions (status `ACTIVE` or `TRIAL`) per plan key,
     * platform-wide across every tenant — feeds the tenant column of the
     * SuperAdmin plan list (`GET /admin/catalog/plans/tenant-counts`).
     * Cross-version: counts the plan, not a single PlanVersion
     * (subscriptions on superseded versions are included).
     *
     * Returns a map `planKey → count`; plans without an active subscription
     * are missing (UI defaults to 0). Platform-wide count across all tenants:
     * the platform calls it inside `RlsBypassPort`, and an implementation has to
     * see every tenant's rows there, as for `countByPlanVersionId`.
     *
     * Optional — if not implemented, the tenant column stays 0.
     */
    countActiveByPlanKey?(): Promise<Record<string, number>>;
}

/**
 * Adapter for the `subscription_bundles` junction.
 * Consumers implement it against their Prisma table. Writing
 * via `add` / `cancel` is always a side effect of the subscription-service
 * methods — the repository is dumb persistence, no domain
 * constraints (plan compatibility, minimum-term default) here.
 */
export interface SubscriptionBundleRepository {
    /** All bundle bookings of a subscription, newest first. */
    listBySubscription(subscriptionId: string): Promise<SubscriptionBundleRecord[]>;
    /** A single booking (for the cancel/detail flow). */
    findById(subscriptionBundleId: string): Promise<SubscriptionBundleRecord | null>;
    /**
     * Active bookings of a subscription (`canceledAt IS NULL OR
     * canceledEffectiveAt > NOW()`). Used by the Entitlement path.
     *
     * `tx` is set when the call happens inside `enforceLimit`'s interactive
     * transaction — adapters should then query on the transaction connection
     * instead of drawing an extra pool connection (starvation guard, #70).
     */
    listActiveBySubscription(
        subscriptionId: string,
        asOf?: Date,
        tx?: TransactionContext,
    ): Promise<SubscriptionBundleRecord[]>;
    add(data: CreateSubscriptionBundleData): Promise<SubscriptionBundleRecord>;
    /**
     * Sets `canceledAt` + `canceledEffectiveAt`. Throws on already
     * canceled bookings — the service may offer "undo cancellation"
     * as a separate path (not in this iteration).
     */
    cancel(
        subscriptionBundleId: string,
        data: CancelSubscriptionBundleData,
    ): Promise<SubscriptionBundleRecord>;
    /**
     * "Undo cancellation": resets `canceledAt` + `canceledEffectiveAt` to
     * NULL. Only meaningful as long as the cancellation is not yet effective
     * (`canceledEffectiveAt > NOW()`); the validity check is done by the service.
     */
    reactivate(subscriptionBundleId: string): Promise<SubscriptionBundleRecord>;
    /**
     * Counts active bundle bookings for a BundleVersion (same
     * semantics as `SubscriptionRepository.countByBundleVersionId`, only
     * directly on the junction adapter). Shared by both repository
     * implementations to avoid drift.
     */
    countActiveByBundleVersionId(bundleVersionId: string, asOf?: Date): Promise<number>;
    /**
     * Every booking of the add-on version `bundleVersionId`, in every tenant,
     * whatever its state. The platform reads it to find the bookings an add-on
     * retirement reaches, inside the RLS bypass, and decides itself which of
     * them are still running.
     *
     * Optional, so a repository written before it keeps working; retiring an
     * add-on version over one without it is refused at start-up.
     */
    listOfVersion?(bundleVersionId: string): Promise<SubscriptionBundleRecord[]>;
    /**
     * Moves the booking `subscriptionBundleId` from the add-on version `from`
     * onto `to` and answers it as it now stands, or null where it is not on
     * `from` any more, or gone. Nothing else changes: its period, its terms,
     * its rhythm and its cancellation stay as they are. Conditional on `from`,
     * so a move and the put-back of a move that could not write its contract
     * never write over each other, nor two runs over one booking.
     *
     * An add-on retirement moves a booking at its date, and a subscriber by
     * taking a newer version offered (`SC-BUN-058`). Optional, so a repository
     * written before it keeps working; retiring an add-on version over one
     * without it is refused at start-up, and no newer version is offered.
     */
    moveToVersion?(
        subscriptionBundleId: string,
        from: string,
        to: string,
    ): Promise<SubscriptionBundleRecord | null>;
    /**
     * Schedules the booking `subscriptionBundleId` to continue on the add-on
     * version `to` from `effectiveAt` — `pendingBundleVersionId` and
     * `pendingVersionEffectiveAt` — and answers it as it now stands, or null
     * where it is not on `from` any more, already has a switch scheduled, or is
     * gone. Nothing else changes, its version included: the switch is made at
     * that moment by the run (`listScheduledVersionsDue`).
     *
     * Optional, and so are the two methods after it: without all three, a
     * newer version that takes something away is not offered.
     */
    scheduleVersion?(
        subscriptionBundleId: string,
        switchTo: { from: string; to: string; effectiveAt: Date },
    ): Promise<SubscriptionBundleRecord | null>;
    /**
     * Clears the switch scheduled for the booking `subscriptionBundleId`, and
     * answers it as it now stands; null where no switch to `to` is scheduled
     * any more, or it is gone. Its version stays as it is.
     */
    unscheduleVersion?(
        subscriptionBundleId: string,
        to: string,
    ): Promise<SubscriptionBundleRecord | null>;
    /**
     * Every booking, in every tenant and whatever its state, with a switch
     * scheduled to take effect at or before `asOf` — oldest first. The
     * platform reads it inside the RLS bypass and decides itself which of
     * them still move.
     */
    listScheduledVersionsDue?(asOf: Date): Promise<SubscriptionBundleRecord[]>;
}

/**
 * Append-only repository for V3 SubscriptionContracts. Contracts are the
 * contractually binding source for billing and entitlement; catalog FKs are only
 * trace data. Implementations may close existing contracts (at the domain level)
 * only via `terminate`, not overwrite LineItems/Snapshots.
 */
export interface SubscriptionContractRepository {
    list(filter: SubscriptionContractFilter): Promise<SubscriptionContractRecord[]>;
    findById(contractId: string): Promise<SubscriptionContractRecord | null>;
    /**
     * `tx` is set when the call happens inside `enforceLimit`'s interactive
     * transaction — adapters should then query on the transaction connection
     * instead of drawing an extra pool connection (starvation guard, #70).
     */
    findActiveByTenantId(
        tenantId: string,
        asOf?: Date,
        tx?: TransactionContext,
    ): Promise<SubscriptionContractRecord | null>;
    /**
     * Writes the contract with the parties it names. With `tx`, the contract is
     * written on that transaction and undone with it.
     */
    create(
        data: NewSubscriptionContractData,
        tx?: TransactionContext,
    ): Promise<SubscriptionContractRecord>;
    /**
     * The contract concluded from a checkout offer (`originalOfferId`), or
     * `null` when none was. An offer is consumed once and so yields one
     * contract (`SC-MKT-017`); where an application's own path wrote two, the
     * earliest is returned, so the answer does not depend on read order.
     */
    findByOriginalOfferId(
        offerId: string,
        tx?: TransactionContext,
    ): Promise<SubscriptionContractRecord | null>;
    terminate(
        contractId: string,
        data: TerminateSubscriptionContractData,
    ): Promise<SubscriptionContractRecord>;
    /**
     * Ends a contract at `data.at` with the status `superseded`, where it is
     * still as the caller read it: `active` or `scheduled`, and ending when it
     * ended then. `null`, with nothing written, where it has moved since —
     * another successor took its place, or a cancellation capped or ended it.
     *
     * The condition belongs to the write rather than to a read before it. Two
     * callers superseding one contract at once — a plan change and an
     * operator's refresh, say — then end with one successor: the second write
     * finds the status the first one left and changes nothing, where a read
     * followed by a plain update would give the tenant two contracts in force.
     *
     * With `tx`, written on that transaction and undone with it, so that the
     * successor written beside it lands with it or not at all.
     */
    supersede(
        contractId: string,
        data: SupersedeSubscriptionContractData,
        tx?: TransactionContext,
    ): Promise<SubscriptionContractRecord | null>;
    /**
     * The contracts concluded and not yet over, with the issuer each was
     * concluded under: how many there are, and the first `limit` of them,
     * oldest first. `limit` caps the list and not the count, so a start refused
     * over a changed issuer identity says how many contracts it means before it
     * names any of them.
     *
     * Running means `active` or `scheduled` AND not ended at `asOf` — the same
     * window `findActiveByTenantId` uses on its upper end, and for the same
     * reason. Status alone is not enough: an ordinary cancellation lands at the
     * term end and writes only `effectiveUntil`, leaving the status where it
     * was, and nothing flips it when that day arrives. Counting by status would
     * therefore report every customer who ever left as still running — and
     * because the list is oldest first, the ones it names would be exactly the
     * expired ones.
     *
     * The window is open at the bottom on purpose: a contract that starts next
     * month is concluded, its party copy is fixed, and it will be invoiced under
     * the issuer it names.
     *
     * Platform-wide: unlike every other read here it is anchored by no tenant,
     * no contract and no offer, and a start makes it before anything is served.
     * An implementation on a tenant-scoped client counts inside the bypass
     * frame, as `countActiveByPlanKey` does — the platform wraps the call in
     * `RlsBypassPort`, and one that answers with the caller's tenant scope
     * instead returns nothing at a boot, where there is no tenant. The
     * persistence contract runs with no policy forced, so it cannot catch that
     * for you.
     *
     * `limit` may be `0`, and a caller that wants only the count passes it:
     * `total` is exact whatever the limit, so nothing has to come back for it.
     * Zero means zero — an implementation that reads a falsy limit as "no limit"
     * returns every running contract to a caller asking for none, which is the
     * one shape of this method that gets slower the more an installation sells.
     * The executable contract asks for `0`.
     */
    listRunningIssuers(limit: number, asOf?: Date): Promise<RunningContractIssuers>;
}

/**
 * The parties contracts are concluded with, their link to the tenant they are
 * live for, and the corrections of their legal identity.
 *
 * A subscriber has at most one live tenant and a tenant at most one live
 * subscriber; the database holds both, so two callers creating one for the
 * same tenant at once end with one.
 */
export interface SubscriberRepository {
    /**
     * Creates a subscriber, assigns its customer number, and makes it the
     * tenant's live subscriber — all or nothing. `null` when the tenant already
     * has a live subscriber, in which case nothing is written and the caller's
     * transaction stays usable.
     */
    createForTenant(
        data: CreateSubscriberData,
        tx?: TransactionContext,
    ): Promise<SubscriberRecord | null>;
    findById(subscriberId: string, tx?: TransactionContext): Promise<SubscriberRecord | null>;
    /** The subscriber live for this tenant, or `null` when it has none. */
    findByTenantId(tenantId: string, tx?: TransactionContext): Promise<SubscriberRecord | null>;
    /**
     * Writes the members given and keeps the rest; `null` when no such
     * subscriber exists. Read and written under the lock a correction takes. A
     * change of the country is a change of the tax origin and is recorded as
     * one in the same step, by `changedBy` and dated while the lock is held.
     */
    updateContact(
        subscriberId: string,
        change: SubscriberContactChange,
        changedBy: string,
        tx?: TransactionContext,
    ): Promise<SubscriberRecord | null>;
    /**
     * Writes a correction of the legal identity and records it, in one step:
     * the subscriber is read and changed under a lock, so the values recorded
     * as replaced are the ones this write replaced even when two corrections
     * arrive at once. The correction is dated while the lock is held and
     * numbered by the database as it is written. A field whose stored value
     * already equals the corrected one is left out of the record, and when none
     * differs nothing is written and `correction` is `null`. `null` when no
     * such subscriber exists.
     *
     * A corrected VAT identification number is a change of the tax origin and
     * is recorded as one too, by the same actor and with the same date.
     * The check that counted for the number it replaced counts no more — it
     * would otherwise validate that number again should it come back — and
     * stays recorded (`listVatIdChecks`); the number written is held from that
     * date (`vatIdSince`), so no check completed before it counts for it.
     */
    correctIdentity(
        subscriberId: string,
        data: SubscriberCorrectionData,
        tx?: TransactionContext,
    ): Promise<SubscriberCorrectionResult | null>;
    /** Every correction of this subscriber, the latest written first. */
    listCorrections(subscriberId: string): Promise<SubscriberCorrectionRecord[]>;
    /**
     * Writes whether the subscriber is a business and records the change of
     * its tax origin, in one step and under the same lock as a correction,
     * dated while the lock is held. When the stored status already equals the
     * one given nothing is written and `change` is `null`. `null` when no such
     * subscriber exists.
     */
    changeBusinessStatus(
        subscriberId: string,
        data: SubscriberBusinessStatusData,
        tx?: TransactionContext,
    ): Promise<SubscriberBusinessStatusResult | null>;
    /**
     * Records a completed check of the subscriber's VAT identification number.
     * Every check is recorded and none is rewritten or removed: it is the
     * evidence a reverse charge rests on. Under the lock a correction takes it
     * then decides whether the check counts from now on — only for the number
     * the subscriber holds, completed since it holds it, and never over a check
     * that completed later (`keepsVatIdCheck` from `@saasicat/core` decides).
     * `null` when no such subscriber exists.
     */
    recordVatIdCheck(
        subscriberId: string,
        check: VatIdCheck,
        tx?: TransactionContext,
    ): Promise<RecordedVatIdCheck | null>;
    /**
     * The check that counts for the subscriber's number now, or `null` while
     * none does: never checked, or corrected since.
     */
    findCurrentVatIdCheck(
        subscriberId: string,
        tx?: TransactionContext,
    ): Promise<SubscriberVatIdCheckRecord | null>;
    /** Every check recorded for this subscriber, counting or not, the latest checked first. */
    listVatIdChecks(subscriberId: string): Promise<SubscriberVatIdCheckRecord[]>;
    /**
     * The live subscribers of these tenants, each with the check of its VAT id
     * that counts now, in at most a few reads — what the operator's lists mark
     * a subscriber from. A tenant without a live subscriber is left out.
     */
    listForTenants(
        tenantIds: readonly string[],
        tx?: TransactionContext,
    ): Promise<SubscriberWithCurrentCheck[]>;
    /** Every recorded change of this subscriber's tax origin, the latest written first. */
    listTaxOriginChanges(subscriberId: string): Promise<SubscriberTaxOriginChangeRecord[]>;
}

/**
 * The subscriber's account: the charges that became due, one per contract line
 * and period. Append-only — nothing here updates or deletes a charge, and a
 * mistake is answered with a counter-entry (`SC-PRIC-020`).
 *
 * Owned by the subscriber rather than the tenant, so that it outlives the
 * tenant it arose for (ADR 0012).
 */
export interface SubscriberLedgerRepository {
    /**
     * Writes the charges that are not there yet and returns them.
     *
     * A charge whose natural key — subscription, source, source reference,
     * period start and origin — is already written is left as it is and not
     * returned, however often it is derived and whoever derives it at the same
     * time: the unique index decides, not a read before the write.
     */
    recordCharges(
        charges: readonly NewSubscriberCharge[],
        tx?: TransactionContext,
    ): Promise<SubscriberChargeRecord[]>;

    /** Every charge of one subscription, oldest period first. */
    listBySubscription(
        subscriptionId: string,
        tx?: TransactionContext,
    ): Promise<SubscriberChargeRecord[]>;
}

/**
 * The invoices issued from the charge journal, and the one number range they
 * are numbered in (`SC-PRIC-072`).
 *
 * An invoice is written once and never changed. Its number is drawn when it is
 * written, in the same transaction, so an invoice that fails to be written
 * leaves no gap; the range restarts at 1 each year.
 */
export interface SubscriptionInvoiceRepository {
    /**
     * The subscriptions with a charge to invoice: a charge on no invoice in a
     * group — the charges booked at the same moment under the same contract —
     * that carries an amount (`SC-PRIC-048`). By id, at most `limit`, after
     * `after` where it is given, so a caller reads them page by page and a
     * subscription held back on one run never keeps the others from the next.
     */
    listSubscriptionsWithUninvoicedCharges(
        page: { limit: number; after?: string },
        tx?: TransactionContext,
    ): Promise<string[]>;

    /** The charges of one subscription on no invoice, oldest period first. */
    listUninvoicedCharges(
        subscriptionId: string,
        tx?: TransactionContext,
    ): Promise<SubscriberChargeRecord[]>;

    /**
     * Draws the next number of the invoice's year and writes the invoice with
     * its lines, in one transaction — the caller's where it passes one. Two
     * calls at once draw two numbers one after the other, never the same one
     * and never with a gap between them.
     *
     * Refuses with `SUBSCRIPTION_INVOICE_CHARGE_INVOICED` (`moved`) where a
     * charge already stands on an invoice: nothing is written, and the number
     * is not drawn.
     */
    issue(
        invoice: NewSubscriptionInvoice,
        tx?: TransactionContext,
    ): Promise<SubscriptionInvoiceRecord>;

    findById(id: string, tx?: TransactionContext): Promise<SubscriptionInvoiceRecord | null>;

    /** Every invoice of one subscriber, the latest number first. */
    listBySubscriber(
        subscriberId: string,
        tx?: TransactionContext,
    ): Promise<SubscriptionInvoiceRecord[]>;

    /**
     * The prefixes the issued invoices carry, at most two: one is the range,
     * a second one says the prefix was changed under it (`SC-PRIC-024`).
     */
    listIssuedNumberPrefixes(tx?: TransactionContext): Promise<string[]>;
}

// -----------------------------------------------------------------------------
// Tenant billing ports (Phase B — UI/display form for GET /billing/usage)
// -----------------------------------------------------------------------------

/**
 * Display form of a subscription for the tenant self-service UI.
 * Richer than `SubscriptionRecord` (which is only the aggregation form); contains
 * additional fields such as `billingCycle`, pilot/trial date and full
 * plan-version metadata.
 *
 * The platform controller `GET /billing/usage` maps this form 1:1 into the
 * response body. The consumer adapter loads from its own subscription
 * table (Prisma include planVersion).
 */
export interface SubscriptionUsageRecord {
    /**
     * Subscription primary key. Optional, because existing adapters may not
     * yet pass the column through — the platform service uses it
     * only for downstream steps such as atomic promo-redeem in the
     * onboarding endpoint. Adapters that want to support `POST /billing/onboarding/initial-subscription`
     * with a promo code must set `id`.
     */
    id?: string;
    plan: string;
    billingCycle: string;
    status: string;
    isPilot: boolean;
    pilotEndsAt: Date | null;
    trialEndsAt: Date | null;
    /** Subscription start (= period-window anchor for `periodEndAfter`). */
    startedAt: Date | null;
    /** Current period window — for proration and change-effective date. */
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    /**
     * End of what was committed to, which the period end need not equal.
     *
     * The cancellation rules measure against this: a subscription cancelled
     * inside its term keeps running until the term ends, not until the period
     * does. Null on a trial, and on any subscription written before the field
     * existed — readers treat that as "the period end is the answer".
     */
    minimumTermUntil?: Date | null;
    /**
     * The day of the month the subscription is billed on, 1–31.
     *
     * Read by the cancellation rules: a declaration after the notice window
     * lands one period past the term end, and that step has to measure from the
     * billing day rather than from a term end that may already have been
     * clamped by a short month.
     *
     * Optional, because an adapter that does not store the column keeps today's
     * behaviour — the step then takes its day from the term end, which is
     * correct except in the month after a clamp.
     */
    billingAnchorDay?: number | null;
    /**
     * When a cancellation was declared, and when it lands.
     *
     * Required for the reason the same pair is required on
     * `SubscriptionRecord`: the tenant billing route reads them to refuse a
     * plan change on a subscription that has ended, and a record that omits
     * them answers "not cancelled" — so the change is applied and prorated
     * while entitlement resolution, which reads a record that does carry them,
     * grants nothing.
     */
    canceledAt: Date | null;
    canceledEffectiveAt: Date | null;
    pendingPlan: string | null;
    pendingBillingCycle: string | null;
    pendingEffectiveAt: Date | null;
    /**
     * The version a scheduled change binds when it lands, where it names one —
     * a newer version taken for the end of the term, or the version a change
     * to another plan was quoted at. Read where it matters whether the
     * subscription stays on its version: a change on the same plan in the same
     * rhythm is otherwise indistinguishable from staying put.
     *
     * Optional, because an adapter written before it does not pass it through;
     * both shipped adapters do.
     */
    pendingChangeVersionId?: string | null;
    planVersion: {
        id: string;
        planId: string;
        version: number;
        publishedAt: Date | null;
        supersededAt: Date | null;
        changeNote: string | null;
    };
    /**
     * P11.4: frozen package snapshot from the
     * `CheckoutOffer` that was activated during onboarding. Read-only —
     * serves only for display in the tenant self-service UI, so that the
     * tenant knows *which* advertised package was concretely booked.
     * `null` for subscriptions that did not originate from a CheckoutOffer
     * (direct creation, migration).
     */
    packageSnapshot?: unknown | null;
    /**
     * P11.4: reference to the original `CheckoutOffer.id`. Mostly not needed
     * for the UI (the snapshot is self-contained), but useful for support
     * tools and audit.
     */
    checkoutOfferId?: string | null;
}

/**
 * Read adapter for the UI/display form of a subscription. Used by
 * `TenantBillingController.getUsage`.
 */
/** A subscription read across tenants, with the tenant it belongs to. */
export interface TenantSubscriptionUsage {
    readonly tenantId: string;
    readonly subscription: SubscriptionUsageRecord & { readonly id: string };
}

export interface SubscriptionUsagePort {
    findForTenant(tenantId: string): Promise<SubscriptionUsageRecord | null>;
    /**
     * Every subscription of `planKey`, in every tenant, bound to a version of
     * that plan numbered below `version`. The platform reads it to find the
     * subscriptions a newer version is offered to, inside the RLS bypass.
     *
     * Optional, so a port written before it keeps working; an application that
     * turns version notices on over a port without it is refused at start-up.
     */
    listBoundToEarlierVersions?(
        planKey: string,
        version: number,
    ): Promise<TenantSubscriptionUsage[]>;
    /**
     * Every subscription, in every tenant, bound to the plan version
     * `planVersionId`, whatever its status. The platform reads it to find the
     * subscriptions a retirement reaches, inside the RLS bypass, and decides
     * itself which of them are still running.
     *
     * Optional, so a port written before it keeps working; a retirement over a
     * port without it is refused at start-up.
     */
    listBoundToVersion?(planVersionId: string): Promise<TenantSubscriptionUsage[]>;
    /**
     * The subscriptions `subscriptionIds`, in whichever tenant, each with the
     * tenant it belongs to; an id that names none is left out. The platform
     * reads it inside the RLS bypass to find the subscription of each booking
     * an add-on retirement reaches.
     *
     * Optional, so a port written before it keeps working; retiring an add-on
     * version over a port without it is refused at start-up.
     */
    listByIds?(subscriptionIds: readonly string[]): Promise<TenantSubscriptionUsage[]>;
}

/**
 * Returns the current usage for all quotaKeys of a tenant declared via
 * `@DefinesQuota` (e.g. `{ users: 4, members: 850, storageGb: 1.2 }`).
 * The consumer may use its own counter strategies (Prisma counts,
 * DMS-service roundtrip, cached storage tracker, …) and must decide
 * soft-fail behavior itself.
 *
 * If a quotaKey is missing from the return object, the platform controller
 * maps it to `0` — robust display, even if a counter is not (yet) implemented.
 */
export interface UsageSnapshotPort {
    snapshot(tenantId: string): Promise<Record<string, number>>;
}

// -----------------------------------------------------------------------------
// Tenant billing write port (Phase C — plan change)
// -----------------------------------------------------------------------------

/** Input for `changePlanImmediate` with optional period-window reset. */
export interface ImmediatePlanChangeInput {
    planId: string;
    cycle: string;
    /** Reset the period window (pro-rata change). NULL for TRIAL. */
    periodStart: Date | null;
    periodEnd: Date | null;
    /** Target status — for TRIAL the status is not overwritten. */
    nextStatus: string | null;
    /**
     * Trial carry-over (#17): new trial end when changing DURING the trial.
     * Computed by the platform `changePlan` path from the `TrialProjectionPort`.
     * `undefined`/`null` → adapter leaves `trialEndsAt` unchanged (no trial
     * change, or target package without trial). A `Date` is persisted.
     */
    trialEndsAt?: Date | null;
    /**
     * `canceledAt` as the caller read it, so the write can claim the row only
     * while that is still true.
     *
     * Three of the plan route's decisions depend on the cancellation — whether
     * the change is refused at all, whether the billing cycle may move, and
     * whether a fresh period is opened — and a read and a write are two
     * moments. A cancellation declared in between made every one of them answer
     * about a state that no longer existed, and the write went ahead anyway: a
     * plan term recorded past the date the subscription ends.
     *
     * `null` is a value here rather than an absence. It claims a row that has
     * no cancellation, and loses against one that has acquired one.
     */
    expectedCanceledAt: Date | null;
    /**
     * Whether a change that leaves the plan as it is keeps the plan version
     * the subscription is bound to.
     *
     * A scheduled change that only moves the rhythm passes `true`: the
     * subscriber agreed to the version they are on, and moving them to a newer
     * one is theirs to decide, by taking it when it is offered. A sale passes
     * `false` — a change of plan, or onboarding, where the customer chose at
     * the version in effect — and the write binds the version of `planId` in effect at
     * `periodStart`. Where `planId` is another plan than the one bound, the
     * version in effect is bound either way, and so it is where the
     * subscription is bound to no version at all: it has none to keep.
     */
    keepsBoundVersion: boolean;
    /**
     * The version of `planId` the change was quoted at: a scheduled change to
     * another plan passes the version its preview showed when it was
     * scheduled, recorded as `pendingChangeVersionId`. The write binds it
     * rather than the version in effect, so a version published in between
     * does not reach the customer by a change they already agreed to. `null`
     * binds the version in effect — a sale, onboarding, and a change quoted
     * where no repository reads versions. A version kept by
     * `keepsBoundVersion` wins over it.
     */
    quotedPlanVersionId: string | null;
    /**
     * `true`: bind `quotedPlanVersionId` or nothing. Where that version no
     * longer takes bookings by `periodStart` (or now), the write claims nothing
     * and answers `claimed: false`, rather than binding the version in effect.
     * A switch to a version offered passes it: the subscriber agreed to that
     * version, and what the switch answers and records names it. Left out, a
     * version that stopped taking bookings gives way to the one in effect.
     */
    quotedVersionOnly?: boolean;
    /**
     * The version the caller read the subscription bound to, where its
     * decision rests on it: the write claims the row only while that binding
     * still holds. A switch to a version offered passes it — it writes back the
     * plan it read, and a change made in between would otherwise be undone.
     * `null` claims a row bound to no version. Left out, the binding is not
     * claimed — and a write that binds no version (`bindsPlanVersion: false`)
     * has none to claim.
     */
    expectedPlanVersionId?: string | null;
    /**
     * `true`: the change the subscription has scheduled survives the write. A
     * retirement's move passes it — the change is the subscriber's own, and the
     * move is not. One that only moves the rhythm on the plan being left follows
     * the subscription to `planId` (`scheduledChangeAfterWrite`). The write then
     * claims the row only while the scheduled change is still the one it read.
     * Left out, the write clears it: a change the subscriber makes replaces the
     * one they scheduled before.
     */
    keepsPendingChange?: boolean;
    /**
     * `true`: the write puts back a binding the subscription held a moment
     * before, so `quotedPlanVersionId` counts whether or not it still takes
     * bookings — it has to be a version of `planId`, nothing more. A
     * retirement's move or switch passes it to bind the subscription back to
     * the version retired, where the contract that has to come with the move
     * could not be written: that version is off sale, often by its own end, and
     * undoing a move is not a booking (`SC-PLAN-016` asks only of one). Left
     * out, a version that no longer takes bookings is not bound.
     */
    restoresQuotedVersion?: boolean;
}

/** Input for `schedulePlanChange` (change at period end). */
export interface ScheduledPlanChangeInput {
    pendingPlan: string;
    pendingBillingCycle: string;
    pendingEffectiveAt: Date;
    /**
     * The version of `pendingPlan` the preview quoted, where the change does
     * not keep the version bound — a change to another plan, or one on a
     * subscription bound to none; stored as `pendingChangeVersionId` and bound
     * when the change comes due. `null` where the plan stays on a bound
     * version — the version bound then is kept, whatever it is by that day — or
     * where no repository reads versions.
     */
    pendingChangeVersionId: string | null;
    /** See `ImmediatePlanChangeInput.expectedCanceledAt`. */
    expectedCanceledAt: Date | null;
    /** See `ImmediatePlanChangeInput.expectedPlanVersionId`. */
    expectedPlanVersionId?: string | null;
    /**
     * The change the caller read as scheduled, where its decision rests on it —
     * `null` for nothing scheduled. The write claims the row only while that
     * still holds. A switch to a version offered passes `null`: an offer is
     * made only while nothing is scheduled, and a change scheduled in between
     * would otherwise be written over. Left out, it is not claimed.
     */
    expectedPendingPlan?: string | null;
}

/**
 * Input for `applyOnboardingSelection`. Plan-change fields that the
 * adapter persists atomically in a single transaction.
 */
export interface ApplyOnboardingSelectionInput {
    planId: string;
    cycle: string;
    /**
     * See `ImmediatePlanChangeInput.expectedCanceledAt`. The atomic path needs
     * it for the same reason the sequential one does: without it, the preferred
     * implementation is the one where the race stays open.
     */
    expectedCanceledAt: Date | null;
    /** For TRIAL → null, otherwise period start from `initialPeriodWindow`. */
    periodStart: Date | null;
    periodEnd: Date | null;
    /** For TRIAL → null, otherwise typically `'ACTIVE'`. */
    nextStatus: string | null;
}

/**
 * Result of the atomically executed onboarding step. Contains all
 * effects that the platform service can log / respond with downstream.
 */
export interface ApplyOnboardingSelectionResult {
    plan: string;
    billingCycle: string;
    subscriptionId: string;
    /** null if no redeemPromo callback was provided or the callback returned null. */
    promoRedemption: PromoCodeRedemptionRecord | null;
    /**
     * False when the row's cancellation moved since the caller read it, in
     * which case nothing was written — including the promo redemption, which
     * shares the transaction.
     */
    claimed: boolean;
}

/**
 * Callback signature for promo-code redemption WITHIN the onboarding
 * transaction. The platform service injects a closure that calls `PromoCodesService.
 * redeemInTransaction(...)`; the adapter calls it after the
 * subscription update, so that everything lives in a single DB transaction.
 */
export type RedeemPromoInTransactionCallback = (
    tx: TransactionContext,
    subscriptionId: string,
) => Promise<PromoCodeRedemptionRecord>;

/**
 * Write adapter for tenant self-service mutations
 * (`POST /billing/plan`, `/billing/cancel` etc.).
 *
 * The consumer implementation persists into its subscription table.
 * Atomicity lies in the adapter, because transaction-client types are
 * app-specific. The platform service calls `invalidateTenant` in the
 * EntitlementService after a successful adapter call.
 */
/** What `cancelSubscription` is told to write. Named so both adapters spell
 * the same shape once rather than each restating it. */
export interface CancelSubscriptionInput {
    canceledAt: Date;
    effectiveAt: Date;
    terminateNow: boolean;
    minimumTermUntil?: Date;
}

/** What `cancelSubscription` answers with. */
export interface CancelSubscriptionResult {
    canceledAt: Date | null;
    canceledEffectiveAt: Date | null;
    status: string;
    /**
     * True when a cancellation was already recorded and this call changed
     * nothing — the stored dates are returned instead.
     *
     * The caller checks first, but a check and a write are two moments, and two
     * requests can pass the check before either writes. Straddling a notice
     * deadline that costs a billing cycle: the first declaration lands on time,
     * the second recomputes against a later `now`, and an unconditional write
     * replaces the first answer with one a period further out. An
     * implementation therefore claims the row only while both cancellation
     * fields are still empty, and answers `true` here when the claim finds
     * nothing to claim.
     */
    alreadyCanceled: boolean;
}

export interface TenantSubscriptionWritePort {
    /**
     * Whether the writes that change a plan — the immediate change and the
     * onboarding selection — bind the subscription's `planVersionId` to the
     * version they sell. A contract freeze records the bound version, so it
     * refuses to start beside a write that says `false`. Left out, it is taken
     * on trust: the platform cannot see into a write it did not ship.
     */
    readonly bindsPlanVersion?: boolean;

    /** Immediate change: set plan + cycle, clear pending fields, optionally reset the period. */
    changePlanImmediate(
        tenantId: string,
        input: ImmediatePlanChangeInput,
    ): Promise<{
        plan: string;
        billingCycle: string;
        /**
         * False when what the caller claimed moved since it read it — the
         * cancellation, and the binding where it passed one — or when the
         * version it required no longer takes bookings.
         */
        claimed: boolean;
    }>;

    /** Change at period end: set pending fields. */
    schedulePlanChange(
        tenantId: string,
        input: ScheduledPlanChangeInput,
    ): Promise<{ claimed: boolean }>;

    /**
     * Record a cancellation. The dates are decided above this port.
     *
     * `canceledAt` is when the customer said it; `effectiveAt` is when it
     * lands. They differ for every ordinary cancellation, because a
     * subscription cancelled inside its term keeps running, keeps being billed
     * and keeps its entitlements until the term ends. An adapter that computed
     * the second from the first — which this one did, as
     * `immediate ? now : currentPeriodEnd` — was deciding a commercial
     * question in a persistence layer, and could not see the minimum term or
     * the notice period at all.
     *
     * `terminateNow` flips the status immediately, and is set when the
     * cancellation is already effective: an operator ending a contract, or the
     * rules finding nothing left to run — no period, no term, as on a trial.
     * It is never a client's request. A tenant may always declare a
     * cancellation and may never shorten the term they are in; what decides
     * this flag is the date the rules returned, not the date they asked for.
     *
     * `minimumTermUntil` extends the stored commitment, and is set only when
     * the cancellation itself extends it: a declaration made after the notice
     * deadline buys the following period. Left unset the stored term end is
     * unchanged, which is the ordinary case.
     */
    cancelSubscription(
        tenantId: string,
        input: CancelSubscriptionInput,
    ): Promise<CancelSubscriptionResult>;

    /**
     * Atomic onboarding creation: sets plan + cycle + period window
     * AND optionally calls a promo-redeem callback — all in a
     * single consumer transaction. Without this method the
     * platform service falls back to sequential `changePlanImmediate +
     * promoCodes.redeem` calls (best-effort,
     * P10.1.1 transitional solution).
     *
     * Optional, because existing adapters can add the support
     * incrementally — a missing implementation is not a hard error.
     */
    applyOnboardingSelection?(
        tenantId: string,
        input: ApplyOnboardingSelectionInput,
        redeemPromo: RedeemPromoInTransactionCallback | null,
    ): Promise<ApplyOnboardingSelectionResult>;
}

/** Read adapter for PlanVersions. */
export interface PlanVersionRepository {
    /**
     * The version of a plan on sale at `asOf` — what a booking made then
     * binds — by the same rule as `PlanRepository.findActivePlanVersion`:
     *   `publishedAt IS NOT NULL`
     *   `(validFrom IS NULL OR validFrom <= asOf)`
     *   `(validUntil IS NULL OR validUntil >= startOfUtcDay(asOf))`
     *   `(endsAt IS NULL OR endsAt > asOf)`
     *
     * `validUntil` is day-inclusive. If multiple versions match, adapters
     * return the highest `validFrom`, ordering null start dates last, then the
     * highest version. Adapters build the WHERE with
     * `buildActivePlanVersionWhere(asOf, { withEndsAt: true })`. Optionally
     * within a transaction.
     *
     * A plan key no plan has finds `null`, not an error.
     */
    findActive(
        planId: string,
        asOf?: Date,
        tx?: TransactionContext,
    ): Promise<PlanVersionRecord | null>;
}
