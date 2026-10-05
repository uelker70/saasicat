// useTenantSubscriber — the subscriber of a tenant, asked for only where the
// platform serves it.

// @requirement SC-PRIC-070 — The operator and the tenant see what holds a subscriber's next contract back
// @requirement SC-ADM-015 — The administration only offers what the application actually has

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { nextTick, ref } from 'vue';

import { useTenantSubscriber } from '../dist/index.js';

/** Lets the `immediate` microtask and any watcher run. */
async function settle() {
    await nextTick();
    await Promise.resolve();
    await Promise.resolve();
}

const STANDING = {
    subscriber: { id: 's1', customerNumber: 'K-10001', legalName: 'Northwind GmbH' },
    readiness: null,
};

const serving = (capability = true) => ({ capabilities: { 'subscribers.read': capability } });

function recordingTenants(answer = async () => STANDING) {
    const asked = [];
    return {
        asked,
        tenants: {
            subscriber: (slug) => {
                asked.push(slug);
                return answer(slug);
            },
        },
    };
}

describe('useTenantSubscriber', () => {
    test('where the manifest announces the subscriber, it is read for the tenant', async () => {
        const { asked, tenants } = recordingTenants();

        const subscriber = useTenantSubscriber(ref('northwind'), ref(serving()), tenants);
        await settle();

        assert.equal(subscriber.available.value, true);
        assert.deepEqual(asked, ['northwind']);
        assert.deepEqual(subscriber.data.value, STANDING);
    });

    for (const [label, manifest] of [
        ['no manifest', null],
        ['a manifest with only the charges', { capabilities: { 'charges.read': true } }],
        ['a manifest that sets it to false', serving(false)],
    ]) {
        test(`with ${label}, nothing is asked and nothing is shown`, async () => {
            const { asked, tenants } = recordingTenants();

            const subscriber = useTenantSubscriber(ref('northwind'), ref(manifest), tenants);
            await settle();

            assert.equal(subscriber.available.value, false);
            assert.deepEqual(asked, []);
            assert.equal(subscriber.data.value, null);
        });
    }

    test('another tenant is another subscriber, and no tenant asks nothing', async () => {
        const { asked, tenants } = recordingTenants();
        const slug = ref('northwind');

        useTenantSubscriber(slug, ref(serving()), tenants);
        await settle();
        slug.value = 'globex';
        await settle();
        slug.value = '';
        await settle();

        assert.deepEqual(asked, ['northwind', 'globex']);
    });

    test('a read that fails leaves an error and no subscriber', async () => {
        const { tenants } = recordingTenants(async () => {
            throw new Error('offline');
        });

        const subscriber = useTenantSubscriber(ref('northwind'), ref(serving()), tenants);
        await settle();

        assert.equal(subscriber.data.value, null);
        assert.ok(subscriber.error.value);
    });
});
