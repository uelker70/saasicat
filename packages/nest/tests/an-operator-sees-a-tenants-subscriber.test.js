// The operator sees a tenant's subscriber beside the tenant — its address, its
// tax details, and where a tax adapter decides, what holds its next contract
// back — and which tenants of a list are held back. Asked through the
// platform as an application composes it, so what is asserted is what the
// route serves, under the guard chain and in the frame it runs in.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import 'reflect-metadata';
import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BILLING_ERROR_CODES } from '@saasicat/core';

import { AdminManifestService, SaaSiCatModule } from '../dist/platform/index.js';
import { FakeSubscriberRepository } from '../dist/testing/index.js';
import { storeSecretsInPlainText } from '../dist/index.js';
import { controllersIn, handlersOf } from './helpers/operator-routes.js';
import { TAX_SETTINGS, TEST_TAX_ADAPTER } from './helpers/tax-adapter.js';

const SUBSCRIBER_ROUTE = 'GET admin/tenants/:slug/subscriber';
const ATTENTION_ROUTE = 'GET admin/subscribers/attention';

const ADDRESS = { addressLine1: 'Hafenstraße 1', postalCode: '20457', city: 'Hamburg' };

/** The subscribers of the installation, by the tenant each belongs to. */
const SUBSCRIBERS = {
    't-northwind': { legalName: 'Northwind GmbH', ...ADDRESS, country: 'DE', business: true },
    't-fabrikam': { legalName: 'Fabrikam GmbH', ...ADDRESS, country: 'DE', city: null },
    't-contoso': { legalName: 'Contoso SARL', ...ADDRESS, country: 'FR', business: false },
    't-wien': {
        legalName: 'Wien GmbH',
        ...ADDRESS,
        country: 'AT',
        business: true,
        vatId: 'ATU12345678',
    },
};
const TENANTS = ['northwind', 'fabrikam', 'contoso', 'wien', 'empty'];

const CATALOG = {
    schemaVersion: 1,
    app: { name: 'Probe' },
    plans: [],
    tenantBilling: {
        cancellationNoticeDays: { monthly: 0, yearly: 0 },
        selfServiceBlockedPlans: { asTarget: [], asSource: [] },
    },
};

/** The details a subscriber is created with: everything an invoice names unless `details` empties it. */
const detailsOf = (details) => ({
    addressLine2: null,
    vatId: null,
    taxNumber: null,
    invoiceEmail: null,
    business: null,
    customerNumberPrefix: 'K-',
    ...details,
});

/**
 * The platform as an application composes it, every adapter a fake, with the
 * subscribers above. Records where each read ran: inside the bypass frame or
 * in the request's own.
 */
async function aPlatform({ adapter = true, adminResources = true, subscribers = true } = {}) {
    const seen = { lookups: [], reads: [] };
    let bypassed = 0;
    const rlsBypass = {
        async runWithBypass(fn) {
            bypassed += 1;
            try {
                return await fn();
            } finally {
                bypassed -= 1;
            }
        },
    };
    const repo = new FakeSubscriberRepository();
    for (const [tenantId, details] of Object.entries(SUBSCRIBERS)) {
        await repo.createForTenant({ tenantId, ...detailsOf(details) });
    }
    const wien = await repo.findByTenantId('t-wien');
    await repo.recordVatIdCheck(wien.id, {
        vatId: 'ATU12345678',
        checkedAt: new Date('2026-10-01T08:30:00.000Z'),
        valid: true,
        service: 'VIES',
        confirmation: {},
    });
    for (const method of ['findByTenantId', 'listForTenants']) {
        const read = repo[method].bind(repo);
        repo[method] = (...args) => {
            seen.reads.push({ method, bypassed: bypassed > 0 });
            return read(...args);
        };
    }
    const tenants = {
        listTenants: async () => [],
        async getTenantDetail(slug) {
            seen.lookups.push({ slug, bypassed: bypassed > 0 });
            return TENANTS.includes(slug) ? { id: `t-${slug}`, slug, name: slug } : null;
        },
        setTenantActive: async () => null,
        listUsers: async () => [],
        listAudit: async () => [],
        listSubscriptions: async () => [],
    };
    const root = SaaSiCatModule.forRoot({
        adapters: { secretSealer: storeSecretsInPlainText() },
        planCatalog: adapter ? { ...CATALOG, ...TAX_SETTINGS } : { ...CATALOG, vatRate: 19 },
        ...(adapter
            ? { tax: { adapter: { adapterName: 'test-tax', create: () => TEST_TAX_ADAPTER } } }
            : {}),
        controller: { guards: [] },
        discoverySnapshotPath: null,
        persistence: {
            capabilities: {
                transactions: true,
                pessimisticLocking: true,
                rowLevelSecurity: true,
                advisoryLocks: false,
            },
            core: {
                mfa: {},
                audit: { write: async () => {} },
                rlsBypass,
                transactionRunner: { run: (fn) => fn({}) },
            },
            entitlement: {
                subscriptionRepository: { findByTenantId: async () => null },
                planVersionRepository: { findById: async () => null },
                ...(subscribers ? { subscriberRepository: repo } : {}),
            },
            adminResources: { resources: tenants },
        },
        adminResources,
    });
    const moduleRef = await Test.createTestingModule({ imports: [root] }).compile();
    const manifest = await moduleRef.get(AdminManifestService).getManifest();
    const handlers = controllersIn(root).flatMap(handlersOf);
    const call = (route) => {
        const served = handlers.find((handler) => handler.route === route);
        return (...args) =>
            moduleRef.get(served.controller, { strict: false })[served.name](...args);
    };
    return {
        moduleRef,
        manifest,
        seen,
        served: (route) => handlers.find((handler) => handler.route === route),
        /** Asks the routes the way Nest dispatches to them. */
        subscriberOf: (slug) => call(SUBSCRIBER_ROUTE)(slug),
        attention: (tenantId) => call(ATTENTION_ROUTE)({ tenantId }),
    };
}

// @requirement SC-PRIC-070 — The operator and the tenant see what holds a subscriber's next contract back
describe("the operator sees a tenant's subscriber beside the tenant", () => {
    test('its address and tax details, and that nothing holds its next contract back', async () => {
        const platform = await aPlatform();

        const { subscriber, readiness } = await platform.subscriberOf('northwind');

        assert.deepEqual(
            {
                ...subscriber,
                id: typeof subscriber.id,
                customerNumber: subscriber.customerNumber.startsWith('K-'),
            },
            {
                id: 'string',
                customerNumber: true,
                legalName: 'Northwind GmbH',
                addressLine1: 'Hafenstraße 1',
                addressLine2: null,
                postalCode: '20457',
                city: 'Hamburg',
                country: 'DE',
                business: true,
                vatId: null,
                vatIdValidated: false,
                taxNumber: null,
                migrated: false,
            },
        );
        assert.deepEqual(readiness, { ready: true, missing: [], taxRefusal: null });
        assert.equal(platform.manifest.capabilities['subscribers.read'], true);
        assert.equal(platform.manifest.capabilities['subscribers.attention'], true);
        await platform.moduleRef.close();
    });

    test('a VAT id counts as validated where the check that counts found it valid', async () => {
        const platform = await aPlatform();

        const { subscriber, readiness } = await platform.subscriberOf('wien');

        assert.deepEqual([subscriber.vatId, subscriber.vatIdValidated], ['ATU12345678', true]);
        assert.equal(readiness.ready, true, 'the reverse charge needs the validated number');
        await platform.moduleRef.close();
    });

    test('the empty fields of its address, and the adapter sentence, where they hold it back', async () => {
        const platform = await aPlatform();

        assert.deepEqual((await platform.subscriberOf('fabrikam')).readiness, {
            ready: false,
            missing: ['city'],
            taxRefusal: null,
        });
        assert.deepEqual((await platform.subscriberOf('contoso')).readiness, {
            ready: false,
            missing: [],
            taxRefusal: 'A consumer outside Germany is not supported.',
        });
        await platform.moduleRef.close();
    });

    test('a tenant without a subscriber has none to show', async () => {
        const platform = await aPlatform();

        assert.deepEqual(await platform.subscriberOf('empty'), {
            subscriber: null,
            readiness: null,
        });
        await platform.moduleRef.close();
    });

    test('an unknown tenant is answered as not found, by code, and no subscriber is read', async () => {
        const platform = await aPlatform();

        await assert.rejects(
            () => platform.subscriberOf('nowhere'),
            (error) => {
                assert.ok(error instanceof NotFoundException);
                assert.equal(error.getResponse().code, BILLING_ERROR_CODES.TENANT_NOT_FOUND);
                return true;
            },
        );
        assert.deepEqual(platform.seen.reads, []);
        await platform.moduleRef.close();
    });

    test("the tenant is found and its subscriber read outside the tenants' row-level policy", async () => {
        const platform = await aPlatform();

        await platform.subscriberOf('northwind');
        await platform.attention(['t-northwind']);

        assert.deepEqual(platform.seen.lookups, [{ slug: 'northwind', bypassed: true }]);
        assert.deepEqual(platform.seen.reads, [
            { method: 'findByTenantId', bypassed: true },
            { method: 'listForTenants', bypassed: true },
        ]);
        await platform.moduleRef.close();
    });
});

// @requirement SC-PRIC-070 — The operator and the tenant see what holds a subscriber's next contract back
describe('the tenants of a list whose subscriber is held back', () => {
    test('each named with what holds it back; the ready ones and those without a subscriber are left out', async () => {
        const platform = await aPlatform();

        const { attention } = await platform.attention(TENANTS.map((slug) => `t-${slug}`));

        assert.deepEqual(
            attention
                .map(({ tenantId, readiness }) => [tenantId, readiness])
                .sort(([a], [b]) => a.localeCompare(b)),
            [
                [
                    't-contoso',
                    {
                        ready: false,
                        missing: [],
                        taxRefusal: 'A consumer outside Germany is not supported.',
                    },
                ],
                ['t-fabrikam', { ready: false, missing: ['city'], taxRefusal: null }],
            ],
        );
        await platform.moduleRef.close();
    });

    test('one tenant as the query sent it, where the pipe does not transform: still that tenant', async () => {
        const platform = await aPlatform();

        const { attention } = await platform.attention('t-fabrikam');

        assert.deepEqual(
            attention.map(({ tenantId }) => tenantId),
            ['t-fabrikam'],
        );
        await platform.moduleRef.close();
    });

    test('only among the tenants named', async () => {
        const platform = await aPlatform();

        const { attention } = await platform.attention(['t-fabrikam']);

        assert.deepEqual(
            attention.map(({ tenantId }) => tenantId),
            ['t-fabrikam'],
        );
        await platform.moduleRef.close();
    });
});

// @requirement SC-PRIC-070 — The operator and the tenant see what holds a subscriber's next contract back
describe('where no tax adapter decides', () => {
    test('the subscriber is shown without a standing, and the lists are not asked to mark one', async () => {
        const platform = await aPlatform({ adapter: false });

        const { subscriber, readiness } = await platform.subscriberOf('fabrikam');

        assert.equal(subscriber.legalName, 'Fabrikam GmbH');
        assert.equal(readiness, null, 'nothing holds a contract back without an adapter');
        assert.deepEqual(await platform.attention(['t-fabrikam', 't-contoso']), {
            attention: [],
        });
        assert.equal(platform.manifest.capabilities['subscribers.read'], true);
        assert.equal(platform.manifest.capabilities['subscribers.attention'], undefined);
        await platform.moduleRef.close();
    });
});

// @requirement SC-ADM-015 — The administration only offers what the application actually has
describe('where the view is served', () => {
    for (const [without, options] of [
        ['the tenants', { adminResources: false }],
        ['a subscriber repository', { subscribers: false }],
    ]) {
        test(`without ${without}, neither the routes nor the capabilities exist`, async () => {
            const platform = await aPlatform(options);

            assert.equal(platform.served(SUBSCRIBER_ROUTE), undefined);
            assert.equal(platform.served(ATTENTION_ROUTE), undefined);
            assert.equal(platform.manifest.capabilities['subscribers.read'], undefined);
            assert.equal(platform.manifest.capabilities['subscribers.attention'], undefined);
            await platform.moduleRef.close();
        });
    }
});

/** The query of the attention route, as the global `ValidationPipe` hands it over. */
async function attentionQuery(query) {
    const platform = await aPlatform();
    const served = platform.served(ATTENTION_ROUTE);
    const [metatype] = Reflect.getMetadata(
        'design:paramtypes',
        served.controller.prototype,
        served.name,
    );
    await platform.moduleRef.close();
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    return pipe.transform(query, { type: 'query', metatype });
}

describe('the tenants the attention route is asked about', () => {
    test('one tenant arrives as a list of one, none as an empty list', async () => {
        assert.deepEqual((await attentionQuery({ tenantId: 't-1' })).tenantId, ['t-1']);
        assert.deepEqual((await attentionQuery({})).tenantId, []);
    });

    test('a page of two hundred is taken, one more is refused', async () => {
        const page = Array.from({ length: 200 }, (_, index) => `t-${index}`);
        assert.equal((await attentionQuery({ tenantId: page })).tenantId.length, 200);
        await assert.rejects(attentionQuery({ tenantId: [...page, 't-200'] }), BadRequestException);
    });

    test('an empty tenant id is refused', async () => {
        await assert.rejects(attentionQuery({ tenantId: ['t-1', ''] }), BadRequestException);
    });
});
