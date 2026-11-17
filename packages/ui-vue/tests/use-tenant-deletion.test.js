// useTenantDeletion and useSubscriberDeletions — where a tenant's deletion
// stands, on its page and in its subscriber's record, asked for only where the
// platform serves it. A subject the server does not know answers nothing to
// show: the page that names it says so already.

// @requirement SC-ADM-058 — The operator sees where a tenant's deletion stands
// @requirement SC-ADM-015 — The administration only offers what the application actually has

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { nextTick, ref } from 'vue';

import { AdminError, useSubscriberDeletions, useTenantDeletion } from '../dist/index.js';

/** Lets the `immediate` microtask and any watcher run. */
async function settle() {
    await nextTick();
    await Promise.resolve();
    await Promise.resolve();
}

const DELETION = {
    tenantId: 't-1',
    status: { kind: 'due', deletesOn: '2026-12-01' },
    record: null,
};

const serving = (capability = true) => ({ capabilities: { 'deletions.read': capability } });

const NOT_SERVED = [
    ['no manifest', null],
    ['a manifest with only the subscribers', { capabilities: { 'subscribers.read': true } }],
    ['a manifest that sets it to false', serving(false)],
];

function refusal(status, code) {
    return new AdminError({ status, code, url: '/api/v1/admin/x', method: 'GET' });
}

/** A descriptor that records what it was asked and answers `answer`. */
function recording(op, answer) {
    const asked = [];
    return {
        asked,
        ops: {
            [op]: (subject) => {
                asked.push(subject);
                return answer(subject);
            },
        },
    };
}

describe("useTenantDeletion — on the tenant's page", () => {
    test('where the manifest announces it, it is read for the tenant', async () => {
        const { asked, ops } = recording('deletion', async () => DELETION);

        const deletion = useTenantDeletion(ref('northwind'), ref(serving()), ops);
        await settle();

        assert.equal(deletion.available.value, true);
        assert.deepEqual(asked, ['northwind']);
        assert.deepEqual(deletion.data.value, DELETION);
    });

    for (const [label, manifest] of NOT_SERVED) {
        test(`with ${label}, nothing is asked and nothing is shown`, async () => {
            const { asked, ops } = recording('deletion', async () => DELETION);

            const deletion = useTenantDeletion(ref('northwind'), ref(manifest), ops);
            await settle();

            assert.equal(deletion.available.value, false);
            assert.deepEqual(asked, []);
            assert.equal(deletion.data.value, null);
        });
    }

    test('another tenant is another deletion, and no tenant asks nothing', async () => {
        const { asked, ops } = recording('deletion', async () => DELETION);
        const slug = ref('northwind');

        useTenantDeletion(slug, ref(serving()), ops);
        await settle();
        slug.value = 'globex';
        await settle();
        slug.value = '';
        await settle();

        assert.deepEqual(asked, ['northwind', 'globex']);
    });

    test('a tenant the server does not know shows nothing, and no error', async () => {
        const { ops } = recording('deletion', async () => {
            throw refusal(404, 'TENANT_NOT_FOUND');
        });

        const deletion = useTenantDeletion(ref('gone'), ref(serving()), ops);
        await settle();

        assert.equal(deletion.data.value, null);
        assert.equal(deletion.error.value, null);
    });

    for (const [why, error] of [
        ['a 404 that names no unknown tenant', refusal(404, undefined)],
        ['a server error', refusal(500, 'INTERNAL')],
        ['a request that never left', new Error('offline')],
    ]) {
        test(`${why} is an error, with nothing shown`, async () => {
            const { ops } = recording('deletion', async () => {
                throw error;
            });

            const deletion = useTenantDeletion(ref('northwind'), ref(serving()), ops);
            await settle();

            assert.equal(deletion.data.value, null);
            assert.ok(deletion.error.value);
        });
    }
});

describe("useSubscriberDeletions — in the subscriber's record", () => {
    test("where the manifest announces it, the deletions of the subscriber's tenants are read", async () => {
        const { asked, ops } = recording('deletions', async () => [DELETION]);

        const deletions = useSubscriberDeletions(ref('s-1'), ref(serving()), ops);
        await settle();

        assert.equal(deletions.available.value, true);
        assert.deepEqual(asked, ['s-1']);
        assert.deepEqual(deletions.data.value, [DELETION]);
    });

    for (const [label, manifest] of NOT_SERVED) {
        test(`with ${label}, nothing is asked and none is shown`, async () => {
            const { asked, ops } = recording('deletions', async () => [DELETION]);

            const deletions = useSubscriberDeletions(ref('s-1'), ref(manifest), ops);
            await settle();

            assert.equal(deletions.available.value, false);
            assert.deepEqual(asked, []);
            assert.deepEqual(deletions.data.value, []);
        });
    }

    test('a subscriber the server does not know shows none, and no error', async () => {
        const { ops } = recording('deletions', async () => {
            throw refusal(404, 'SUBSCRIBER_NOT_FOUND');
        });

        const deletions = useSubscriberDeletions(ref('gone'), ref(serving()), ops);
        await settle();

        assert.deepEqual(deletions.data.value, []);
        assert.equal(deletions.error.value, null);
    });

    test('a read that fails otherwise is an error, with none shown', async () => {
        const { ops } = recording('deletions', async () => {
            throw refusal(404, 'TENANT_NOT_FOUND');
        });

        const deletions = useSubscriberDeletions(ref('s-1'), ref(serving()), ops);
        await settle();

        assert.deepEqual(deletions.data.value, []);
        assert.ok(deletions.error.value);
    });
});
