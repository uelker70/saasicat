// A subscriber's account in memory: the subscription, its contracts, its
// bookings and the journal, behind the ports `SubscriberChargeService` reads.
//
// The journal fake holds the natural key the way the unique index does, so a
// test that derives a charge twice sees what an adapter would do with it.

import { SubscriberAccountService, SubscriberChargeService } from '../../dist/billing/index.js';
import { FakeSubscriptionContractRepository } from '../../dist/testing/index.js';

export const PARTIES = {
    subscriberId: 'subscriber-1',
    subscriber: {
        customerNumber: '10001',
        legalName: 'Tenant One GmbH',
        vatId: null,
        taxNumber: null,
        addressLine1: null,
        addressLine2: null,
        postalCode: null,
        city: null,
        country: null,
    },
    issuer: null,
};

export const utc = (iso) => new Date(`${iso}T00:00:00.000Z`);

/** The add-on the account books: 10 a month. */
export const ARCHIVE = () => line('bundle', 'ARCHIVE', 10, { sourceVersionId: 'bv-archive' });

/** A contract line as the freeze or an offer writes it. */
export function line(kind, sourceKey, priceNet, overrides = {}) {
    return {
        kind,
        sourceKey,
        sourceVersionId: null,
        titleSnapshot: sourceKey,
        descriptionSnapshot: null,
        quantity: 1,
        unit: null,
        priceNet,
        priceGross: Math.round(priceNet * 119) / 100,
        billingCycle: 'monthly',
        currency: 'EUR',
        taxRate: 19,
        taxAmount: Math.round(priceNet * 19) / 100,
        minimumTermUntil: null,
        featuresSnapshot: [],
        quotaEffectsSnapshot: {},
        metadata: null,
        ...overrides,
    };
}

/** The discount line an offer concludes with, carrying what it was built from. */
export function discountLine(discountNet, { promoCode = null, promotions = [] } = {}) {
    return line(
        'discount',
        promoCode?.code ?? promotions[0]?.id ?? 'price-discount',
        -discountNet,
        {
            metadata: {
                generated: true,
                source: promoCode ? 'promo_code' : 'promotion',
                discountNet,
                promotionSnapshots: promotions,
                promoCodeSnapshot: promoCode,
            },
        },
    );
}

function journal() {
    const rows = [];
    const keyOf = (c) =>
        [c.subscriptionId, c.source, c.sourceRef, c.periodStart.toISOString(), c.origin].join('|');
    return {
        rows,
        async recordCharges(charges) {
            const written = [];
            for (const charge of charges) {
                if (rows.some((row) => keyOf(row) === keyOf(charge))) continue;
                const row = { ...charge, id: `charge-${rows.length + 1}`, createdAt: new Date() };
                rows.push(row);
                written.push(row);
            }
            return written;
        },
        async listBySubscription(subscriptionId) {
            return rows
                .filter((row) => row.subscriptionId === subscriptionId)
                .sort((a, b) => a.periodStart - b.periodStart);
        },
    };
}

/**
 * A monthly subscription and the account behind it. `subscription` is changed
 * in place by a test to roll its window forward, the way a renewal job would.
 */
export function anAccount({
    subscription: overrides = {},
    subscriber = { id: 'subscriber-1' },
    freeze = null,
    reductions = null,
} = {}) {
    const subscription = {
        id: 'sub-1',
        plan: 'STANDARD',
        planVersion: { id: 'pv-standard', planId: 'STANDARD' },
        billingCycle: 'MONTHLY',
        status: 'ACTIVE',
        isPilot: false,
        pilotEndsAt: null,
        trialEndsAt: null,
        startedAt: utc('2026-01-01'),
        currentPeriodStart: utc('2026-01-01'),
        currentPeriodEnd: utc('2026-02-01'),
        minimumTermUntil: null,
        canceledAt: null,
        canceledEffectiveAt: null,
        billingAnchorDay: 1,
        ...overrides,
    };
    const contracts = new FakeSubscriptionContractRepository();
    const bookings = [];
    const ledger = journal();
    // The retirement notices the subscription was told, as the record keeps them.
    const told = [];
    // The feature withdrawals on record.
    const withdrawals = [];
    const subscribers = { findByTenantId: async () => subscriber };
    const subscriptions = { findForTenant: async () => subscription };
    const service = new SubscriberChargeService(
        ledger,
        contracts,
        subscribers,
        subscriptions,
        { listBySubscription: async () => bookings },
        freeze,
        { listForSubscription: async () => told },
        { list: async () => withdrawals },
        null,
        reductions,
    );
    const reader = new SubscriberAccountService(ledger, contracts, subscribers, subscriptions);
    return {
        subscription,
        bookings,
        ledger,
        service,
        /** Writes a contract for the tenant, with the lines given. */
        async contract({
            effectiveFrom = utc('2026-01-01'),
            lineItems,
            offer = null,
            until = null,
        }) {
            const created = await contracts.create({
                tenantId: 't1',
                parties: PARTIES,
                effectiveFrom,
                effectiveUntil: until,
                originalOfferId: offer,
                priceSnapshot: {
                    currency: 'EUR',
                    billingCycle: 'monthly',
                    subtotalNet: 0,
                    discountNet: 0,
                    totalNet: 0,
                    vatRate: 19,
                    totalGross: 0,
                },
                lineItems,
            });
            return created;
        },
        /** Supersedes the contract in force at `at`, the way a freeze does. */
        async supersede(at) {
            const running = await contracts.findActiveByTenantId('t1', at);
            if (running) {
                await contracts.terminate(running.id, {
                    tenantId: running.tenantId,
                    effectiveUntil: at,
                    status: 'superseded',
                });
            }
        },
        /** The account as the operator reads it. */
        read() {
            return reader.accountOf('t1');
        },
        /** Brings the account up to date at `now`, as the application's call does. */
        charge(now) {
            return service.recordDueCharges('t1', now);
        },
        /**
         * Records that the subscription was told its version is retired, taking
         * effect on `effectiveAt` — what the announcement writes, delivered to an
         * administrator. With `{ delivered: false }` it is recorded and has
         * reached nobody.
         */
        toldOfRetirement(planVersionId, effectiveAt, { delivered = true } = {}) {
            told.push({
                kind: 'version-retired',
                subscriptionId: subscription.id,
                delivery: delivered
                    ? { recipients: ['admin@example.com'], channel: 'email' }
                    : null,
                content: {
                    retirementId: 'ret-1',
                    retired: { planVersionId },
                    effectiveAt: effectiveAt.toISOString(),
                },
            });
        },
        /**
         * Records that the booking `subscriptionBundleId` was told its add-on
         * version `retired` is retired onto `replacement`, taking effect on
         * `effectiveAt`; with `{ delivered: false }` it has reached nobody.
         */
        toldOfAddOnRetirement(
            subscriptionBundleId,
            { retired, replacement, effectiveAt },
            { delivered = true } = {},
        ) {
            told.push({
                kind: 'bundle-version-retired',
                subscriptionId: subscription.id,
                delivery: delivered
                    ? { recipients: ['admin@example.com'], channel: 'email' }
                    : null,
                content: {
                    retirementId: 'bret-1',
                    subscriptionBundleId,
                    retired: { bundleVersionId: retired },
                    replacement: { bundleVersionId: replacement },
                    effectiveAt: effectiveAt.toISOString(),
                },
            });
        },
        /**
         * Records a feature withdrawal and that the subscription was told of it,
         * as the announcement writes both. The withdrawal is kept as given, so a
         * test lifts it by setting `liftedFrom` on it.
         */
        toldOfWithdrawal(withdrawal) {
            withdrawals.push(withdrawal);
            told.push({
                kind: 'feature-withdrawn',
                subject: withdrawal.id,
                subscriptionId: subscription.id,
                delivery: null,
                content: { withdrawalId: withdrawal.id },
            });
            return withdrawal;
        },
        /**
         * Ends the subscription — or, with a booking's id, that booking — at
         * once at `at`, as ending at once under a withdrawal records it.
         */
        endAtOnce(at, subscriptionBundleId = null) {
            if (subscriptionBundleId === null) {
                subscription.canceledAt = at;
                subscription.canceledEffectiveAt = at;
                subscription.status = 'CANCELED';
            } else {
                const booking = bookings.find((one) => one.id === subscriptionBundleId);
                booking.canceledAt = at;
                booking.canceledEffectiveAt = at;
            }
            told.push({
                kind: 'ended-at-once',
                subject: subscriptionBundleId ?? subscription.id,
                subscriptionId: subscription.id,
                delivery: null,
                content: {
                    withdrawalId: 'fw-1',
                    subscriptionBundleId,
                    endedAt: at.toISOString(),
                },
            });
        },
        /** Moves the plan's window, as a renewal job does. */
        roll(start, end) {
            subscription.currentPeriodStart = start;
            subscription.currentPeriodEnd = end;
        },
        /** Books an add-on, by default on 21 January for the rest of the month. */
        book(overrides = {}) {
            const booking = {
                id: `booking-${bookings.length + 1}`,
                subscriptionId: 'sub-1',
                bundleVersionId: 'bv-archive',
                startedAt: utc('2026-01-21'),
                minimumTermEndsAt: null,
                billingCycle: 'MONTHLY',
                currentPeriodStart: utc('2026-01-21'),
                currentPeriodEnd: utc('2026-02-01'),
                canceledAt: null,
                canceledEffectiveAt: null,
                createdAt: utc('2026-01-21'),
                updatedAt: utc('2026-01-21'),
                ...overrides,
            };
            bookings.push(booking);
            return booking;
        },
        /** The journal as `[period start, source, origin, amount]`, oldest first. */
        /** The discount entries, each with the reference that says whose reduction it is. */
        discounts() {
            return [...ledger.rows]
                .filter((row) => row.source === 'discount')
                .sort(
                    (a, b) =>
                        a.periodStart - b.periodStart ||
                        a.sourceRef.localeCompare(b.sourceRef) ||
                        a.origin.localeCompare(b.origin),
                )
                .map((row) => [
                    row.periodStart.toISOString().slice(0, 10),
                    row.sourceRef,
                    row.origin,
                    row.amountNet,
                ]);
        },
        entries() {
            return [...ledger.rows]
                .sort((a, b) => a.periodStart - b.periodStart || a.source.localeCompare(b.source))
                .map((row) => [
                    row.periodStart.toISOString().slice(0, 10),
                    row.source,
                    row.origin,
                    row.amountNet,
                ]);
        },
    };
}
