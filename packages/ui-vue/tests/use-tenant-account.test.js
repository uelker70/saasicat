// useTenantAccount — the account of a tenant's subscriber, asked for only where
// the platform serves it.

// @requirement SC-ADM-028 — An operator reads a subscriber's charges beside its tenant
// @requirement SC-ADM-015 — The administration only offers what the application actually has

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { nextTick, ref } from 'vue';

import { useTenantAccount } from '../dist/index.js';

/** Lets the `immediate` microtask and any watcher run. */
async function settle() {
    await nextTick();
    await Promise.resolve();
    await Promise.resolve();
}

const ACCOUNT = {
    holder: { id: 's1', customerNumber: 'K-10001', legalName: 'Northwind GmbH' },
    entries: [],
};

const serving = (capability = true) => ({ capabilities: { 'charges.read': capability } });

function recordingTenants(answer = async () => ACCOUNT) {
    const asked = [];
    return {
        asked,
        tenants: {
            charges: (slug) => {
                asked.push(slug);
                return answer(slug);
            },
        },
    };
}

describe('useTenantAccount', () => {
    test('where the manifest announces the account, it is read for the tenant', async () => {
        const { asked, tenants } = recordingTenants();

        const account = useTenantAccount(ref('northwind'), ref(serving()), tenants);
        await settle();

        assert.equal(account.available.value, true);
        assert.deepEqual(asked, ['northwind']);
        assert.deepEqual(account.data.value, ACCOUNT);
    });

    for (const [label, manifest] of [
        ['no manifest', null],
        ['a manifest without the capability', { capabilities: {} }],
        ['a manifest that sets it to false', serving(false)],
    ]) {
        test(`with ${label}, nothing is asked and nothing is shown`, async () => {
            const { asked, tenants } = recordingTenants();

            const account = useTenantAccount(ref('northwind'), ref(manifest), tenants);
            await settle();

            assert.equal(account.available.value, false);
            assert.deepEqual(asked, []);
            assert.equal(account.data.value, null);
        });
    }

    test('a manifest that arrives later brings the account with it', async () => {
        const { asked, tenants } = recordingTenants();
        const manifest = ref(null);

        const account = useTenantAccount(ref('northwind'), manifest, tenants);
        await settle();
        manifest.value = serving();
        await settle();

        assert.deepEqual(asked, ['northwind']);
        assert.deepEqual(account.data.value, ACCOUNT);
    });

    test('another tenant is another account', async () => {
        const { asked, tenants } = recordingTenants();
        const slug = ref('northwind');

        useTenantAccount(slug, ref(serving()), tenants);
        await settle();
        slug.value = 'globex';
        await settle();

        assert.deepEqual(asked, ['northwind', 'globex']);
    });

    test('without a tenant, nothing is asked', async () => {
        const { asked, tenants } = recordingTenants();

        useTenantAccount(ref(''), ref(serving()), tenants);
        await settle();

        assert.deepEqual(asked, []);
    });

    test('a read that fails leaves an error and no account', async () => {
        const { tenants } = recordingTenants(async () => {
            throw new Error('offline');
        });

        const account = useTenantAccount(ref('northwind'), ref(serving()), tenants);
        await settle();

        assert.equal(account.data.value, null);
        assert.ok(account.error.value);
    });
});
