// A tenant whose subscription ended, and the service it comes back through
// before its deletion day (`SC-CANC-034`), over the in-memory ports of a
// deletion (`./tenant-deletion.js`): one database, so a return and a deletion
// run lock and write the same rows. The contract is composed, checked and
// written by the platform's own services over the in-memory contract store;
// only what the application owns is stood in for — its subscription row, its
// subscriber and its payment method.

import {
    SubscriptionContractFreezeService,
    SubscriptionEndService,
    SubscriptionReturnService,
    givenPlanCatalogSource,
} from '../../dist/billing/index.js';
import { EntitlementService } from '../../dist/entitlement/index.js';
import { SubscriptionContractService } from '../../dist/subscription-contract/index.js';
import {
    FakeSubscriptionBundleRepository,
    FakeSubscriptionContractRepository,
    FakeTransactionRunner,
} from '../../dist/testing/index.js';
import { partiesNamed } from './contract-parties.js';
import { THIS_INSTALLATION } from './installation-mark.js';
import { boundPlanVersion } from './subscription-fixtures.js';
import {
    ENDED_AT,
    TransactionalHolds,
    ZONE,
    aDatabase,
    endedAt,
    setUp,
} from './tenant-deletion.js';

export const TENANT = 'tenant-1';
export const SUBSCRIPTION = `subscription-${TENANT}`;
/** Midnight into 1 October in Berlin: the subscription's last day was 30 September. */
export const ENDED = new Date('2026-09-30T22:00:00.000Z');
export const DELETES_ON = '2026-10-30';
/** The morning of 20 October, ten days before the deletion day. */
export const RETURN_AT = new Date('2026-10-20T08:00:00.000Z');
/** The last moment of 29 October in Berlin, the day before the deletion day. */
export const LAST_MOMENT = new Date('2026-10-29T22:59:59.999Z');
/** Midnight into 30 October in Berlin: the deletion day has come. */
export const DELETION_DAY = new Date('2026-10-29T23:00:00.000Z');

/** The tenant's administrator, as the tenant's billing area names who acts. */
export const ADMIN = {
    userId: 'user-weber',
    email: 'anna@fahrschule-weber.example',
    source: 'web',
    context: 'tenant-billing',
};
export const ADMIN_TAG = 'web:anna@fahrschule-weber.example:tenant-billing';

const STARTER = {
    id: 'STARTER',
    name: 'Starter',
    tagline: '',
    marketed: true,
    monthlyNet: 19,
    yearlyNet: 190,
    quotas: { users: 3 },
    features: ['CORE'],
};
const STANDARD = {
    id: 'STANDARD',
    name: 'Standard',
    tagline: '',
    marketed: true,
    monthlyNet: 59,
    yearlyNet: 590,
    quotas: { users: 8 },
    features: ['CORE', 'REPORTS'],
};
const ENTERPRISE = {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    tagline: '',
    marketed: true,
    monthlyNet: 199,
    yearlyNet: 1990,
    quotas: { users: 100 },
    features: ['CORE', 'REPORTS', 'API'],
};
export const CATALOG = {
    schemaVersion: 1,
    app: { name: 'Drive School' },
    currency: 'EUR',
    vatRate: 19,
    plans: [STARTER, STANDARD, ENTERPRISE],
};

/** The version the subscription that ended was bound to: what it paid until then. */
export const V2 = boundPlanVersion(
    { ...STANDARD, monthlyNet: 49, yearlyNet: 490, quotas: { users: 5 }, features: ['CORE'] },
    'pv-standard-2',
);
/** The version on sale now, which a return buys. */
export const V3 = boundPlanVersion(STANDARD, 'pv-standard-3');
const VERSIONS = [
    V2,
    V3,
    boundPlanVersion(STARTER, 'pv-starter-1'),
    boundPlanVersion(ENTERPRISE, 'pv-enterprise-1'),
];
const ON_SALE = { STARTER: 'pv-starter-1', STANDARD: V3.id, ENTERPRISE: 'pv-enterprise-1' };
const versionById = (id) => VERSIONS.find((version) => version.id === id) ?? null;

/** What the operator sells only by a contract of its own. */
export const BLOCKED = { asTarget: ['ENTERPRISE'] };

/** A pilot is granted this plan, whatever its subscription names. */
const PILOTS_ARE_GRANTED = 'ENTERPRISE';

/** The add-on the subscription that ended had booked. */
const ARCHIVE = { bundleKey: 'ARCHIVE', label: 'Archive', features: ['ARCHIVE'], quotas: {} };

/**
 * The tenant's one subscription row, as the application keeps it: read by
 * each port in the shape it wants, and started again as both adapters do —
 * only while the cancellation read still stands, and taken back with the
 * transaction it was written in.
 */
export class SubscriptionRow {
    bindsPlanVersion = true;

    constructor(overrides = {}) {
        this.row = {
            id: SUBSCRIPTION,
            tenantId: TENANT,
            plan: 'STANDARD',
            billingCycle: 'MONTHLY',
            status: 'ACTIVE',
            isPilot: false,
            pilotEndsAt: null,
            trialEndsAt: null,
            startedAt: new Date('2025-10-01T08:00:00.000Z'),
            currentPeriodStart: new Date('2026-08-31T22:00:00.000Z'),
            currentPeriodEnd: ENDED,
            billingAnchorDay: 1,
            minimumTermUntil: null,
            canceledAt: new Date('2026-08-20T09:00:00.000Z'),
            canceledEffectiveAt: ENDED,
            pendingPlan: null,
            pendingBillingCycle: null,
            pendingEffectiveAt: null,
            planVersionId: V2.id,
            ...overrides,
        };
    }

    // ── the application's subscriptions, as the tenant routes read them ──

    async findForTenant(tenantId) {
        if (tenantId !== this.row.tenantId) return null;
        return { ...this.row, planVersion: versionById(this.row.planVersionId) };
    }

    async listCancelled() {
        const { id, tenantId, canceledAt, canceledEffectiveAt } = this.row;
        if (canceledAt === null && canceledEffectiveAt === null) return [];
        return [{ subscriptionId: id, tenantId, canceledAt, canceledEffectiveAt }];
    }

    // ── as the write starts it again ──

    async startAgain(tenantId, input, tx) {
        const row = this.row;
        if (
            tenantId !== row.tenantId ||
            row.canceledEffectiveAt?.getTime() !== input.expectedCanceledEffectiveAt.getTime()
        ) {
            return { claimed: false };
        }
        const before = { ...row };
        tx?.undo.push(() => Object.assign(row, before));
        Object.assign(row, {
            plan: input.planId,
            billingCycle: input.cycle,
            status: 'ACTIVE',
            currentPeriodStart: input.periodStart,
            currentPeriodEnd: input.periodEnd,
            canceledAt: null,
            canceledEffectiveAt: null,
            pendingPlan: null,
            pendingBillingCycle: null,
            pendingEffectiveAt: null,
            isPilot: false,
            planVersionId: input.planVersionId,
        });
        return { claimed: true };
    }

    // ── as the entitlements read it ──

    async findByTenantId(tenantId) {
        if (tenantId !== this.row.tenantId) return null;
        const version = versionById(this.row.planVersionId);
        return {
            id: this.row.id,
            tenantId,
            plan: this.row.plan,
            status: this.row.status,
            isPilot: this.row.isPilot,
            trialEntitlementPlan: null,
            pendingPlan: this.row.pendingPlan,
            pendingEffectiveAt: this.row.pendingEffectiveAt,
            customLimits: null,
            planVersionId: version.id,
            planVersion: {
                planId: version.planId,
                quotas: version.quotas,
                features: version.features,
            },
            canceledAt: this.row.canceledAt,
            canceledEffectiveAt: this.row.canceledEffectiveAt,
        };
    }

    async findByTenantIdLocked(tenantId) {
        return this.findByTenantId(tenantId);
    }
}

/** Contracts that a failed transaction takes back where they were written in it; `failNext` fails one write. */
class TransactionalContracts extends FakeSubscriptionContractRepository {
    failNext = false;

    async create(data, tx) {
        if (this.failNext) {
            this.failNext = false;
            throw new Error('connection reset');
        }
        const created = await super.create(data);
        tx?.undo.push(() => this.byId.delete(created.id));
        return created;
    }
}

/**
 * Reasons whose `lockOpen` holds the reason until the transaction that took it
 * ends, as `FOR UPDATE` does: a second transaction asking for it waits, and
 * `waiting` counts the ones that do.
 */
class LockingHolds extends TransactionalHolds {
    locks = new Map();
    waiting = 0;

    async lockOpen(id, tx) {
        const before = this.locks.get(id) ?? Promise.resolve();
        let release;
        const mine = new Promise((resolve) => {
            release = resolve;
        });
        this.locks.set(
            id,
            before.then(() => mine),
        );
        tx.release.push(release);
        this.waiting += 1;
        await before;
        this.waiting -= 1;
        return super.lockOpen(id, tx);
    }
}

/** The subscriber every contract is concluded with; `missing` makes it a tenant without one. */
function aSubscriber(state) {
    const requireForTenant = async (tenantId) => {
        if (state.subscriberMissing) {
            throw Object.assign(new Error(`Tenant '${tenantId}' has no subscriber.`), {
                response: { code: 'SUBSCRIBER_REQUIRED' },
            });
        }
        return { id: 'subscriber-t1' };
    };
    return {
        requireForTenant,
        async contractPartyFor(tenantId) {
            await requireForTenant(tenantId);
            return { parties: partiesNamed('Fahrschule Weber'), origin: null };
        },
        issuerNamed() {},
    };
}

/**
 * The tenant `TENANT`, its subscription ended at `ENDED` with `DELETES_ON` as
 * its deletion day, the run that deletes tenants, and the service it comes
 * back through — over one database. `row` changes the subscription row,
 * `gateway` makes the installation take payment methods through a gateway,
 * `paymentMethod` is the subscriber's one in use there.
 */
export async function aTenantThatEnded({
    row = {},
    gateway = false,
    paymentMethod = null,
    ended = true,
} = {}) {
    const ports = aDatabase();
    ports.holds = new LockingHolds();
    ports.contracts = new TransactionalContracts();
    await ports.marks.markIfUnmarked({
        identifier: THIS_INSTALLATION,
        markedAt: ENDED_AT,
        markedBy: 'cli:ops',
    });
    const run = await setUp({ shared: ports });
    const subscription = new SubscriptionRow(row);
    const bookings = new FakeSubscriptionBundleRepository();
    const state = { subscriberMissing: false };
    const calls = { invalidated: [], audited: [], charged: [] };

    const catalogs = givenPlanCatalogSource(CATALOG);
    const plans = {
        findVersionById: async (id) => versionById(id),
        findActivePlanVersion: async (planKey) => versionById(ON_SALE[planKey]),
    };
    const entitlements = new EntitlementService(
        catalogs,
        subscription,
        {
            findActive: async (planId) => {
                const version = versionById(ON_SALE[planId]);
                return { planId, quotas: version.quotas, features: version.features };
            },
        },
        new FakeTransactionRunner(),
        { pilotEntitlementPlan: PILOTS_ARE_GRANTED },
        bookings,
        { findVersionById: async () => ARCHIVE },
        ports.contracts,
    );
    const invalidate = entitlements.invalidateTenant.bind(entitlements);
    entitlements.invalidateTenant = (tenantId) => {
        calls.invalidated.push(tenantId);
        invalidate(tenantId);
    };
    const contracts = new SubscriptionContractService(ports.contracts, aSubscriber(state));
    const freeze = new SubscriptionContractFreezeService(
        catalogs,
        entitlements,
        contracts,
        {
            findBoundPlanVersion: async () => versionById(subscription.row.planVersionId),
            loadBookedBundles: async () => {
                const running = await bookings.listActiveBySubscription(SUBSCRIPTION, RETURN_AT);
                return {
                    lineItems: running.map((booking) => ({
                        kind: 'bundle',
                        sourceKey: ARCHIVE.bundleKey,
                        sourceVersionId: booking.bundleVersionId,
                        titleSnapshot: ARCHIVE.label,
                        descriptionSnapshot: null,
                        quantity: 1,
                        unit: null,
                        priceNet: 10,
                        billingCycle: 'monthly',
                        minimumTermUntil: null,
                        featuresSnapshot: ARCHIVE.features,
                        quotaEffectsSnapshot: {},
                        metadata: null,
                    })),
                    bundleVersionIds: running.map((booking) => booking.bundleVersionId),
                };
            },
        },
        subscription,
        subscription,
        null,
        null,
        plans,
    );
    const payments = {
        methods: { current: async () => paymentMethod },
        gateways: { forNewPaymentMethods: () => (gateway ? { name: 'stripe' } : null) },
    };
    const service = new SubscriptionReturnService(
        subscription,
        subscription,
        ports.ends,
        ports.transactions,
        catalogs,
        {
            ...ZONE,
            tenantBilling: { cancellationNoticeDays: { monthly: 30, yearly: 90 } },
        },
        entitlements,
        ports.holds,
        plans,
        BLOCKED,
        freeze,
        contracts,
        bookings,
        payments.methods,
        payments.gateways,
        { recordDueCharges: async (tenantId) => calls.charged.push(tenantId) },
        { log: async (entry) => calls.audited.push(entry) },
    );
    const subscriptionEnds = new SubscriptionEndService(
        subscription,
        ports.ends,
        { readOnlyDays: 30, reminderDaysBefore: [10, 3] },
        ZONE,
        null,
        ports.holds,
    );
    subscriptionEnds.onModuleInit();
    if (ended) {
        await endedAt(run, TENANT, {
            subscriptionId: SUBSCRIPTION,
            endsAt: ENDED,
            deletesOn: DELETES_ON,
        });
    }
    return {
        ...run,
        run,
        subscription,
        bookings,
        entitlements,
        freeze,
        state,
        calls,
        service,
        subscriptionEnds,
    };
}

/** The tenant's reasons, as kept. */
export const reasonsOf = (tenant) => tenant.holds.holds.filter((hold) => hold.tenantId === TENANT);

/** The tenant's ends, as kept. */
export const endsOf = (tenant) => tenant.ends.ends.filter((end) => end.tenantId === TENANT);

/** The tenant's contracts, as kept. */
export const contractsOf = (tenant) => tenant.contracts.list({ tenantId: TENANT });

/**
 * A point a test holds a call at: `pass` is awaited by the call, `arrived`
 * resolves once it is there, and `open` lets it go on.
 */
export function aBarrier() {
    let open;
    const opened = new Promise((resolve) => {
        open = resolve;
    });
    let arrive;
    const arrived = new Promise((resolve) => {
        arrive = resolve;
    });
    return {
        open,
        arrived,
        async pass() {
            arrive();
            await opened;
        },
    };
}

/**
 * Resolves once `call` waits for a lock of `holds`, or has come to an end
 * without waiting for one; rejects after a thousand turns of neither, so that
 * a race that never meets fails rather than hangs.
 */
export async function untilItWaitsOrEnds(holds, call) {
    let ended = false;
    const end = () => {
        ended = true;
    };
    call.then(end, end);
    for (let turn = 0; turn < 1000; turn++) {
        if (holds.waiting > 0 || ended) return;
        await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error('The call neither waited for the lock nor came to an end.');
}
