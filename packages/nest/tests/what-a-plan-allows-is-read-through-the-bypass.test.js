// What a tenant's plan allows reads the same whatever row-level frame its
// caller runs in.
//
// `@RequireFeature` is decided in a guard — `StaticFeatureGuard`, which reads
// the plan through `SubscriptionPlanResolver`, or `FeatureGuard`, which asks
// `EntitlementService` — and `@EnforceQuota` in an interceptor that may run
// before the application's own. Both can ask before the application's
// interceptor opens the tenant's frame, where a policy on the platform's tables
// does not see the request's tenant. The stores here answer as such a policy
// does (`helpers/row-level-policy.js`); the application's quota count is its
// own and counts by the tenant id it is handed.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { lastValueFrom, of } from 'rxjs';

import { FeatureGuard, RequireFeature, givenPlanCatalogSource } from '../dist/billing/index.js';
import { EnforceQuota } from '../dist/discovery/index.js';
import { EntitlementService } from '../dist/entitlement/index.js';
import {
    EnforceQuotaInterceptor,
    SaaSiCatModule,
    StaticEntitlementService,
    StaticFeatureGuard,
    SubscriptionPlanResolver,
} from '../dist/platform/index.js';
import { PLAN_RESOLVER_PORT_TOKEN } from '../dist/testing/index.js';
import { bootable, everythingOnOptions } from './helpers/operator-routes.js';
import {
    BYPASS,
    FRAMES,
    frame,
    inEveryFrame,
    outcomes,
    visibleTo,
} from './helpers/row-level-policy.js';
import { subscriptionRecord } from './helpers/subscription-fixtures.js';

const plan = (id, features, notes) => ({
    id,
    name: id,
    tagline: '',
    marketed: true,
    monthlyNet: 10,
    yearlyNet: 100,
    quotas: { notes },
    features,
});
const PRO = plan('PRO', ['NOTES'], 3);
const BASIC = plan('BASIC', [], 1);
const CATALOG = {
    schemaVersion: 1,
    app: { name: 'Probe' },
    currency: 'EUR',
    vatRate: 19,
    plans: [PRO, BASIC],
};

/** A tenant's subscription to `on`, as the entitlement path reads it. */
const subscribed = (tenantId, on) =>
    subscriptionRecord({
        id: `sub-${tenantId}`,
        tenantId,
        plan: on.id,
        planVersionId: `pv-${on.id}`,
        planVersion: { planId: on.id, quotas: on.quotas, features: on.features },
    });

const SUBSCRIPTIONS = [
    subscribed('t-with', PRO),
    subscribed('t-without', BASIC),
    subscribed('t-full', PRO),
    subscribed('t-contract', BASIC),
];

/** The contract in force of the one tenant that has one: it grants what its plan does not. */
const CONTRACTS = {
    't-contract': {
        entitlementSnapshot: { plan: 'BASIC', quotas: { notes: 1 }, features: ['NOTES'] },
        lineItems: [],
        originalBundleVersionIds: [],
    },
};

/** How many notes each tenant has, as the application counts them by the tenant id it is handed. */
const NOTES_HELD = { 't-with': 1, 't-full': 3 };

/** The subscriptions as the policy shows them, and the frame each read ran in. */
function subscriptionsBehindThePolicy() {
    const port = {
        readIn: [],
        async findByTenantId(tenantId) {
            port.readIn.push(frame.getStore());
            const found = SUBSCRIPTIONS.find((subscription) => subscription.tenantId === tenantId);
            return found && visibleTo(tenantId) ? found : null;
        },
    };
    return port;
}

/** The contracts in force as the policy shows them. */
const contractsBehindThePolicy = {
    findActiveByTenantId: async (tenantId) =>
        visibleTo(tenantId) ? (CONTRACTS[tenantId] ?? null) : null,
};

/** The default stack's entitlements over `subscriptions`, the plan read through `bypass`. */
const staticEntitlements = (subscriptions, bypass = BYPASS) =>
    new StaticEntitlementService(
        givenPlanCatalogSource(CATALOG),
        new SubscriptionPlanResolver(subscriptions, undefined, null, bypass),
    );

/** A fresh entitlement service — an empty cache — over `subscriptions` and the contracts. */
const fullEntitlements = (subscriptions, bypass = BYPASS) =>
    new EntitlementService(
        givenPlanCatalogSource(CATALOG),
        subscriptions,
        {
            findActive: async (planId) => {
                const found = CATALOG.plans.find((candidate) => candidate.id === planId);
                return found ? { planId, quotas: found.quotas, features: found.features } : null;
            },
        },
        { run: async (work) => work(undefined) },
        null,
        null,
        null,
        contractsBehindThePolicy,
        null,
        null,
        null,
        bypass,
    );

/** An execution context for a request of `tenantId` to a route carrying `decorators`. */
function routeOf(tenantId, ...decorators) {
    class Notes {
        create() {}
    }
    const descriptor = Object.getOwnPropertyDescriptor(Notes.prototype, 'create');
    Reflect.decorate(decorators, Notes.prototype, 'create', descriptor);
    const request = { user: { id: 'u-1', tenantId }, headers: {} };
    return {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => Notes.prototype.create,
        getClass: () => Notes,
    };
}

/** Runs `interceptor` for the route and answers nothing where the handler was reached. */
async function intercepted(interceptor, context) {
    await lastValueFrom(interceptor.intercept(context, { handle: () => of('created') }));
}

const quotaProvider = { key: 'notes', count: async (tenantId) => NOTES_HELD[tenantId] ?? 0 };

// @requirement SC-SEC-020 — What crosses the tenant policy is named; a tenant's reach only its subscriber and itself
describe("what a tenant's plan allows is read through the bypass, whatever frame the caller is in", () => {
    // @requirement SC-ENTL-005 — A request for something the contract does not include is refused
    test('StaticFeatureGuard lets a tenant whose plan has the feature through and refuses one whose plan has not', async () => {
        const guard = new StaticFeatureGuard(
            new Reflector(),
            staticEntitlements(subscriptionsBehindThePolicy()),
        );
        assert.deepEqual(
            await outcomes(
                { 'with the feature': 't-with', 'without it': 't-without' },
                (tenantId) =>
                    guard
                        .canActivate(routeOf(tenantId, RequireFeature('NOTES')))
                        .then(() => undefined),
            ),
            inEveryFrame({ 'with the feature': 'passed', 'without it': 'FEATURE_NOT_LICENSED' }),
        );
    });

    // @requirement SC-ENTL-005 — A request for something the contract does not include is refused
    test('FeatureGuard, from a cold cache, lets a tenant through whose plan or contract has the feature and refuses one without it', async () => {
        assert.deepEqual(
            await outcomes(
                {
                    'with the feature': 't-with',
                    'granted it by its contract': 't-contract',
                    'without it': 't-without',
                },
                (tenantId) =>
                    new FeatureGuard(
                        new Reflector(),
                        fullEntitlements(subscriptionsBehindThePolicy()),
                    )
                        .canActivate(routeOf(tenantId, RequireFeature('NOTES')))
                        .then(() => undefined),
            ),
            inEveryFrame({
                'with the feature': 'passed',
                'granted it by its contract': 'passed',
                'without it': 'FEATURE_NOT_LICENSED',
            }),
        );
    });

    test('EnforceQuotaInterceptor refuses a tenant at its limit and lets one under it through', async () => {
        const interceptor = new EnforceQuotaInterceptor(
            new Reflector(),
            staticEntitlements(subscriptionsBehindThePolicy()),
            [quotaProvider],
        );
        assert.deepEqual(
            await outcomes({ 'under its limit': 't-with', 'at its limit': 't-full' }, (tenantId) =>
                intercepted(interceptor, routeOf(tenantId, EnforceQuota('notes'))),
            ),
            inEveryFrame({ 'under its limit': 'passed', 'at its limit': 'LIMIT_EXCEEDED' }),
        );
    });
});

describe('without a bypass bound', () => {
    test('the default stack reads the subscription in the frame the caller runs in', async () => {
        const subscriptions = subscriptionsBehindThePolicy();
        const entitlements = staticEntitlements(subscriptions, null);
        for (const [name, within] of Object.entries(FRAMES)) {
            subscriptions.readIn.length = 0;
            await within('t-with', () => entitlements.snapshot('t-with'));
            assert.deepEqual(
                subscriptions.readIn,
                [await within('t-with', async () => frame.getStore())],
                name,
            );
        }
    });

    test('the full entitlement reads the subscription in the frame the caller runs in', async () => {
        for (const [name, within] of Object.entries(FRAMES)) {
            const subscriptions = subscriptionsBehindThePolicy();
            await within('t-with', () =>
                fullEntitlements(subscriptions, null)
                    .computeLimits('t-with')
                    .catch(() => null),
            );
            assert.deepEqual(
                subscriptions.readIn,
                [await within('t-with', async () => frame.getStore())],
                name,
            );
        }
    });

    test("inside the tenant's frame both still read the tenant's plan", async () => {
        const subscriptions = subscriptionsBehindThePolicy();
        const { features } = await FRAMES["in the tenant's frame"]('t-with', () =>
            fullEntitlements(subscriptions, null).computeLimits('t-with'),
        );
        assert.deepEqual([...features], ['NOTES']);
        const snapshot = await FRAMES["in the tenant's frame"]('t-with', () =>
            staticEntitlements(subscriptions, null).snapshot('t-with'),
        );
        assert.equal(snapshot.planId, 'PRO');
    });
});

// Compiled as `SaaSiCatModule` composes it, so the bypass each read goes
// through is the one the composition provides, not one a test hands it.
// @requirement SC-SEC-020 — What crosses the tenant policy is named; a tenant's reach only its subscriber and itself
describe('the plan reads, as SaaSiCatModule composes them', () => {
    let moduleRef;

    before(async () => {
        const composed = bootable(everythingOnOptions());
        composed.persistence.core.rlsBypass = BYPASS;
        composed.persistence.entitlement.subscriptionRepository = subscriptionsBehindThePolicy();
        composed.persistence.entitlement.subscriptionContractRepository = contractsBehindThePolicy;
        composed.persistence.entitlement.subscriptionBundleRepository = {
            listActiveBySubscription: async () => [],
        };
        moduleRef = await Test.createTestingModule({
            imports: [SaaSiCatModule.forRoot(composed)],
        }).compile();
    });

    after(async () => {
        await moduleRef?.close();
    });

    test("the default stack's plan resolver reads the tenant's plan before the tenant frame", async () => {
        const resolver = moduleRef.get(PLAN_RESOLVER_PORT_TOKEN, { strict: false });
        assert.ok(resolver instanceof SubscriptionPlanResolver);
        assert.equal(
            await FRAMES['before the tenant frame']('t-with', () =>
                resolver.getPlanIdForTenant('t-with'),
            ),
            'PRO',
        );
    });

    test("the full entitlement reads the tenant's subscription before the tenant frame", async () => {
        const entitlements = moduleRef.get(EntitlementService, { strict: false });
        const { plan: effective, features } = await FRAMES['before the tenant frame'](
            't-with',
            () => entitlements.computeLimits('t-with', new Date(), CATALOG),
        );
        assert.equal(effective, 'PRO');
        assert.deepEqual([...features], ['NOTES']);
    });
});
