// @requirement SC-SUB-020 — A newer version is offered, classified against the version bound

// A subscription keeps the version it is bound to; a version published since
// is an offer. What the service answers: the two versions side by side, the
// kind of offer judged against the version bound, and when a switch taken now
// would take effect — and nothing where the subscription could not take it.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import { Test } from '@nestjs/testing';

import {
    TenantAdminGuard,
    TenantBillingController,
    VersionOfferService,
} from '../dist/billing/index.js';
import { SaaSiCatModule } from '../dist/platform/index.js';
import { GUARDS, bootable } from './helpers/operator-routes.js';
import {
    BOUND,
    NOW,
    PERIOD_END,
    V2,
    repositoryWith,
    subscription,
    version,
} from './helpers/version-offers.js';

/** The service over one subscription, a bound row and a live row. */
function serviceFor({
    sub = subscription(),
    rows = [BOUND],
    live = V2({ quotas: { users: 5, vehicles: 150 } }),
    plans = undefined,
    blocked = null,
} = {}) {
    return new VersionOfferService(
        { findForTenant: async (tenantId) => (tenantId === 't1' ? sub : null) },
        plans ?? repositoryWith(rows, live),
        blocked,
    );
}

const offerOf = (options) => serviceFor(options).offerFor('t1', NOW);

describe('an offer', () => {
    test('shows both versions side by side, prices as numbers per rhythm', async () => {
        const offer = await offerOf();

        assert.equal(offer.plan, 'STANDARD');
        assert.deepEqual(offer.bound, {
            planVersionId: 'pv-1',
            version: 1,
            features: ['DASHBOARD', 'EXPORT'],
            quotas: { users: 5, vehicles: 100 },
            monthlyNet: 49,
            yearlyNet: 490,
        });
        assert.equal(offer.offered.planVersionId, 'pv-2');
        assert.deepEqual(offer.offered.quotas, { users: 5, vehicles: 150 });
        assert.deepEqual(
            offer.changes.map((change) => change.field),
            ['quotas.vehicles'],
        );
    });

    test('that improves takes effect at once', async () => {
        const offer = await offerOf();
        assert.equal(offer.class, 'improvement');
        assert.equal(offer.takesEffectAt, NOW.toISOString());
    });

    test('that costs more for more takes effect at once', async () => {
        const offer = await offerOf({
            live: V2({ monthlyNet: '59.00', quotas: { users: 8, vehicles: 200 } }),
        });
        assert.equal(offer.class, 'more-for-more');
        assert.equal(offer.takesEffectAt, NOW.toISOString());
    });

    test('that takes something away takes effect at the end of the running term', async () => {
        const offer = await offerOf({ live: V2({ features: ['DASHBOARD'], monthlyNet: '39.00' }) });
        assert.equal(offer.class, 'takes-something-away');
        assert.equal(offer.takesEffectAt, PERIOD_END.toISOString());
    });

    test('that takes something away waits for a minimum term that outlasts the period', async () => {
        const committed = new Date('2027-10-01T00:00:00.000Z');
        const offer = await offerOf({
            sub: subscription({ minimumTermUntil: committed }),
            live: V2({ quotas: { users: 4, vehicles: 100 } }),
        });
        assert.equal(offer.takesEffectAt, committed.toISOString());
    });

    test('that takes something away from a trial waits for its end', async () => {
        const trialEnd = new Date('2026-10-29T00:00:00.000Z');
        const offer = await offerOf({
            sub: subscription({ status: 'TRIAL', trialEndsAt: trialEnd }),
            live: V2({ quotas: { users: 4, vehicles: 100 } }),
        });
        assert.equal(offer.takesEffectAt, trialEnd.toISOString());
    });

    test('is made to a subscription whose cancellation has not landed yet', async () => {
        const offer = await offerOf({
            sub: subscription({ canceledAt: NOW, canceledEffectiveAt: PERIOD_END }),
        });
        assert.equal(offer.class, 'improvement');
    });
});

describe('the version offered is the one a booking made now would bind', () => {
    const V3 = version({ id: 'pv-3', version: 3, quotas: { users: 12, vehicles: 100 } });

    /** A repository that reads validity windows: V2 is on sale now, V3 is published for later. */
    function windowed(onSale) {
        const asked = [];
        return {
            asked,
            findVersionById: async (id) => [BOUND, V3].find((row) => row.id === id) ?? null,
            findLatestLivePlanVersion: async () => V3,
            findActivePlanVersion: async (planKey, asOf) => {
                asked.push([planKey, asOf]);
                return onSale;
            },
        };
    }

    test('by its validity window, not the newest published', async () => {
        const plans = windowed(V2({ quotas: { users: 5, vehicles: 150 } }));
        const offer = await offerOf({ plans });
        assert.equal(offer.offered.planVersionId, 'pv-2');
        assert.deepEqual(plans.asked, [['STANDARD', NOW]]);
    });

    test('and nothing where the window finds nothing on sale', async () => {
        assert.equal(await offerOf({ plans: windowed(null) }), null);
    });

    test('and nothing where the subscription is bound to a newer one than that', async () => {
        const sub = subscription({ planVersion: { id: 'pv-3', planId: 'STANDARD', version: 3 } });
        const plans = windowed(V2({ quotas: { users: 5, vehicles: 150 } }));
        assert.equal(await offerOf({ sub, plans }), null);
    });
});

describe('no offer', () => {
    test('while the subscription is on the newest version', async () => {
        assert.equal(await offerOf({ live: BOUND }), null);
    });

    test('where the newer version changes nothing compared', async () => {
        assert.equal(await offerOf({ live: V2() }), null);
    });

    test('for a version that does not take bookings yet', async () => {
        const live = V2({
            quotas: { users: 9, vehicles: 100 },
            validFrom: '2026-11-01T00:00:00.000Z',
        });
        assert.equal(await offerOf({ live }), null);
    });

    test('for a version that has ended', async () => {
        const live = V2({ quotas: { users: 9, vehicles: 100 }, endsAt: NOW.toISOString() });
        assert.equal(await offerOf({ live }), null);
    });

    test("for a version not sold in the subscription's rhythm", async () => {
        const live = V2({ quotas: { users: 9, vehicles: 100 }, monthlyNet: null });
        assert.equal(await offerOf({ live }), null);
    });

    test('for a version not marketed', async () => {
        const live = V2({ quotas: { users: 9, vehicles: 100 }, marketed: false });
        assert.equal(await offerOf({ live }), null);
    });

    // What the subscriber will have is not known until an outstanding decision
    // lands, and the offer is judged against that.
    test('while a change to another plan is scheduled', async () => {
        const sub = subscription({ pendingPlan: 'BASIC', pendingEffectiveAt: PERIOD_END });
        assert.equal(await offerOf({ sub }), null);
    });

    test('while a change of rhythm is scheduled', async () => {
        const sub = subscription({
            pendingPlan: 'STANDARD',
            pendingBillingCycle: 'YEARLY',
            pendingEffectiveAt: PERIOD_END,
        });
        assert.equal(await offerOf({ sub }), null);
    });

    test('while a pending version has yet to land', async () => {
        const sub = subscription({
            pendingPlanVersion: { id: 'pv-2', planId: 'STANDARD', version: 2 },
            pendingPlanVersionEffectiveAt: PERIOD_END,
        });
        assert.equal(await offerOf({ sub }), null);
    });

    test('once the cancellation has landed', async () => {
        const ended = new Date('2026-10-01T00:00:00.000Z');
        const sub = subscription({
            status: 'CANCELED',
            canceledAt: ended,
            canceledEffectiveAt: ended,
        });
        assert.equal(await offerOf({ sub }), null);
    });

    test('on a plan kept for a special contract, either way round', async () => {
        const locked = { asSource: ['STANDARD'], asTarget: [] };
        const unsold = { asSource: [], asTarget: ['STANDARD'] };
        assert.equal(await offerOf({ blocked: locked }), null);
        assert.equal(await offerOf({ blocked: unsold }), null);
    });

    test('where the version bound cannot be read as a version of the plan', async () => {
        assert.equal(await offerOf({ rows: [] }), null);
        assert.equal(await offerOf({ rows: [version({ planId: 'OTHER' })] }), null);
    });

    test('where the newest version read is of another plan', async () => {
        const live = V2({ planId: 'OTHER', quotas: { users: 9, vehicles: 100 } });
        const plans = {
            findVersionById: async () => BOUND,
            findLatestLivePlanVersion: async () => live,
        };
        assert.equal(await offerOf({ plans }), null);
    });

    test('without a repository that reads versions', async () => {
        const service = new VersionOfferService(
            { findForTenant: async () => subscription() },
            null,
            null,
        );
        assert.equal(await service.offerFor('t1', NOW), null);
    });

    test('where the subscription is bound to no version', async () => {
        assert.equal(await offerOf({ sub: subscription({ planVersion: null }) }), null);
    });
});

test('a tenant without a subscription is told so', async () => {
    await assert.rejects(
        () => serviceFor().offerFor('t-unknown', NOW),
        (error) => error.response?.code === 'SUBSCRIPTION_NOT_FOUND',
    );
});

describe('GET billing/version-offer', () => {
    /** The controller as `SaaSiCatModule.forRoot` composes it, over one subscription of tenant t1. */
    async function mountedController() {
        const options = bootable();
        const { catalog } = options.persistence;
        // The reads the offer makes; every other method is the fixture's,
        // which the catalogue's services check for when they are constructed.
        const onSale = V2({ quotas: { users: 9, vehicles: 100 } });
        const reads = {
            ...repositoryWith([BOUND], onSale),
            findActivePlanVersion: async () => onSale,
        };
        const planRepository = new Proxy(reads, {
            get: (target, key) => (key in target ? target[key] : catalog.planRepository[key]),
        });
        const persistence = { ...options.persistence, catalog: { ...catalog, planRepository } };
        const tenantBilling = {
            ...options.tenantBilling,
            subscriptionUsagePort: {
                findForTenant: async (tenantId) => (tenantId === 't1' ? subscription() : null),
            },
        };
        const moduleRef = await Test.createTestingModule({
            imports: [SaaSiCatModule.forRoot({ ...options, persistence, tenantBilling })],
        }).compile();
        return moduleRef.get(TenantBillingController, { strict: false });
    }

    test("reads the offer of the caller's own tenant, whatever the request names", async () => {
        const controller = await mountedController();
        const { offer } = await controller.getVersionOffer({
            user: { tenantId: 't1' },
            query: { tenantId: 't2' },
            params: { tenantId: 't2' },
            headers: { 'x-tenant-id': 't2' },
        });
        assert.equal(offer.offered.planVersionId, 'pv-2');
        assert.equal(offer.class, 'improvement');
    });

    test('refuses a request that carries no tenant', async () => {
        const controller = await mountedController();
        await assert.rejects(
            () => controller.getVersionOffer({ query: { tenantId: 't1' } }),
            (error) => error.response?.code === 'TENANT_CONTEXT_MISSING',
        );
    });

    test('is open to every user of the tenant, not only its administrator', () => {
        const handler = TenantBillingController.prototype.getVersionOffer;
        const guards = Reflect.getMetadata(GUARDS, handler) ?? [];
        assert.ok(!guards.includes(TenantAdminGuard));
    });
});
