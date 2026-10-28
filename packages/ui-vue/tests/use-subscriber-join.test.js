// useSubscriberJoin — the operator joins a returning customer's subscriber into
// the one it had: finds the earlier one, reads the preview, and joins them
// behind the second factor. Offered only where the platform serves it.

// @requirement SC-ADM-027 — An operator joins a returning customer's new tenant to the subscriber it had

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ref } from 'vue';

import { useSubscriberJoin } from '../dist/index.js';

const JOINED = {
    joinedInto: { subscriberId: 's-old', customerNumber: 'K-10045', legalName: 'Muster GmbH' },
};
const INPUT = {
    intoSubscriberId: 's-old',
    reason: 'Returning customer',
    previewDigest: 'f'.repeat(64),
};

const serving = { capabilities: { 'subscribers.read': true, 'subscribers.join': true } };

/** The join of subscriber `s-new`, every call recorded, the second factor answered as `code`. */
function joinOf({ manifest = serving, code = '123456', whilePrompted } = {}) {
    const calls = [];
    const notices = [];
    const joined = [];
    const id = ref('s-new');
    const subscribers = {
        list: async (request) => {
            calls.push(['list', request]);
            return {
                subscribers: [
                    { id: 's-new', customerNumber: 'K-10234', joinedInto: null },
                    { id: 's-old', customerNumber: 'K-10045', joinedInto: null },
                    {
                        id: 's-gone',
                        customerNumber: 'K-10046',
                        joinedInto: { customerNumber: 'K-1' },
                    },
                ],
                next: null,
            };
        },
        previewJoin: async (from, into) => {
            calls.push(['preview', from, into]);
            return { digest: INPUT.previewDigest };
        },
        join: async (from, input, mfaCode) => {
            calls.push(['join', from, input, mfaCode]);
            return JOINED;
        },
    };
    const mfa = {
        async run(description, invalidCode, action) {
            calls.push(['prompt', description]);
            whilePrompted?.(id);
            if (code === null) return { done: false };
            return { done: true, value: await action(code) };
        },
    };
    const join = useSubscriberJoin(id, ref(manifest), subscribers, {
        notify: (kind, message) => notices.push([kind, message]),
        mfa,
        onJoined: (result) => joined.push(result),
    });
    return { join, calls, notices, joined };
}

describe('useSubscriberJoin', () => {
    test('is offered only where the manifest announces joins', () => {
        assert.equal(joinOf().join.available.value, true);
        assert.equal(
            joinOf({ manifest: { capabilities: { 'subscribers.read': true } } }).join.available
                .value,
            false,
        );
        assert.equal(joinOf({ manifest: null }).join.available.value, false);
    });

    test('finds the earlier subscriber among those without a live tenant, never itself or one joined', async () => {
        const { join, calls } = joinOf();

        const candidates = await join.candidates('Muster');

        assert.deepEqual(calls, [['list', { query: 'Muster', withoutLiveTenant: true }]]);
        assert.deepEqual(
            candidates.map((row) => row.id),
            ['s-old'],
        );
    });

    test('previews joining the subscriber on screen into the one chosen', async () => {
        const { join, calls } = joinOf();

        await join.preview('s-old');

        assert.deepEqual(calls, [['preview', 's-new', 's-old']]);
    });

    test('joins behind the second factor, announces where it went, and hands the result on', async () => {
        const { join, calls, notices, joined } = joinOf();

        const result = await join.join(INPUT);

        assert.deepEqual(calls.at(-1), ['join', 's-new', INPUT, '123456']);
        assert.deepEqual(result, JOINED);
        assert.deepEqual(notices, [['positive', 'Joined into K-10045.']]);
        assert.deepEqual(joined, [JOINED]);
    });

    test('writes nothing and announces nothing where the operator steps back from the second factor', async () => {
        const { join, calls, notices, joined } = joinOf({ code: null });

        assert.equal(await join.join(INPUT), null);
        assert.ok(!calls.some(([name]) => name === 'join'), 'it joined anyway');
        assert.deepEqual([notices, joined], [[], []]);
    });

    test('joins the subscriber that was on screen when the prompt opened', async () => {
        const { join, calls } = joinOf({ whilePrompted: (id) => (id.value = 's-other') });

        await join.join(INPUT);

        assert.equal(calls.at(-1)[1], 's-new');
    });
});
