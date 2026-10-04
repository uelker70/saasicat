// An in-memory adapter with the semantics the contract expects.
//
// The kit's own self-test runs the contract against it, and the gap tests
// run it with parts left out. Lock scenarios gate off via
// `pessimisticLocking: false`: in-memory cannot emulate row locks — the same
// reason the nest fakes must not be used to "verify" adapters.

import {
    ACTIVE_SUBSCRIPTION_CONTRACT_STATUSES,
    bundleKeyTaken,
    catalogDraftExists,
    catalogVersionAlreadyPublished,
    catalogVersionGone,
    formatCustomerNumber,
    identityCorrectionDelta,
    isVersionActiveAt,
    noActivePlanVersion,
    planKeyTaken,
    promoCodeTaken,
    readCustomLimits,
    refuseForeignPaymentMethodReference,
    scheduledChangeAfterWrite,
    subscriberChargeColumns,
    subscriberPaymentMethodColumns,
    toSubscriberChargeRecord,
    subscriptionBundleAlreadyCancelled,
    subscriptionBundleGone,
    subscriptionContractGone,
    subscriptionGone,
    keepsVatIdCheck,
    taxOriginWrite,
    toSubscriptionBundleRecord,
} from '@saasicat/core';

// A fixed instant: this harness has no clock of its own, and a timestamp that
// moves between two reads is a difference no scenario asked for.
const FIXED_NOW = new Date('2026-01-01T00:00:00.000Z');

/** Where the canonical schema starts counting customer numbers. */
const FIRST_CUSTOMER_NUMBER = 10001;

/**
 * The parts this harness deliberately does not provide: it keeps no validity
 * windows and no version lineage per plan. One list for every run against it,
 * so the self-test and the gap tests cannot declare two different harnesses.
 */
export const MEMORY_HARNESS_GAPS = [
    'planLifecycle',
    'planCatalogRead',
    'bundleValidity',
    'planVersionReads',
    'planVersionRetirement',
];

export function createMemoryHarness() {
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
        promoCodeHolds: [],
        redemptions: [],
        audits: [],
        mfa: new Map(),
        contracts: [],
        contractLines: [],
        ledgerEntries: [],
        subscribers: [],
        subscriberCorrections: [],
        subscriberTaxOriginChanges: [],
        subscriberVatIdChecks: [],
        paymentEvents: [],
        paymentMethods: [],
        paymentMethodSetups: [],
        nextCustomerSequence: FIRST_CUSTOMER_NUMBER,
        checkoutOffers: [],
        appliedSettings: null,
        settingsChanges: [],
        maintenanceWindows: [],
        subscriptionNotices: [],
        versionRetirements: [],
        bundleVersionRetirements: [],
    });

    let transactionCounter = 0;
    const transactionRunner = {
        async run(fn) {
            const snapshot = structuredClone(state);
            try {
                return await fn({ memoryTx: ++transactionCounter });
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
                customLimits: readCustomLimits(row.customLimits).limits,
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
                    s.planVersionId === planVersionId || s.pendingChangeVersionId === planVersionId,
            ).length;
        },
    };

    const planVersionRepository = {
        async findActive(planId, asOf = new Date()) {
            // The latest start first, a version without one last, then the
            // highest number — the order the adapters ask the database for.
            const startOf = (v) => (v.validFrom ? new Date(v.validFrom).getTime() : -Infinity);
            const onSale = state.planVersions
                .filter((v) => v.planId === planId && v.publishedAt && isVersionActiveAt(v, asOf))
                .sort((a, b) => startOf(b) - startOf(a) || b.version - a.version)[0];
            return onSale
                ? { planId: onSale.planId, quotas: onSale.quotas, features: onSale.features }
                : null;
        },
    };

    const tenantSubscriptionWrite = {
        async changePlanImmediate(tenantId, input) {
            const row = state.subscriptions.find(
                (subscription) => subscription.tenantId === tenantId,
            );
            if (!row) throw subscriptionGone(tenantId);
            const unclaimed = { plan: row.plan, billingCycle: row.billingCycle, claimed: false };
            // The binding the caller decided from, where it named one.
            if (
                input.expectedPlanVersionId !== undefined &&
                (row.planVersionId ?? null) !== input.expectedPlanVersionId
            ) {
                return unclaimed;
            }
            // A change of rhythm keeps the version the subscriber agreed to.
            const keepsVersion =
                input.keepsBoundVersion &&
                row.plan === input.planId &&
                (row.planVersionId ?? null) !== null;
            // A change that names the version it was quoted at is bound to it,
            // while that version still takes bookings on the day it lands — or,
            // where the write puts a binding back, whatever its sale.
            const asOf = input.periodStart ?? new Date();
            const quotedRow = state.planVersions.find(
                (version) => version.id === input.quotedPlanVersionId,
            );
            const takesBookings =
                quotedRow &&
                !(quotedRow.validFrom && new Date(quotedRow.validFrom) > asOf) &&
                !(quotedRow.endsAt && new Date(quotedRow.endsAt) <= asOf);
            const quoted =
                quotedRow &&
                quotedRow.planId === input.planId &&
                (input.restoresQuotedVersion || takesBookings)
                    ? { id: quotedRow.id }
                    : null;
            if (!keepsVersion && input.quotedVersionOnly && !quoted) return unclaimed;
            // A version of the plan kept, named but no longer bookable, keeps
            // the version bound rather than one nobody was offered.
            const namedVersionGone =
                !quoted &&
                (input.quotedPlanVersionId ?? null) !== null &&
                row.plan === input.planId &&
                (row.planVersionId ?? null) !== null;
            const target =
                keepsVersion || namedVersionGone
                    ? { id: row.planVersionId }
                    : (quoted ??
                      state.planVersions
                          .filter(
                              (version) =>
                                  version.planId === input.planId &&
                                  version.publishedAt &&
                                  !version.supersededAt,
                          )
                          .sort((a, b) => b.version - a.version)[0]);
            if (!target) throw noActivePlanVersion(input.planId, input.periodStart ?? new Date());
            // The contract's own claim: the write takes the row only while the
            // cancellation is what the caller read. This reference store keeps
            // the field as `null` unless something set it, which is what the
            // real column does.
            if ((row.canceledAt ?? null) !== (input.expectedCanceledAt ?? null)) {
                return { plan: row.plan, billingCycle: row.billingCycle, claimed: false };
            }
            Object.assign(
                row,
                scheduledChangeAfterWrite(
                    {
                        plan: row.plan,
                        pendingPlan: row.pendingPlan ?? null,
                        pendingBillingCycle: row.pendingBillingCycle ?? null,
                        pendingEffectiveAt: row.pendingEffectiveAt ?? null,
                        pendingChangeVersionId: row.pendingChangeVersionId ?? null,
                    },
                    input,
                ),
            );
            row.plan = input.planId;
            row.billingCycle = input.cycle;
            row.planVersionId = target.id;
            return { plan: row.plan, billingCycle: input.cycle, claimed: true };
        },
        async applyOnboardingSelection(tenantId, input, redeemPromo) {
            return transactionRunner.run(async (tx) => {
                const changed = await tenantSubscriptionWrite.changePlanImmediate(tenantId, {
                    ...input,
                    trialEndsAt: null,
                    expectedCanceledAt: null,
                    keepsBoundVersion: false,
                    quotedPlanVersionId: null,
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
        async schedulePlanChange(tenantId, input) {
            const row = state.subscriptions.find(
                (subscription) => subscription.tenantId === tenantId,
            );
            if (!row) throw subscriptionGone(tenantId);
            // The cancellation, and where the caller named them, the binding
            // and the change already scheduled.
            const holds =
                (row.canceledAt ?? null) === (input.expectedCanceledAt ?? null) &&
                (input.expectedPlanVersionId === undefined ||
                    (row.planVersionId ?? null) === input.expectedPlanVersionId) &&
                (input.expectedPendingPlan === undefined ||
                    (row.pendingPlan ?? null) === input.expectedPendingPlan);
            if (!holds) return { claimed: false };
            row.pendingPlan = input.pendingPlan;
            row.pendingBillingCycle = input.pendingBillingCycle;
            row.pendingEffectiveAt = input.pendingEffectiveAt;
            row.pendingChangeVersionId = input.pendingChangeVersionId;
            return { claimed: true };
        },
        async cancelSubscription() {
            return { canceledAt: new Date(), status: 'CANCELED' };
        },
    };

    const promoCode = (id) => state.promoCodes.find((c) => c.id === id);
    /** A slot is free while redemptions and holds together stay below the limit. */
    const hasFreeSlot = (row) =>
        row.maxRedemptions === null || row.redemptionsCount + row.heldCount < row.maxRedemptions;

    // A `numeric(p,2)` column: the decimal written, rounded half away from
    // zero. Shifting by `e2` parses a decimal string, so it is exact where
    // multiplying the double by 100 is not.
    const toCents = (value) =>
        value == null ? value : (Math.round(Number(`${value}e2`)) / 100).toFixed(2);
    const promoCodeRepository = {
        async findMany(filter) {
            const search = filter.search?.toUpperCase();
            return state.promoCodes
                .filter((code) => !code.deletedAt && (!search || code.code.includes(search)))
                .map((code) => ({ ...code }));
        },
        async create(data) {
            // A name is taken for good, by a deleted code too — the unique index
            // the real tables carry.
            if (state.promoCodes.some((candidate) => candidate.code === data.code)) {
                throw promoCodeTaken(data.code);
            }
            const row = {
                id: nextId('promo'),
                code: data.code,
                valueType: data.valueType,
                value: toCents(data.value),
                durationType: data.durationType,
                durationValue: data.durationValue ?? null,
                validFrom: data.validFrom ?? null,
                validUntil: data.validUntil ?? null,
                maxRedemptions: data.maxRedemptions ?? null,
                redemptionsCount: 0,
                heldCount: 0,
                appliesToPlans: data.appliesToPlans ?? [],
                appliesToBilling: data.appliesToBilling ?? null,
                firstTimeCustomersOnly: data.firstTimeCustomersOnly ?? true,
                minimumPlanAmountGross: toCents(data.minimumPlanAmountGross) ?? null,
                allowZeroInvoice: data.allowZeroInvoice ?? false,
                status: 'ACTIVE',
                description: data.description ?? null,
                campaignTag: data.campaignTag ?? null,
                revenueDeductionAccount: data.revenueDeductionAccount ?? null,
                createdById: data.createdById,
                deletedAt: null,
            };
            state.promoCodes.push(row);
            return { ...row };
        },
        async findById(id) {
            const row = promoCode(id);
            return row ? { ...row } : null;
        },
        async findByCode(code) {
            // Deleted codes included, as both real adapters answer it.
            const row = state.promoCodes.find((candidate) => candidate.code === code);
            return row ? { ...row } : null;
        },
        async expireDueCodes(now) {
            let expired = 0;
            for (const row of state.promoCodes) {
                if (row.deletedAt || !['ACTIVE', 'PAUSED'].includes(row.status)) continue;
                if (!row.validUntil || row.validUntil >= now) continue;
                row.status = 'EXPIRED';
                expired += 1;
            }
            return expired;
        },
        async update(id, data) {
            const amounts = {};
            if ('value' in data) amounts.value = toCents(data.value);
            if ('minimumPlanAmountGross' in data) {
                amounts.minimumPlanAmountGross = toCents(data.minimumPlanAmountGross);
            }
            Object.assign(promoCode(id), data, amounts);
            return { ...promoCode(id) };
        },
        async softDelete(id) {
            promoCode(id).deletedAt = FIXED_NOW;
        },
        async claimSlot(id) {
            const row = promoCode(id);
            if (!row || row.status !== 'ACTIVE' || row.deletedAt || !hasFreeSlot(row)) {
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

    /**
     * The reference implementation of the slots a code keeps for checkouts.
     * A hold ends by leaving the list, and its slot moves with it — back to
     * the code, or to its redemptions — so it is counted exactly while listed.
     */
    const endHold = (hold, { redeemed }) => {
        state.promoCodeHolds = state.promoCodeHolds.filter((h) => h !== hold);
        const row = promoCode(hold.promoCodeId);
        row.heldCount = Math.max(row.heldCount - 1, 0);
        if (redeemed) row.redemptionsCount += 1;
    };
    const holdView = ({ id, promoCodeId, checkoutOfferId, expiresAt, createdAt }) => ({
        id,
        promoCodeId,
        checkoutOfferId,
        expiresAt,
        createdAt,
    });
    const heldBy = (checkoutOfferId) =>
        state.promoCodeHolds.find((h) => h.checkoutOfferId === checkoutOfferId);
    const promoCodeHoldRepository = {
        async findByCheckoutOffer(checkoutOfferId) {
            const hold = heldBy(checkoutOfferId);
            return hold ? holdView(hold) : null;
        },
        async take({ promoCodeId, checkoutOfferId, expiresAt }) {
            const row = promoCode(promoCodeId);
            if (!row) return { outcome: 'no-slot' };
            if (heldBy(checkoutOfferId)) return { outcome: 'offer-holds-one' };
            if (row.status !== 'ACTIVE' || row.deletedAt || !hasFreeSlot(row)) {
                return { outcome: 'no-slot' };
            }
            row.heldCount += 1;
            const hold = {
                id: nextId('hold'),
                promoCodeId,
                checkoutOfferId,
                expiresAt,
                createdAt: FIXED_NOW,
                handedOverTx: null,
            };
            state.promoCodeHolds.push(hold);
            return { outcome: 'taken', hold: holdView(hold) };
        },
        async extend(checkoutOfferId, promoCodeId, expiresAt) {
            const hold = heldBy(checkoutOfferId);
            if (!hold || hold.promoCodeId !== promoCodeId) return false;
            if (expiresAt > hold.expiresAt) hold.expiresAt = expiresAt;
            return true;
        },
        async release(checkoutOfferId) {
            const hold = heldBy(checkoutOfferId);
            if (!hold) return false;
            endHold(hold, { redeemed: false });
            return true;
        },
        async releaseIfUnmoved(checkoutOfferId, expiresAt) {
            const hold = heldBy(checkoutOfferId);
            if (!hold || hold.expiresAt.getTime() !== expiresAt.getTime()) return false;
            endHold(hold, { redeemed: false });
            return true;
        },
        async handOver(checkoutOfferId, now, tx) {
            const hold = heldBy(checkoutOfferId);
            if (!hold || hold.expiresAt <= now) return false;
            hold.handedOverTx = tx.memoryTx;
            return true;
        },
        async convertHandedOver(promoCodeId, tx) {
            const hold = state.promoCodeHolds.find(
                (h) => h.promoCodeId === promoCodeId && h.handedOverTx === tx.memoryTx,
            );
            if (!hold) return false;
            endHold(hold, { redeemed: true });
            return true;
        },
        async expireDue(now, promoCodeId, tx) {
            const due = state.promoCodeHolds.filter(
                (h) =>
                    h.expiresAt <= now &&
                    (tx === undefined || h.handedOverTx !== tx.memoryTx) &&
                    (promoCodeId === undefined || h.promoCodeId === promoCodeId),
            );
            for (const hold of due) endHold(hold, { redeemed: false });
            return due.length;
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
        // A claim: only a redemption not reversed yet is reversed, so one of
        // two reversals wins.
        async setReversed(id) {
            const row = state.redemptions.find((r) => r.id === id);
            if (!row || row.status === 'REVERSED') return null;
            row.status = 'REVERSED';
            row.reversedAt = new Date();
            return { ...row };
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
                if (filter.actorTag && !actorTagMatches(entry.actorTag, filter.actorTag)) {
                    return false;
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
            return toSubscriptionBundleRecord(row);
        },
        async listBySubscription(subscriptionId) {
            return state.subscriptionBundles
                .filter((row) => row.subscriptionId === subscriptionId)
                .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
                .map(toSubscriptionBundleRecord);
        },
        async findById(id) {
            const row = state.subscriptionBundles.find((candidate) => candidate.id === id);
            return row ? toSubscriptionBundleRecord(row) : null;
        },
        async listOfVersion(bundleVersionId) {
            return state.subscriptionBundles
                .filter((row) => row.bundleVersionId === bundleVersionId)
                .sort(
                    (a, b) =>
                        b.startedAt.getTime() - a.startedAt.getTime() || (a.id < b.id ? -1 : 1),
                )
                .map(toSubscriptionBundleRecord);
        },
        async listActiveBySubscription(subscriptionId, now = new Date()) {
            return state.subscriptionBundles
                .filter(
                    (row) =>
                        row.subscriptionId === subscriptionId &&
                        (row.canceledAt === null || row.canceledEffectiveAt > now),
                )
                .map(toSubscriptionBundleRecord);
        },
        async cancel(id, { canceledAt, canceledEffectiveAt }) {
            // Refuses an already-cancelled booking, as the port says and both
            // real adapters now do. A reference implementation that is lenient
            // where they are strict is not a reference.
            const row = state.subscriptionBundles.find((candidate) => candidate.id === id);
            if (!row) throw subscriptionBundleGone(id);
            if (row.canceledAt !== null) throw subscriptionBundleAlreadyCancelled(id);
            row.canceledAt = canceledAt;
            row.canceledEffectiveAt = canceledEffectiveAt;
            return toSubscriptionBundleRecord(row);
        },
        async moveToVersion(id, from, to) {
            const row = state.subscriptionBundles.find((candidate) => candidate.id === id);
            if (!row || row.bundleVersionId !== from) return null;
            row.bundleVersionId = to;
            return toSubscriptionBundleRecord(row);
        },
        async reactivate(id) {
            const row = state.subscriptionBundles.find((candidate) => candidate.id === id);
            if (!row) throw new Error(`SubscriptionBundle '${id}' not found`);
            row.canceledAt = null;
            row.canceledEffectiveAt = null;
            return toSubscriptionBundleRecord(row);
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
                subscriberId: data.parties.subscriberId,
                subscriber: structuredClone(data.parties.subscriber),
                issuer: structuredClone(data.parties.issuer),
                partiesMigrated: data.partiesMigrated ?? false,
                taxTreatment: structuredClone(data.taxTreatment ?? null),
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
        async findByOriginalOfferId(offerId) {
            const row = state.contracts.find((candidate) => candidate.originalOfferId === offerId);
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
        async listRunningIssuers(limit, asOf = FIXED_NOW) {
            const running = state.contracts
                .filter(
                    (row) =>
                        ACTIVE_CONTRACT_STATUSES.includes(row.status) &&
                        (row.effectiveUntil === null || row.effectiveUntil > asOf),
                )
                .sort(
                    (a, b) =>
                        a.effectiveFrom - b.effectiveFrom ||
                        a.createdAt - b.createdAt ||
                        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
                );
            return {
                total: running.length,
                contracts: running.slice(0, limit).map((row) => ({
                    id: row.id,
                    tenantId: row.tenantId,
                    issuerLegalName: row.issuer?.legalName ?? null,
                    effectiveFrom: row.effectiveFrom,
                })),
            };
        },
        async terminate(contractId, data) {
            const row = state.contracts.find(
                (candidate) => candidate.id === contractId && candidate.tenantId === data.tenantId,
            );
            if (!row) throw subscriptionContractGone(contractId);
            row.effectiveUntil = data.effectiveUntil;
            if (data.status !== null) row.status = data.status;
            row.updatedAt = FIXED_NOW;
            return withLines(row);
        },
        async supersede(contractId, data) {
            const row = state.contracts.find(
                (candidate) => candidate.id === contractId && candidate.tenantId === data.tenantId,
            );
            // The condition the adapters put on their update: in force under
            // an active status, and ending when the caller read it.
            const endedAsRead =
                (row?.effectiveUntil?.getTime() ?? null) ===
                (data.readEffectiveUntil?.getTime() ?? null);
            if (!row || !ACTIVE_CONTRACT_STATUSES.includes(row.status) || !endedAsRead) {
                return null;
            }
            row.effectiveUntil = data.at;
            row.status = 'superseded';
            row.updatedAt = FIXED_NOW;
            return withLines(row);
        },
    };

    // Subscribers, one live per tenant. The link lives on the row as `tenantId`,
    // which is all a harness without history needs.
    // The reference to the counting check is the row's, not the record's.
    const subscriberRecord = ({
        customerSequence,
        customerNumberPrefix,
        currentVatIdCheckId: _counting,
        vatIdSince: _since,
        ...row
    }) => ({
        ...structuredClone(row),
        business: row.business ?? null,
        customerNumber: formatCustomerNumber(customerNumberPrefix, customerSequence),
    });
    // The changes of the tax origin and the checks of a VAT id are dated when
    // they are written, as the adapters date them — the places this harness
    // reads a clock, because the scenarios hold those dates to the moment of
    // the call.
    const recordTaxOriginChange = (subscriberId, origin, changedBy, changedAt = new Date()) => {
        if (!origin.moved) return null;
        const change = {
            id: nextId('tax-origin-change'),
            subscriberId,
            previous: origin.previous,
            changed: origin.changed,
            changedBy,
            changedAt,
        };
        state.subscriberTaxOriginChanges.push(change);
        return structuredClone(change);
    };
    const vatIdCheckById = (checkId) => {
        const check = state.subscriberVatIdChecks.find((candidate) => candidate.id === checkId);
        return check ? structuredClone(check) : null;
    };
    const subscriberRepository = {
        async createForTenant(data) {
            if (state.subscribers.some((row) => row.tenantId === data.tenantId)) return null;
            const row = {
                ...structuredClone(data),
                id: nextId('subscriber'),
                customerSequence: state.nextCustomerSequence++,
                migrated: false,
                currentVatIdCheckId: null,
                vatIdSince: null,
                createdAt: FIXED_NOW,
                updatedAt: FIXED_NOW,
            };
            state.subscribers.push(row);
            return subscriberRecord(row);
        },
        async findById(subscriberId) {
            const row = state.subscribers.find((candidate) => candidate.id === subscriberId);
            return row ? subscriberRecord(row) : null;
        },
        async findByTenantId(tenantId) {
            const row = state.subscribers.find((candidate) => candidate.tenantId === tenantId);
            return row ? subscriberRecord(row) : null;
        },
        async updateContact(subscriberId, change, changedBy) {
            const row = state.subscribers.find((candidate) => candidate.id === subscriberId);
            if (!row) return null;
            const origin = taxOriginWrite(row, { country: change.country });
            Object.assign(row, structuredClone(change));
            recordTaxOriginChange(subscriberId, origin, changedBy);
            return subscriberRecord(row);
        },
        async correctIdentity(subscriberId, data) {
            const row = state.subscribers.find((candidate) => candidate.id === subscriberId);
            if (!row) return null;
            const delta = identityCorrectionDelta(row, data.corrected);
            if (Object.keys(delta.corrected).length === 0) {
                return { subscriber: subscriberRecord(row), correction: null };
            }
            const changedAt = new Date();
            const origin = taxOriginWrite(row, { vatId: delta.corrected.vatId });
            Object.assign(row, delta.corrected);
            recordTaxOriginChange(subscriberId, origin, data.correctedBy, changedAt);
            if (origin.endsCountingVatIdCheck) {
                row.currentVatIdCheckId = null;
                row.vatIdSince = changedAt;
            }
            const correction = {
                id: nextId('correction'),
                subscriberId,
                previous: delta.previous,
                corrected: delta.corrected,
                reason: data.reason,
                correctedBy: data.correctedBy,
                correctedAt: changedAt,
            };
            state.subscriberCorrections.push(correction);
            return { subscriber: subscriberRecord(row), correction: structuredClone(correction) };
        },
        async listCorrections(subscriberId) {
            // The latest written first, as the adapters read them by the number
            // the database gave each.
            return state.subscriberCorrections
                .filter((correction) => correction.subscriberId === subscriberId)
                .reverse()
                .map((correction) => structuredClone(correction));
        },
        async changeBusinessStatus(subscriberId, data) {
            const row = state.subscribers.find((candidate) => candidate.id === subscriberId);
            if (!row) return null;
            const origin = taxOriginWrite(
                { ...row, business: row.business ?? null },
                { business: data.business },
            );
            if (!origin.moved) return { subscriber: subscriberRecord(row), change: null };
            row.business = data.business;
            const change = recordTaxOriginChange(subscriberId, origin, data.changedBy);
            return { subscriber: subscriberRecord(row), change };
        },
        async recordVatIdCheck(subscriberId, check) {
            const row = state.subscribers.find((candidate) => candidate.id === subscriberId);
            if (!row) return null;
            const recorded = {
                ...structuredClone(check),
                id: nextId('vat-id-check'),
                subscriberId,
                recordedAt: new Date(),
            };
            state.subscriberVatIdChecks.push(recorded);
            const counting = vatIdCheckById(row.currentVatIdCheckId);
            if (!keepsVatIdCheck(row, counting, recorded)) {
                return { recorded: structuredClone(recorded), current: counting };
            }
            row.currentVatIdCheckId = recorded.id;
            return { recorded: structuredClone(recorded), current: structuredClone(recorded) };
        },
        async findCurrentVatIdCheck(subscriberId) {
            const row = state.subscribers.find((candidate) => candidate.id === subscriberId);
            return row ? vatIdCheckById(row.currentVatIdCheckId) : null;
        },
        async listVatIdChecks(subscriberId) {
            // The latest checked first; of two checked at once, the later written.
            return state.subscriberVatIdChecks
                .map((check, index) => ({ check, index }))
                .filter(({ check }) => check.subscriberId === subscriberId)
                .sort(
                    (a, b) =>
                        b.check.checkedAt.getTime() - a.check.checkedAt.getTime() ||
                        b.index - a.index,
                )
                .map(({ check }) => structuredClone(check));
        },
        async listTaxOriginChanges(subscriberId) {
            // The latest written first, as the adapters read them by the number
            // the database gave each.
            return state.subscriberTaxOriginChanges
                .filter((change) => change.subscriberId === subscriberId)
                .reverse()
                .map((change) => structuredClone(change));
        },
    };

    // The plan stem, which the contract's identity scenarios need, and the
    // draft's own steps — create, publish, discard — whose claim the contract
    // checks. The time-aware reads stay out: the version lifecycle is
    // `planVersionRepository`'s, and offering a half of it here would make
    // those scenarios pass against a shape no real adapter has.
    const planRepository = {
        async create(data) {
            // `plans_planKey_key` in memory — a key is taken once for the whole
            // installation, retired rows included.
            if (state.plans.some((candidate) => candidate.planKey === data.planKey)) {
                throw planKeyTaken(data.planKey);
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
        async createPlanVersionDraft(data) {
            const versions = state.planVersions.filter((v) => v.planId === data.planId);
            const draft = versions.find((v) => v.publishedAt === null);
            if (draft) throw catalogDraftExists('PlanVersion', data.planId, draft.version);
            const row = {
                id: nextId('pv'),
                planId: data.planId,
                version: versions.length + 1,
                features: [...data.features],
                quotas: data.quotas ?? {},
                monthlyNet: data.monthlyNet,
                yearlyNet: data.yearlyNet,
                publishedAt: null,
                publishedByUserId: null,
                supersededAt: null,
                validFrom: null,
                validUntil: null,
            };
            state.planVersions.push(row);
            return { ...row };
        },
        async findVersionById(versionId) {
            const row = state.planVersions.find((candidate) => candidate.id === versionId);
            return row ? { ...row } : null;
        },
        async publishPlanVersionDraft(versionId, meta) {
            // Claimed before the predecessor is touched, as both real adapters
            // do, and with nothing awaited in between: a second publication of
            // one draft loses before it changes anything.
            const row = state.planVersions.find(
                (candidate) => candidate.id === versionId && candidate.publishedAt === null,
            );
            if (!row) {
                const exists = state.planVersions.some((candidate) => candidate.id === versionId);
                throw exists
                    ? catalogVersionAlreadyPublished('PlanVersion', versionId)
                    : catalogVersionGone('PlanVersion', versionId);
            }
            row.publishedAt = FIXED_NOW.toISOString();
            row.publishedByUserId = meta.publishedByUserId;
            row.validFrom = meta.validFrom.toISOString();
            row.validUntil = meta.validUntil?.toISOString() ?? null;
            for (const other of state.planVersions) {
                if (other.planId !== row.planId || other.id === versionId) continue;
                if (!other.publishedAt || other.supersededAt) continue;
                other.supersededAt = FIXED_NOW.toISOString();
            }
            return { ...row };
        },
        async deletePlanVersionDraft(versionId) {
            const index = state.planVersions.findIndex(
                (candidate) => candidate.id === versionId && candidate.publishedAt === null,
            );
            if (index >= 0) {
                state.planVersions.splice(index, 1);
                return;
            }
            if (!state.planVersions.some((candidate) => candidate.id === versionId)) return;
            throw catalogVersionAlreadyPublished('PlanVersion', versionId);
        },
    };

    const bundleRepository = {
        async create(data) {
            // The unique index, in memory: a key is taken once for the whole
            // installation, retired rows included.
            if (state.bundles.some((candidate) => candidate.bundleKey === data.bundleKey)) {
                throw bundleKeyTaken(data.bundleKey);
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
            const draft = versions.find((v) => v.publishedAt === null);
            if (draft) {
                const bundle = state.bundles.find((candidate) => candidate.id === data.bundleId);
                throw catalogDraftExists(
                    'BundleVersion',
                    bundle?.bundleKey ?? data.bundleId,
                    draft.version,
                );
            }
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
                const exists = state.bundleVersions.some((candidate) => candidate.id === versionId);
                throw exists
                    ? catalogVersionAlreadyPublished('BundleVersion', versionId)
                    : catalogVersionGone('BundleVersion', versionId);
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
            throw catalogVersionAlreadyPublished('BundleVersion', versionId);
        },
    };

    const paymentEventLog = {
        async claim(claim) {
            const confirmation = claim.kind === 'payment-method-confirmed';
            const taken = state.paymentEvents.some(
                (event) =>
                    event.gatewayAccount === claim.gatewayAccount &&
                    (event.eventId === claim.eventId ||
                        // One session is confirmed once, whatever the event is
                        // called: the partial unique index in
                        // sql/constraints.postgres.sql. A claim without a
                        // session collides with nothing, as nulls are distinct
                        // in a unique index.
                        (confirmation &&
                            event.kind === 'payment-method-confirmed' &&
                            claim.sessionId != null &&
                            event.sessionId === claim.sessionId)),
            );
            if (taken) return false;
            state.paymentEvents.push(structuredClone(claim));
            return true;
        },
        async releaseSession(gatewayAccount, eventId) {
            const event = state.paymentEvents.find(
                (held) => held.gatewayAccount === gatewayAccount && held.eventId === eventId,
            );
            if (event) event.sessionId = null;
        },
    };

    const subscriberPaymentMethodRepository = {
        async recordConfirmed(data) {
            if (!state.subscribers.some((subscriber) => subscriber.id === data.subscriberId)) {
                throw new Error(`Subscriber '${data.subscriberId}' does not exist.`);
            }
            const recorded = state.paymentMethods.find(
                (row) =>
                    row.gatewayAccount === data.gatewayAccount &&
                    row.paymentMethodRef === data.paymentMethodRef,
            );
            if (recorded) {
                refuseForeignPaymentMethodReference(recorded, data.subscriberId);
                return { method: structuredClone(recorded), outcome: 'already-recorded' };
            }
            const active = state.paymentMethods.find(
                (row) => row.subscriberId === data.subscriberId && row.status === 'ACTIVE',
            );
            const row = {
                ...subscriberPaymentMethodColumns(data),
                id: nextId('payment-method'),
                createdAt: FIXED_NOW,
            };
            if (active && active.confirmedAt.getTime() > data.confirmedAt.getTime()) {
                state.paymentMethods.push({
                    ...row,
                    status: 'REPLACED',
                    replacedAt: active.confirmedAt,
                });
                return {
                    method: structuredClone(state.paymentMethods.at(-1)),
                    outcome: 'superseded',
                };
            }
            if (active) {
                active.status = 'REPLACED';
                active.replacedAt = data.confirmedAt;
            }
            state.paymentMethods.push({ ...row, status: 'ACTIVE', replacedAt: null });
            return { method: structuredClone(state.paymentMethods.at(-1)), outcome: 'activated' };
        },
        async findActive(subscriberId) {
            const row = state.paymentMethods.find(
                (candidate) =>
                    candidate.subscriberId === subscriberId && candidate.status === 'ACTIVE',
            );
            return row ? structuredClone(row) : null;
        },
        async findByReference(reference) {
            const row = state.paymentMethods.find(
                (candidate) =>
                    candidate.subscriberId === reference.subscriberId &&
                    candidate.gatewayAccount === reference.gatewayAccount &&
                    candidate.paymentMethodRef === reference.paymentMethodRef,
            );
            return row ? structuredClone(row) : null;
        },
        async recordSetup(data) {
            const taken = state.paymentMethodSetups.some(
                (setup) =>
                    setup.gatewayAccount === data.gatewayAccount &&
                    setup.sessionRef === data.sessionRef,
            );
            if (taken) throw new Error(`Session '${data.sessionRef}' already has a setup.`);
            state.paymentMethodSetups.push({ ...data, completedAt: null });
        },
        async completeSetup(match, completedAt) {
            const setup = state.paymentMethodSetups.find(
                (candidate) =>
                    candidate.gatewayAccount === match.gatewayAccount &&
                    candidate.sessionRef === match.sessionRef &&
                    candidate.subscriberId === match.subscriberId &&
                    candidate.completedAt === null,
            );
            if (!setup) return false;
            setup.completedAt = completedAt;
            return true;
        },
        async accountsInUse() {
            const accounts = state.paymentMethods
                .filter((row) => row.status === 'ACTIVE')
                .map((row) => row.gatewayAccount);
            return [...new Set(accounts)].sort();
        },
    };

    const seed = {
        async createSubscriber(input) {
            const row = {
                id: nextId('subscriber'),
                legalName: input.legalName,
                customerSequence: state.nextCustomerSequence++,
                customerNumberPrefix: '',
                tenantId: null,
            };
            state.subscribers.push(row);
            return { subscriberId: row.id };
        },
        async clearBookingRequestDate(subscriptionBundleId) {
            const row = state.subscriptionBundles.find(
                (candidate) => candidate.id === subscriptionBundleId,
            );
            if (row) row.canceledAt = null;
        },
        async setBookingCycle(subscriptionBundleId, billingCycle) {
            const row = state.subscriptionBundles.find(
                (candidate) => candidate.id === subscriptionBundleId,
            );
            if (row) row.billingCycle = billingCycle;
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
                pendingChangeVersionId: input.pendingChangeVersionId ?? null,
                billingCycle: input.billingCycle ?? 'YEARLY',
                startedAt: input.startedAt ?? null,
                customLimits: input.customLimits ?? null,
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
                heldCount: 0,
                deletedAt: null,
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

    /**
     * The record of the applied configuration: one row, replaced on every
     * write, and a change log that keeps its first acknowledgement.
     */
    const appliedSettings = {
        async readApplied() {
            return state.appliedSettings ? structuredClone(state.appliedSettings) : null;
        },
        async writeApplied(record, expectedFingerprint) {
            // The guard, as a database keeps it: the row is replaced only while
            // it still carries the fingerprint the caller read, and `null` only
            // while there is no row.
            if ((state.appliedSettings?.fingerprint ?? null) !== expectedFingerprint) return false;
            state.appliedSettings = structuredClone(record);
            return true;
        },
        async recordChange(change, record, expectedFingerprint) {
            if (!(await appliedSettings.writeApplied(record, expectedFingerprint))) return null;
            const row = {
                id: nextId('change'),
                ...structuredClone(change),
                acknowledgedAt: null,
                acknowledgedBy: null,
            };
            state.settingsChanges.push(row);
            return structuredClone(row);
        },
        async listChanges(filter = {}) {
            // The order they were recorded in, latest first — what the database
            // numbers at each write — and not the moment each row carries.
            const rows = [...state.settingsChanges]
                .reverse()
                .filter(
                    (row) =>
                        filter.acknowledged === undefined ||
                        (row.acknowledgedAt !== null) === filter.acknowledged,
                );
            const limited = filter.limit === undefined ? rows : rows.slice(0, filter.limit);
            return structuredClone(limited);
        },
        async acknowledgeChange(id, acknowledgedBy, acknowledgedAt) {
            const row = state.settingsChanges.find((change) => change.id === id);
            if (!row) return null;
            if (row.acknowledgedAt === null) Object.assign(row, { acknowledgedAt, acknowledgedBy });
            return structuredClone(row);
        },
    };

    /**
     * Maintenance windows: at most one open, as the partial unique index keeps
     * it, and every move conditional on the stage the caller read.
     */
    const maintenanceWindows = {
        async findOpen() {
            const open = state.maintenanceWindows.find((row) => row.endedAt === null);
            return open ? structuredClone(open) : null;
        },
        async listRecent(limit) {
            const rows = [...state.maintenanceWindows].sort(
                (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1),
            );
            return structuredClone(rows.slice(0, limit));
        },
        async open(window) {
            if (state.maintenanceWindows.some((row) => row.endedAt === null)) return null;
            const row = {
                id: nextId('window'),
                ...structuredClone(window),
                endedAt: null,
                endedBy: null,
            };
            state.maintenanceWindows.push(row);
            return structuredClone(row);
        },
        async update(id, stage, changes) {
            const row = state.maintenanceWindows.find(
                (candidate) =>
                    candidate.id === id &&
                    candidate.endedAt === null &&
                    (candidate.lockedAt !== null) === (stage === 'locked'),
            );
            if (!row) return null;
            Object.assign(row, structuredClone(changes));
            return structuredClone(row);
        },
    };

    /**
     * Subscriber notices: one per subscription, kind and subject, as the unique
     * key keeps it, and every claim, confirmation and release conditional on
     * the claim the caller holds.
     */
    const subscriptionNotices = {
        async claim(key, content, now, staleBefore) {
            const same = (row) =>
                row.subscriptionId === key.subscriptionId &&
                row.kind === key.kind &&
                row.subject === key.subject;
            if (!state.subscriptionNotices.some(same)) {
                state.subscriptionNotices.push({
                    id: nextId('notice'),
                    ...structuredClone(key),
                    content: structuredClone(content),
                    createdAt: now,
                    claimedAt: null,
                    deliveredAt: null,
                    delivery: null,
                });
            }
            const row = state.subscriptionNotices.find(
                (candidate) =>
                    same(candidate) &&
                    candidate.tenantId === key.tenantId &&
                    candidate.deliveredAt === null &&
                    (candidate.claimedAt === null || candidate.claimedAt < staleBefore),
            );
            if (!row) return null;
            Object.assign(row, { claimedAt: now, content: structuredClone(content) });
            return structuredClone(row);
        },
        async confirm(id, claimedAt, delivery, now) {
            const row = heldNotice(id, claimedAt);
            if (!row) return false;
            Object.assign(row, {
                deliveredAt: now,
                delivery: { recipients: [...delivery.recipients], channel: delivery.channel },
            });
            return true;
        },
        async release(id, claimedAt) {
            const row = heldNotice(id, claimedAt);
            if (row) row.claimedAt = null;
        },
        async listDeliveredSubscriptionIds(kind, subject) {
            return state.subscriptionNotices
                .filter((row) => row.kind === kind && row.subject === subject && row.deliveredAt)
                .map((row) => row.subscriptionId);
        },
        async listForSubscription(subscriptionId) {
            const rows = state.subscriptionNotices
                .filter((row) => row.subscriptionId === subscriptionId)
                .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
            return structuredClone(rows);
        },
        async record(notices, now) {
            let written = 0;
            for (const { content, ...key } of notices) {
                const recorded = state.subscriptionNotices.some(
                    (row) =>
                        row.subscriptionId === key.subscriptionId &&
                        row.kind === key.kind &&
                        row.subject === key.subject,
                );
                if (recorded) continue;
                state.subscriptionNotices.push({
                    id: nextId('notice'),
                    ...structuredClone(key),
                    content: structuredClone(content),
                    createdAt: now,
                    claimedAt: null,
                    deliveredAt: null,
                    delivery: null,
                });
                written += 1;
            }
            return written;
        },
        async listOfKindSince(kind, since) {
            const rows = state.subscriptionNotices
                .filter((row) => row.kind === kind && row.createdAt >= since)
                .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
            return structuredClone(rows);
        },
        async listUndelivered(kind, staleBefore) {
            const rows = state.subscriptionNotices
                .filter(
                    (row) =>
                        row.kind === kind &&
                        row.deliveredAt === null &&
                        (row.claimedAt === null || row.claimedAt < staleBefore),
                )
                .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
            return structuredClone(rows);
        },
    };

    /** Retirement announcements, kept as they were announced. */
    const versionRetirements = {
        async create(data) {
            const row = { id: nextId('retirement'), ...structuredClone(data) };
            state.versionRetirements.push(row);
            return structuredClone(row);
        },
        async list() {
            return structuredClone(
                [...state.versionRetirements].sort(
                    (a, b) => b.announcedAt - a.announcedAt || (a.id < b.id ? 1 : -1),
                ),
            );
        },
        async findById(id) {
            const row = state.versionRetirements.find((candidate) => candidate.id === id);
            return row ? structuredClone(row) : null;
        },
    };

    /** Add-on retirement announcements, kept as they were announced. */
    const bundleVersionRetirements = {
        async create(data) {
            const row = { id: nextId('bundle-retirement'), ...structuredClone(data) };
            state.bundleVersionRetirements.push(row);
            return structuredClone(row);
        },
        async list() {
            return structuredClone(
                [...state.bundleVersionRetirements].sort(
                    (a, b) => b.announcedAt - a.announcedAt || (a.id < b.id ? 1 : -1),
                ),
            );
        },
        async findById(id) {
            const row = state.bundleVersionRetirements.find((candidate) => candidate.id === id);
            return row ? structuredClone(row) : null;
        },
    };

    /** A subscription row as the usage read answers it: with its version, and what it scheduled. */
    function usageOf(row) {
        const planVersion = state.planVersions.find((version) => version.id === row.planVersionId);
        return {
            ...structuredClone(row),
            pendingPlan: row.pendingPlan ?? null,
            pendingBillingCycle: row.pendingBillingCycle ?? null,
            pendingEffectiveAt: row.pendingEffectiveAt ?? null,
            pendingChangeVersionId: row.pendingChangeVersionId ?? null,
            planVersion: planVersion
                ? {
                      id: planVersion.id,
                      planId: planVersion.planId,
                      version: planVersion.version,
                      publishedAt: planVersion.publishedAt,
                      supersededAt: planVersion.supersededAt,
                      changeNote: null,
                  }
                : null,
        };
    }

    /** The reads a retirement asks: one tenant's subscription, and those on one version, in every tenant. */
    const subscriptionUsage = {
        async findForTenant(tenantId) {
            const row = state.subscriptions.find((candidate) => candidate.tenantId === tenantId);
            return row ? usageOf(row) : null;
        },
        async listBoundToVersion(planVersionId) {
            if (!state.planVersions.some((row) => row.id === planVersionId)) return [];
            return state.subscriptions
                .filter((row) => row.planVersionId === planVersionId)
                .map((row) => ({ tenantId: row.tenantId, subscription: usageOf(row) }));
        },
        async listByIds(subscriptionIds) {
            return state.subscriptions
                .filter((row) => subscriptionIds.includes(row.id))
                .sort((a, b) => (a.id < b.id ? -1 : 1))
                .map((row) => ({ tenantId: row.tenantId, subscription: usageOf(row) }));
        },
    };

    /** The notice `id`, while the claim taken at `claimedAt` holds it and it is not delivered. */
    function heldNotice(id, claimedAt) {
        return state.subscriptionNotices.find(
            (row) =>
                row.id === id &&
                row.deliveredAt === null &&
                row.claimedAt !== null &&
                row.claimedAt.getTime() === claimedAt.getTime(),
        );
    }

    // Checkout offers. `consume` decides on the write whether the offer is still
    // open, as a conditional update does, so two callers cannot both consume it.
    const checkoutOfferRepository = {
        async list({ status } = {}) {
            return state.checkoutOffers
                .filter((row) => !status || row.status === status)
                .map((row) => structuredClone(row));
        },
        async findById(id) {
            const row = state.checkoutOffers.find((candidate) => candidate.id === id);
            return row ? structuredClone(row) : null;
        },
        async create(data) {
            const row = {
                id: nextId('offer'),
                planVersionId: null,
                promotionId: null,
                promoCode: null,
                bundles: [],
                bundleVersionIds: [],
                lineItems: [],
                promotionSnapshots: [],
                promoCodeSnapshot: null,
                locale: 'de',
                validUntil: null,
                ...structuredClone(data),
                status: 'open',
                consumedAt: null,
                createdAt: FIXED_NOW.toISOString(),
                updatedAt: FIXED_NOW.toISOString(),
            };
            state.checkoutOffers.push(row);
            return structuredClone(row);
        },
        async update(id, data) {
            const row = state.checkoutOffers.find((candidate) => candidate.id === id);
            if (!row || row.status !== 'open')
                throw new Error(`Checkout offer '${id}' is not open.`);
            Object.assign(row, structuredClone(data));
            return structuredClone(row);
        },
        async consume(id) {
            const row = state.checkoutOffers.find((candidate) => candidate.id === id);
            if (!row || row.status !== 'open') {
                throw new Error(`Checkout offer '${id}' has already been consumed.`);
            }
            Object.assign(row, { status: 'consumed', consumedAt: new Date().toISOString() });
            return structuredClone(row);
        },
    };

    // The subscriber's account. The natural key is checked the way the unique
    // index checks it, and a charge must name a contract line that exists, the
    // way the foreign key does.
    const subscriberLedgerRepository = {
        async recordCharges(charges) {
            const keyOf = (c) =>
                [
                    c.subscriptionId,
                    c.source,
                    c.sourceRef,
                    c.periodStart.toISOString(),
                    c.origin,
                ].join('|');
            for (const charge of charges) {
                if (!state.contractLines.some((line) => line.id === charge.contractLineItemId)) {
                    throw new Error(`contract line '${charge.contractLineItemId}' does not exist`);
                }
            }
            const written = [];
            for (const charge of charges) {
                const columns = subscriberChargeColumns(charge);
                if (state.ledgerEntries.some((entry) => keyOf(entry) === keyOf(charge))) continue;
                const row = { id: nextId('charge'), ...columns, createdAt: FIXED_NOW };
                state.ledgerEntries.push(row);
                written.push(toSubscriberChargeRecord(row));
            }
            return written;
        },
        async listBySubscription(subscriptionId) {
            return state.ledgerEntries
                .filter((entry) => entry.subscriptionId === subscriptionId)
                .sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime())
                .map(toSubscriberChargeRecord);
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
            paymentEventLog,
            subscriberPaymentMethodRepository,
            subscriberLedgerRepository,
            promoCodeRepository,
            promoCodeRedemptionRepository,
            promoCodeHoldRepository,
            audit,
            auditQuery,
            mfa,
            tenantSubscriptionWrite,
            promoSubscriptionLookup,
            subscriptionBundleRepository,
            planRepository,
            bundleRepository,
            subscriptionContractRepository,
            subscriberRepository,
            checkoutOfferRepository,
            appliedSettings,
            maintenanceWindows,
            subscriptionNotices,
            versionRetirements,
            bundleVersionRetirements,
            subscriptionUsage,
        },
        seed,
        async reset() {
            state = freshState();
        },
    };
}

/** `AuditQuery.actorTag`: a tag exactly, or a pattern with a star at either end, without case. */
function actorTagMatches(tag, pattern) {
    const leading = pattern.startsWith('*');
    const trailing = pattern.length > 1 && pattern.endsWith('*');
    if (!leading && !trailing) return tag === pattern;
    const literal = pattern.slice(leading ? 1 : 0, trailing ? -1 : undefined).toLowerCase();
    const value = tag.toLowerCase();
    if (leading && trailing) return value.includes(literal);
    return leading ? value.endsWith(literal) : value.startsWith(literal);
}
