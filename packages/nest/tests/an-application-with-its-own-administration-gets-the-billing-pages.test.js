// An application that serves its own pages for tenants, users, the audit log
// and subscriptions turns the administration on with
// `adminResources: { includeController: false }` (`SC-ADM-057`): the
// platform's generic routes go, every billing route of the operator stays, and
// those routes find a tenant through two methods the application writes rather
// than eight.
//
// Which routes stay is read off the module graph with the switch and without
// it, so a composer that mounts a billing route later is covered without being
// listed here. Whether the application's own route stands beside them is asked
// of a real start on Fastify, which refuses a second handler on one path where
// Express would quietly let the first one win.

import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Controller, Get } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import { AdminResourcesService, SaaSiCatModule } from '../dist/platform/index.js';
import { FakeTenantAccessHoldRepository } from '../dist/testing/index.js';
import { invoicingPlatform } from './helpers/invoicing-platform.js';
import {
    bootable,
    controllersIn,
    everythingOnOptions,
    handlersOf,
} from './helpers/operator-routes.js';

/** The routes of the platform's generic administration, as the switch takes them away. */
const GENERIC_ROUTES = [
    'GET admin/audit',
    'GET admin/subscriptions',
    'GET admin/tenants',
    'GET admin/tenants/:slug',
    'GET admin/users',
    'POST admin/tenants/:slug/reactivate',
    'POST admin/tenants/:slug/suspend',
];

const ACME = {
    id: 't-acme',
    slug: 'acme',
    name: 'Acme',
    isActive: true,
    subscription: null,
    users: [],
};

/** An application's own lookup: the two methods and nothing else, counting what it is asked. */
function narrowLookup() {
    const asked = { getTenantDetail: [], findTenantsByIds: [] };
    return {
        asked,
        port: {
            getTenantDetail: async (slug) => {
                asked.getTenantDetail.push(slug);
                return slug === ACME.slug ? ACME : null;
            },
            findTenantsByIds: async (ids) => {
                asked.findTenantsByIds.push([...ids]);
                return ids.includes(ACME.id)
                    ? [{ id: ACME.id, slug: ACME.slug, name: ACME.name }]
                    : [];
            },
        },
    };
}

/** A port answering every method with `null`, except the ones given. */
const answering = (methods) =>
    new Proxy(methods, {
        get: (target, key) =>
            key in target
                ? target[key]
                : typeof key === 'symbol' || key === 'then'
                  ? undefined
                  : async () => null,
    });

/** Everything on, with the administration's switch and port as given. */
function withAdministration(adminResources) {
    return { ...everythingOnOptions(), adminResources };
}

/** The platform with invoices issued, bound far enough to start, and the administration as given. */
function startable(adminResources) {
    return { ...invoicingPlatform(), adminResources };
}

const routesOf = (module) =>
    controllersIn(module)
        .flatMap(handlersOf)
        .map(({ route }) => route);

/** Decorates a class the way the TypeScript compiler would; plain JavaScript has no syntax for it. */
function decorate(target, classDecorators, methods = {}) {
    for (const [name, decorators] of Object.entries(methods)) {
        const descriptor = Object.getOwnPropertyDescriptor(target.prototype, name);
        Reflect.decorate(decorators, target.prototype, name, descriptor);
    }
    return Reflect.decorate(classDecorators, target);
}

/** The application's own list of tenants, on the path the platform's would take. */
class OwnTenantsController {
    list() {
        return [{ slug: 'from-the-application' }];
    }
}
decorate(OwnTenantsController, [Controller('admin')], { list: [Get('tenants')] });

/** The modules of `options` and the application's own tenant route, compiled. */
async function compiledBeside(options) {
    const platform = SaaSiCatModule.forRoot(options);
    const moduleRef = await Test.createTestingModule({
        imports: [platform],
        controllers: [OwnTenantsController],
    }).compile();
    return { platform, moduleRef };
}

/** The instance of the controller `platform` mounts under `name`. */
function controllerNamed(platform, moduleRef, name) {
    const controller = controllersIn(platform).find((candidate) => candidate.name === name);
    assert.ok(controller, `${name} is mounted`);
    return moduleRef.get(controller, { strict: false });
}

/** `options` with the reads of the contract register and the subscriber's state answered empty. */
function readable(options) {
    const composed = bootable(options);
    composed.persistence.core.rlsBypass = { runWithBypass: (work) => work() };
    composed.persistence.core.tenantAccessHolds = new FakeTenantAccessHoldRepository();
    const contracts = answering({
        listRegister: async () => ({ contracts: [], hasMore: false }),
    });
    const subscribers = answering({
        findByIds: async () => [],
        findByTenantId: async () => null,
    });
    composed.persistence.entitlement.subscriptionContractRepository = contracts;
    composed.persistence.entitlement.subscriberRepository = subscribers;
    composed.tenantBilling = {
        ...composed.tenantBilling,
        contractFreeze: {
            ...composed.tenantBilling.contractFreeze,
            subscriptionContractRepository: contracts,
            subscriberRepository: subscribers,
        },
    };
    return composed;
}

// @requirement SC-ADM-057 — An application with its own administration gets the operator's billing pages
describe('an application with its own administration gets the billing pages', () => {
    let app;
    afterEach(async () => {
        await app?.close();
        app = undefined;
    });

    test('the switch takes away the seven generic routes and keeps every other one', () => {
        const withController = routesOf(SaaSiCatModule.forRoot(everythingOnOptions()));
        const without = routesOf(
            SaaSiCatModule.forRoot(
                withAdministration({ includeController: false, resources: narrowLookup().port }),
            ),
        );
        const gone = withController.filter((route) => !without.includes(route));
        assert.deepEqual([...new Set(gone)].sort(), GENERIC_ROUTES);
        assert.deepEqual(
            without.filter((route) => !withController.includes(route)),
            [],
            'nothing is mounted in their place',
        );
        // Under `admin/tenants/…`, and a billing route all the same.
        assert.ok(without.includes('GET admin/tenants/:slug/subscriber'), without);
        assert.ok(without.includes('GET admin/contracts'), without);
        assert.ok(without.includes('GET admin/invoices'), without);
    });

    test('without the switch, the seven generic routes are mounted', () => {
        const routes = routesOf(SaaSiCatModule.forRoot(everythingOnOptions()));
        for (const route of GENERIC_ROUTES) assert.ok(routes.includes(route), route);
    });

    test("the application's own GET admin/tenants starts beside them on Fastify", async () => {
        const { moduleRef } = await compiledBeside(
            startable({ includeController: false, resources: narrowLookup().port }),
        );
        app = moduleRef.createNestApplication(new FastifyAdapter(), { logger: false });
        await app.init();
        const response = await app.getHttpAdapter().getInstance().inject({
            method: 'GET',
            url: '/admin/tenants',
        });
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json(), [{ slug: 'from-the-application' }]);
    });

    test("with the platform's controller mounted, the same route refuses to start on Fastify", async () => {
        const { moduleRef } = await compiledBeside(startable(true));
        app = moduleRef.createNestApplication(new FastifyAdapter(), { logger: false });
        await assert.rejects(() => app.init(), /already declared|duplicated/i);
    });

    test('a full port with the switch starts as well', async () => {
        const { moduleRef } = await compiledBeside(startable({ includeController: false }));
        app = moduleRef.createNestApplication(new FastifyAdapter(), { logger: false });
        await app.init();
    });

    test("the contracts read their tenants through the application's lookup", async () => {
        const { port, asked } = narrowLookup();
        const { platform, moduleRef } = await compiledBeside(
            readable(withAdministration({ includeController: false, resources: port })),
        );
        const contracts = controllerNamed(
            platform,
            moduleRef,
            'GeneratedContractConfirmationController',
        );
        const page = await contracts.contracts({});
        assert.deepEqual(page.contracts, []);
        assert.deepEqual(asked.findTenantsByIds, [[]]);
    });

    test("the tenant's subscriber is found through the application's lookup by slug", async () => {
        const { port, asked } = narrowLookup();
        const { platform, moduleRef } = await compiledBeside(
            readable(withAdministration({ includeController: false, resources: port })),
        );
        const subscribers = controllerNamed(
            platform,
            moduleRef,
            'GeneratedSubscriberAdminController',
        );
        assert.deepEqual(await subscribers.subscriberOf('acme'), {
            subscriber: null,
            readiness: null,
        });
        assert.deepEqual(asked.getTenantDetail, ['acme']);
    });

    test('a generic read asked of the two-method lookup says what it needs', async () => {
        const { port } = narrowLookup();
        const { moduleRef } = await compiledBeside(
            readable(withAdministration({ includeController: false, resources: port })),
        );
        const service = moduleRef.get(AdminResourcesService, { strict: false });
        await assert.rejects(
            () => service.listTenants({}),
            (error) =>
                /listTenants/.test(error.message) &&
                /AdminResourcesPort/.test(error.message) &&
                /includeController: false/.test(error.message),
        );
    });

    test('without a lookup and without the bundle, the start is refused naming the two methods', () => {
        const options = withAdministration({ includeController: false });
        const { adminResources: _bundled, ...persistence } = options.persistence;
        let refusal;
        try {
            SaaSiCatModule.forRoot({ ...options, persistence });
        } catch (error) {
            refusal = error;
        }
        assert.ok(refusal, 'the start is refused');
        assert.match(refusal.message, /admin-resources\.requires-persistence/);
        assert.match(refusal.message, /AdminTenantLookupPort/);
        assert.match(refusal.message, /findTenantsByIds/);
        assert.match(refusal.message, /getTenantDetail/);
    });
});
