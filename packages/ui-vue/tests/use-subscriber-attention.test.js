// useSubscriberAttention — which tenants of a list hold their subscriber back,
// asked for only where the platform says a tax adapter decides.

// @requirement SC-PRIC-070 — The operator and the tenant see what holds a subscriber's next contract back
// @requirement SC-ADM-015 — The administration only offers what the application actually has

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { nextTick, ref } from 'vue';

import { useSubscriberAttention } from '../dist/index.js';

async function settle() {
    await nextTick();
    await Promise.resolve();
    await Promise.resolve();
}

const MISSING_CITY = { ready: false, missing: ['city'], taxRefusal: null };

const deciding = (capability = true) => ({
    capabilities: { 'subscribers.read': true, 'subscribers.attention': capability },
});

function recordingTenants(answer = async () => [{ tenantId: 't-2', readiness: MISSING_CITY }]) {
    const asked = [];
    return {
        asked,
        tenants: {
            subscriberAttention: (ids) => {
                asked.push([...ids]);
                return answer(ids);
            },
        },
    };
}

describe('useSubscriberAttention', () => {
    test('asks once for the tenants shown, and answers each by its id', async () => {
        const { asked, tenants } = recordingTenants();

        const attention = useSubscriberAttention(ref(['t-1', 't-2']), ref(deciding()), tenants);
        await settle();

        assert.equal(attention.available.value, true);
        assert.deepEqual(asked, [['t-1', 't-2']]);
        assert.deepEqual(attention.of('t-2'), MISSING_CITY);
        assert.equal(attention.of('t-1'), null, 'a tenant the answer left out is not held back');
        assert.equal(attention.of(undefined), null, 'a row without a tenant id');
    });

    for (const [label, manifest] of [
        ['no manifest', null],
        [
            'only the subscriber view, as without a tax adapter',
            { capabilities: { 'subscribers.read': true } },
        ],
        ['the attention set to false', deciding(false)],
    ]) {
        test(`with ${label}, nothing is asked and nobody is held back`, async () => {
            const { asked, tenants } = recordingTenants();

            const attention = useSubscriberAttention(ref(['t-2']), ref(manifest), tenants);
            await settle();

            assert.equal(attention.available.value, false);
            assert.deepEqual(asked, []);
            assert.equal(attention.of('t-2'), null);
        });
    }

    test('an empty list asks nothing', async () => {
        const { asked, tenants } = recordingTenants();

        useSubscriberAttention(ref([]), ref(deciding()), tenants);
        await settle();

        assert.deepEqual(asked, []);
    });

    test('another page of tenants is asked about again', async () => {
        const { asked, tenants } = recordingTenants();
        const ids = ref(['t-1']);

        useSubscriberAttention(ids, ref(deciding()), tenants);
        await settle();
        ids.value = ['t-2', 't-3'];
        await settle();

        assert.deepEqual(asked, [['t-1'], ['t-2', 't-3']]);
    });

    test('a read that fails leaves an error, and nobody marked', async () => {
        const { tenants } = recordingTenants(async () => {
            throw new Error('offline');
        });

        const attention = useSubscriberAttention(ref(['t-2']), ref(deciding()), tenants);
        await settle();

        assert.ok(attention.error.value);
        assert.equal(attention.of('t-2'), null);
    });
});
