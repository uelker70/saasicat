// useSubscribers — the list of subscribers, searched and narrowed, a page at a
// time; useSubscriberRecord — the head of one record, asked for only where the
// platform serves subscribers.

// @requirement SC-ADM-036 — An operator finds a subscriber by its number, name or VAT number, tenant or not
// @requirement SC-ADM-015 — The administration only offers what the application actually has

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { nextTick, ref } from 'vue';

import { useSubscriberRecord, useSubscribers } from '../dist/index.js';

async function settle() {
    await nextTick();
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

const row = (id) => ({ id, customerNumber: `K-${id}`, legalName: `${id} GmbH`, liveTenant: null });

/** The list operation, every request recorded, answering from `pages` by what it was asked. */
function listing(pages) {
    const asked = [];
    return {
        asked,
        subscribers: {
            list: (request) => {
                asked.push(request);
                return pages(request);
            },
        },
    };
}

describe('useSubscribers', () => {
    test('reads every subscriber at once', async () => {
        const { asked, subscribers } = listing(async () => ({
            subscribers: [row('1')],
            next: null,
        }));

        const list = useSubscribers(subscribers);
        await settle();

        assert.deepEqual(asked, [{ query: '', withoutLiveTenant: false }]);
        assert.deepEqual(
            list.rows.value.map(({ id }) => id),
            ['1'],
        );
        assert.equal(list.hasMore.value, false);
    });

    test('a search typed reads the list again from its first page', async () => {
        const { asked, subscribers } = listing(async ({ after }) =>
            after
                ? { subscribers: [row('2')], next: null }
                : { subscribers: [row('1')], next: '1' },
        );
        const list = useSubscribers(subscribers);
        await settle();
        await list.more();

        list.query.value = 'Muster';
        await settle();

        assert.deepEqual(asked.at(-1), { query: 'Muster', withoutLiveTenant: false });
        assert.deepEqual(
            list.rows.value.map(({ id }) => id),
            ['1'],
            'the page read for the earlier search is gone',
        );
    });

    test('narrowed to those without a live tenant, asks for exactly those', async () => {
        const { asked, subscribers } = listing(async () => ({ subscribers: [], next: null }));
        const list = useSubscribers(subscribers);
        await settle();

        list.withoutLiveTenant.value = true;
        await settle();

        assert.deepEqual(asked.at(-1), { query: '', withoutLiveTenant: true });
    });

    test('the next page is added after the last subscriber read', async () => {
        const { asked, subscribers } = listing(async ({ after }) =>
            after === '1'
                ? { subscribers: [row('2')], next: null }
                : { subscribers: [row('1')], next: '1' },
        );
        const list = useSubscribers(subscribers);
        await settle();
        assert.equal(list.hasMore.value, true);

        await list.more();

        assert.deepEqual(asked.at(-1), { query: '', withoutLiveTenant: false, after: '1' });
        assert.deepEqual(
            list.rows.value.map(({ id }) => id),
            ['1', '2'],
        );
        assert.equal(list.hasMore.value, false);
    });

    test('a page read for a search no longer asked is dropped', async () => {
        let release;
        const { subscribers } = listing(({ after }) =>
            after
                ? new Promise((resolve) => {
                      release = () => resolve({ subscribers: [row('late')], next: null });
                  })
                : Promise.resolve({ subscribers: [row('1')], next: '1' }),
        );
        const list = useSubscribers(subscribers);
        await settle();

        const later = list.more();
        list.query.value = 'Muster';
        await settle();
        release();
        await later;

        assert.ok(!list.rows.value.some(({ id }) => id === 'late'));
    });

    test('a page on its way when the list is read again is dropped', async () => {
        let release;
        const { subscribers } = listing(({ after }) =>
            after
                ? new Promise((resolve) => {
                      release = () => resolve({ subscribers: [row('late')], next: null });
                  })
                : Promise.resolve({ subscribers: [row('1')], next: '1' }),
        );
        const list = useSubscribers(subscribers);
        await settle();

        const later = list.more();
        await list.reload();
        release();
        await later;

        assert.deepEqual(
            list.rows.value.map(({ id }) => id),
            ['1'],
            'the page continued a list no longer shown',
        );
    });

    test('two calls for the next page add it once', async () => {
        const { subscribers } = listing(async ({ after }) =>
            after === '1'
                ? { subscribers: [row('2')], next: null }
                : { subscribers: [row('1')], next: '1' },
        );
        const list = useSubscribers(subscribers);
        await settle();

        await Promise.all([list.more(), list.more()]);

        assert.deepEqual(
            list.rows.value.map(({ id }) => id),
            ['1', '2'],
        );
    });

    test('a next page that fails after the list was read again is not that list’s error', async () => {
        let fail;
        const { subscribers } = listing(({ after }) =>
            after
                ? new Promise((_, reject) => {
                      fail = () => reject(new Error('offline'));
                  })
                : Promise.resolve({ subscribers: [row('1')], next: '1' }),
        );
        const list = useSubscribers(subscribers);
        await settle();

        const later = list.more();
        await list.reload();
        fail();
        await later;

        assert.equal(list.error.value, null);
    });

    test('a next page that fails is shown as the list’s error, not thrown', async () => {
        const { subscribers } = listing(async ({ after }) => {
            if (after) throw new Error('offline');
            return { subscribers: [row('1')], next: '1' };
        });
        const list = useSubscribers(subscribers);
        await settle();

        await list.more();

        assert.ok(list.error.value);
        assert.deepEqual(
            list.rows.value.map(({ id }) => id),
            ['1'],
        );
    });
});

describe('useSubscriberRecord', () => {
    const RECORD = { subscriber: { id: 's-1' }, readiness: null, tenants: [] };
    const serving = (capability = true) => ({ capabilities: { 'subscribers.read': capability } });

    function recording() {
        const asked = [];
        return {
            asked,
            subscribers: {
                record: async (id) => {
                    asked.push(id);
                    return RECORD;
                },
            },
        };
    }

    test('where subscribers are served, the record is read for the subscriber on screen', async () => {
        const { asked, subscribers } = recording();
        const id = ref('s-1');

        const record = useSubscriberRecord(id, ref(serving()), subscribers);
        await settle();
        id.value = 's-2';
        await settle();

        assert.equal(record.available.value, true);
        assert.deepEqual(asked, ['s-1', 's-2']);
        assert.deepEqual(record.data.value, RECORD);
    });

    for (const [label, manifest] of [
        ['no manifest', null],
        ['a manifest without the capability', { capabilities: {} }],
        ['a manifest that sets it to false', serving(false)],
    ]) {
        test(`with ${label}, nothing is asked`, async () => {
            const { asked, subscribers } = recording();

            const record = useSubscriberRecord(ref('s-1'), ref(manifest), subscribers);
            await settle();

            assert.equal(record.available.value, false);
            assert.deepEqual(asked, []);
            assert.equal(record.data.value, null);
        });
    }

    test('without a subscriber, nothing is asked', async () => {
        const { asked, subscribers } = recording();

        useSubscriberRecord(ref(''), ref(serving()), subscribers);
        await settle();

        assert.deepEqual(asked, []);
    });
});
