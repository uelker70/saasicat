// The operator sees a tenant's subscriber beside the tenant — its address, its
// tax details, and where a tax adapter decides, what holds its next contract
// back — and which tenants of a list are held back. Asked through the
// platform as an application composes it, so what is asserted is what the
// route serves, under the guard chain and in the frame it runs in.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import 'reflect-metadata';
import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { BILLING_ERROR_CODES } from '@saasicat/core';

import {
    ATTENTION_ROUTE,
    SUBSCRIBER_ROUTE,
    TENANTS,
    aPlatform,
} from './helpers/operator-subscriber-platform.js';

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
