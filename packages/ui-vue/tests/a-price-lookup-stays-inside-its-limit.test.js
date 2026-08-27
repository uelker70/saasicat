// What the price lookup sends, and how much of it at a time.
//
// The endpoint caps a request at `BUNDLE_PRICE_LOOKUP_LIMIT` ids. A client that
// learned that cap by receiving a 400 would fail silently: the lookup answers
// with an empty map, and every card falls back to the public catalogue's base
// prices — the figures this call exists to replace, because the catalogue has
// no plan to resolve an override against.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { useTenantBilling } from '../dist/index.js';
import { BUNDLE_PRICE_LOOKUP_LIMIT } from '@saasicat/core';

function recordingHttp(answer = () => ({})) {
    const calls = [];
    return {
        calls,
        client: async (url, init) => {
            const body = init?.body ? JSON.parse(init.body) : undefined;
            calls.push({ url, method: init?.method ?? 'GET', body });
            return {
                status: 200,
                headers: { get: () => null },
                json: async () => answer(body),
                text: async () => '',
            };
        },
    };
}

const ids = (n) => Array.from({ length: n }, (_, i) => `bv-${i}`);

describe('loadBundlePrices', () => {
    test('asks for nothing when there is nothing to ask about', async () => {
        const { client, calls } = recordingHttp();
        const billing = useTenantBilling({ http: client, autoLoad: false });
        assert.deepEqual(await billing.loadBundlePrices([]), {});
        assert.equal(calls.length, 0, 'an empty catalogue must not cost a request');
    });

    test('sends one request while the catalogue fits', async () => {
        const { client, calls } = recordingHttp();
        const billing = useTenantBilling({ http: client, autoLoad: false });
        await billing.loadBundlePrices(ids(BUNDLE_PRICE_LOOKUP_LIMIT));
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, '/billing/subscription-bundles/prices');
        assert.equal(calls[0].method, 'POST');
        assert.equal(calls[0].body.bundleVersionIds.length, BUNDLE_PRICE_LOOKUP_LIMIT);
    });

    test('splits a catalogue larger than the cap instead of being rejected whole', async () => {
        const { client, calls } = recordingHttp();
        const billing = useTenantBilling({ http: client, autoLoad: false });
        await billing.loadBundlePrices(ids(BUNDLE_PRICE_LOOKUP_LIMIT + 1));
        assert.equal(calls.length, 2);
        // No batch may exceed the cap — that is the whole point.
        for (const call of calls) {
            assert.ok(call.body.bundleVersionIds.length <= BUNDLE_PRICE_LOOKUP_LIMIT);
        }
        // And every id is asked about exactly once, so a bundle cannot fall
        // through the seam between two batches.
        const asked = calls.flatMap((call) => call.body.bundleVersionIds);
        assert.deepEqual(asked.sort(), ids(BUNDLE_PRICE_LOOKUP_LIMIT + 1).sort());
    });

    test('merges what the batches answer', async () => {
        const { client } = recordingHttp((body) =>
            Object.fromEntries(
                body.bundleVersionIds.map((id) => [id, { monthlyNet: 1, yearlyNet: 10 }]),
            ),
        );
        const billing = useTenantBilling({ http: client, autoLoad: false });
        const prices = await billing.loadBundlePrices(ids(BUNDLE_PRICE_LOOKUP_LIMIT + 5));
        assert.equal(Object.keys(prices).length, BUNDLE_PRICE_LOOKUP_LIMIT + 5);
        assert.deepEqual(prices['bv-0'], { monthlyNet: 1, yearlyNet: 10 });
        assert.deepEqual(prices[`bv-${BUNDLE_PRICE_LOOKUP_LIMIT + 4}`], {
            monthlyNet: 1,
            yearlyNet: 10,
        });
    });

    test('a consumer without the endpoint keeps the catalogue rather than breaking', async () => {
        const billing = useTenantBilling({
            http: async () => {
                throw new Error('404');
            },
            autoLoad: false,
        });
        assert.deepEqual(await billing.loadBundlePrices(ids(3)), {});
    });
});
