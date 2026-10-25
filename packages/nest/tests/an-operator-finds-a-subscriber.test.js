// The operator finds a subscriber without going through its tenant: the list,
// searched by a customer number, a legal name or a VAT number, and the head of
// each subscriber's record with every tenant it was linked to — also once the
// tenant is gone. Asked through the platform as an application composes it, so
// what is asserted is what the route serves, in the frame it runs in.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { SUBSCRIBER_LIST_PAGE_SIZE, SUBSCRIBER_SEARCH_MAX_LENGTH } from '@saasicat/core';

import { LIST_ROUTE, RECORD_ROUTE, aPlatform } from './helpers/operator-subscriber-platform.js';

/** Who the list names, in the order it names them. */
const namesOf = (page) => page.subscribers.map((row) => row.legalName);

/** The list as the route serves it, its query as a request carries it. */
const listOf = (platform, query = {}) => platform.call(LIST_ROUTE)(query);

/** A subscriber of a tenant the application does not have, as one it deleted leaves behind. */
async function aSubscriberOfAGoneTenant(platform, legalName = 'Gone GmbH', tenantId = 't-gone') {
    return platform.repo.createForTenant({
        tenantId,
        legalName,
        addressLine1: null,
        addressLine2: null,
        postalCode: null,
        city: null,
        country: 'DE',
        vatId: null,
        taxNumber: null,
        invoiceEmail: null,
        business: null,
        customerNumberPrefix: 'K-',
    });
}

// @requirement SC-ADM-036 — An operator finds a subscriber by its number, name or VAT number, tenant or not
describe('the list of subscribers', () => {
    test('is every subscriber, the latest customer number first, each with the tenant it is live for', async () => {
        const platform = await aPlatform();

        const page = await listOf(platform);

        assert.deepEqual(namesOf(page), [
            'Wien GmbH',
            'Contoso SARL',
            'Fabrikam GmbH',
            'Northwind GmbH',
        ]);
        assert.deepEqual(page.subscribers[0].liveTenant, {
            id: 't-wien',
            slug: 'wien',
            name: 'wien',
        });
        assert.equal(page.next, null);
    });

    test('is searched by a legal name, a customer number or a VAT number', async () => {
        const platform = await aPlatform();
        const contoso = await platform.repo.findById(platform.idOf('contoso'));

        assert.deepEqual(namesOf(await listOf(platform, { q: 'contoso' })), ['Contoso SARL']);
        assert.deepEqual(namesOf(await listOf(platform, { q: contoso.customerNumber })), [
            'Contoso SARL',
        ]);
        assert.deepEqual(namesOf(await listOf(platform, { q: 'atu 123.456-78' })), ['Wien GmbH']);
        assert.deepEqual(namesOf(await listOf(platform, { q: 'Nobody & Co' })), []);
    });

    test('names a live tenant the application no longer has by its id alone', async () => {
        const platform = await aPlatform();
        await aSubscriberOfAGoneTenant(platform);

        const [gone] = (await listOf(platform, { q: 'Gone' })).subscribers;

        assert.deepEqual(gone.liveTenant, { id: 't-gone', slug: null, name: null });
    });

    test('narrowed to those without a live tenant, is the ones whose every link is closed', async () => {
        const platform = await aPlatform();
        platform.repo.closeTenantLink(platform.idOf('fabrikam'));

        for (const sent of ['true', true]) {
            const page = await listOf(platform, { withoutLiveTenant: sent });
            assert.deepEqual(namesOf(page), ['Fabrikam GmbH']);
            assert.equal(page.subscribers[0].liveTenant, null);
        }
        assert.equal(
            namesOf(await listOf(platform, { withoutLiveTenant: 'false' })).length,
            4,
            'only true narrows it',
        );
    });

    test('is read a page at a time, the next one named by the last subscriber on it', async () => {
        const platform = await aPlatform();
        for (let index = 0; index < SUBSCRIBER_LIST_PAGE_SIZE - 3; index += 1) {
            await aSubscriberOfAGoneTenant(platform, `Many ${index}`, `t-gone-${index}`);
        }

        const first = await listOf(platform);
        assert.equal(first.subscribers.length, SUBSCRIBER_LIST_PAGE_SIZE);
        assert.equal(first.next, first.subscribers.at(-1).id);
        const second = await listOf(platform, { after: first.next });
        assert.deepEqual(namesOf(second), ['Northwind GmbH']);
        assert.equal(second.next, null);
    });

    // @requirement SC-SEC-015 — An operator's route runs across tenants, and no other route does
    test("is read outside the tenants' row-level policy, the tenants named in one question", async () => {
        const platform = await aPlatform();

        await listOf(platform);

        assert.ok(platform.seen.reads.length > 0);
        assert.ok(platform.seen.reads.every(({ bypassed }) => bypassed));
        assert.equal(platform.seen.lookups.length, 1, 'the tenants of a page asked for at once');
        assert.ok(platform.seen.lookups.every(({ bypassed }) => bypassed));
    });
});

// @requirement SC-ADM-036 — An operator finds a subscriber by its number, name or VAT number, tenant or not
describe("the head of a subscriber's record", () => {
    const recordOf = (platform, id) => platform.call(RECORD_ROUTE)(id);

    test('is its master data with its invoice email, its standing, and the tenant it is live for', async () => {
        const platform = await aPlatform();

        const record = await recordOf(platform, platform.idOf('northwind'));

        assert.equal(record.subscriber.legalName, 'Northwind GmbH');
        assert.equal(record.subscriber.invoiceEmail, null);
        assert.deepEqual(record.readiness, { ready: true, missing: [], taxRefusal: null });
        assert.deepEqual(
            record.tenants.map(({ tenantId, known, slug, name, unlinkedAt, deletedAt }) => ({
                tenantId,
                known,
                slug,
                name,
                unlinkedAt,
                deletedAt,
            })),
            [
                {
                    tenantId: 't-northwind',
                    known: true,
                    slug: 'northwind',
                    name: 'northwind',
                    unlinkedAt: null,
                    deletedAt: null,
                },
            ],
        );
        assert.ok(!Number.isNaN(Date.parse(record.tenants[0].linkedAt)));
    });

    test('names a tenant whose link was closed, with when', async () => {
        const platform = await aPlatform();
        const closedAt = new Date('2026-06-30T10:00:00.000Z');
        platform.repo.closeTenantLink(platform.idOf('contoso'), closedAt);

        const { tenants } = await recordOf(platform, platform.idOf('contoso'));

        assert.deepEqual(
            tenants.map(({ slug, unlinkedAt }) => [slug, unlinkedAt]),
            [['contoso', closedAt.toISOString()]],
        );
    });

    test('says when the application no longer has a tenant whose link is still open', async () => {
        const platform = await aPlatform();
        const gone = await aSubscriberOfAGoneTenant(platform);

        const { tenants } = await recordOf(platform, gone.id);

        assert.deepEqual(
            tenants.map(({ tenantId, known, slug, unlinkedAt }) => [
                tenantId,
                known,
                slug,
                unlinkedAt,
            ]),
            [['t-gone', false, null, null]],
        );
    });

    test('of a subscriber there is not is refused, by code', async () => {
        const platform = await aPlatform();

        await assert.rejects(
            recordOf(platform, 'no-such-subscriber'),
            (error) => error.getResponse?.().code === 'SUBSCRIBER_NOT_FOUND',
        );
    });

    // @requirement SC-SEC-015 — An operator's route runs across tenants, and no other route does
    test("is read outside the tenants' row-level policy", async () => {
        const platform = await aPlatform();

        await recordOf(platform, platform.idOf('wien'));

        assert.ok(platform.seen.reads.length > 0);
        assert.ok(platform.seen.reads.every(({ bypassed }) => bypassed));
        assert.ok(platform.seen.lookups.every(({ bypassed }) => bypassed));
    });
});

/** A query, as the application's global `ValidationPipe` hands it to the route. */
async function throughThePipe(query) {
    const platform = await aPlatform();
    const served = platform.served(LIST_ROUTE);
    const [metatype] = Reflect.getMetadata(
        'design:paramtypes',
        served.controller.prototype,
        served.name,
    );
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    return pipe.transform(query, { type: 'query', metatype });
}

describe('what the list takes', () => {
    test('a search of the longest length, a narrowing and a page to continue after', async () => {
        const taken = await throughThePipe({
            q: 'x'.repeat(SUBSCRIBER_SEARCH_MAX_LENGTH),
            withoutLiveTenant: 'true',
            after: 's-1',
        });

        assert.equal(taken.q.length, SUBSCRIBER_SEARCH_MAX_LENGTH);
        assert.equal(taken.withoutLiveTenant, 'true');
    });

    for (const [why, query] of [
        ['a search a character too long', { q: 'x'.repeat(SUBSCRIBER_SEARCH_MAX_LENGTH + 1) }],
        ['a narrowing that is neither true nor false', { withoutLiveTenant: 'yes' }],
        ['a page after an id longer than any', { after: 'x'.repeat(201) }],
    ]) {
        test(`refuses ${why}`, async () => {
            await assert.rejects(throughThePipe(query), BadRequestException);
        });
    }
});

// @requirement SC-ADM-015 — The administration only offers what the application actually has
describe('where the list and the record are served', () => {
    test('beside the subscriber view, its page announced under the same capability', async () => {
        const served = await aPlatform();
        const without = await aPlatform({ subscribers: false });

        assert.equal(served.manifest.capabilities['subscribers.read'], true);
        assert.deepEqual(served.manifest.navigation.standardPages.subscribers, {
            enabled: true,
            requiredCapability: 'subscribers.read',
        });
        assert.ok(served.served(LIST_ROUTE) && served.served(RECORD_ROUTE));
        assert.equal(without.served(LIST_ROUTE), undefined);
        assert.equal(without.served(RECORD_ROUTE), undefined);
        assert.equal(without.manifest.capabilities['subscribers.read'], undefined);
    });
});
