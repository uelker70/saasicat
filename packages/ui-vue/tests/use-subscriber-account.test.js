// useSubscriberAccount — a subscriber's account in its record, asked for only
// where the platform serves it.

// @requirement SC-ADM-037 — An operator reads a subscriber's charges in its record
// @requirement SC-ADM-015 — The administration only offers what the application actually has

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { nextTick, ref } from 'vue';

import { useSubscriberAccount } from '../dist/index.js';

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

function recordingSubscribers(answer = async () => ACCOUNT) {
    const asked = [];
    return {
        asked,
        subscribers: {
            charges: (id) => {
                asked.push(id);
                return answer(id);
            },
        },
    };
}

describe('useSubscriberAccount', () => {
    test('where the manifest announces the account, it is read for the subscriber', async () => {
        const { asked, subscribers } = recordingSubscribers();

        const account = useSubscriberAccount(ref('s1'), ref(serving()), subscribers);
        await settle();

        assert.equal(account.available.value, true);
        assert.deepEqual(asked, ['s1']);
        assert.deepEqual(account.data.value, ACCOUNT);
    });

    for (const [label, manifest] of [
        ['no manifest', null],
        ['a manifest without the capability', { capabilities: {} }],
        ['a manifest that sets it to false', serving(false)],
    ]) {
        test(`with ${label}, nothing is asked and nothing is shown`, async () => {
            const { asked, subscribers } = recordingSubscribers();

            const account = useSubscriberAccount(ref('s1'), ref(manifest), subscribers);
            await settle();

            assert.equal(account.available.value, false);
            assert.deepEqual(asked, []);
            assert.equal(account.data.value, null);
        });
    }

    test('a manifest that arrives later brings the account with it', async () => {
        const { asked, subscribers } = recordingSubscribers();
        const manifest = ref(null);

        const account = useSubscriberAccount(ref('s1'), manifest, subscribers);
        await settle();
        manifest.value = serving();
        await settle();

        assert.deepEqual(asked, ['s1']);
        assert.deepEqual(account.data.value, ACCOUNT);
    });

    test('another subscriber is another account', async () => {
        const { asked, subscribers } = recordingSubscribers();
        const id = ref('s1');

        useSubscriberAccount(id, ref(serving()), subscribers);
        await settle();
        id.value = 's2';
        await settle();

        assert.deepEqual(asked, ['s1', 's2']);
    });

    test('without a subscriber, nothing is asked', async () => {
        const { asked, subscribers } = recordingSubscribers();

        useSubscriberAccount(ref(''), ref(serving()), subscribers);
        await settle();

        assert.deepEqual(asked, []);
    });

    test('a read that fails leaves an error and no account', async () => {
        const { subscribers } = recordingSubscribers(async () => {
            throw new Error('offline');
        });

        const account = useSubscriberAccount(ref('s1'), ref(serving()), subscribers);
        await settle();

        assert.equal(account.data.value, null);
        assert.ok(account.error.value);
    });
});
