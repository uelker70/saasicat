// useSubscriberCorrections — the operator corrects a tenant's subscriber and
// checks its VAT number, behind the second factor where it changes something,
// and reads the history of both. Offered only where the platform serves it.

// @requirement SC-SUB-041 — The operator corrects a subscriber's identity and business status, with a reason
// @requirement SC-ADM-015 — The administration only offers what the application actually has

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { nextTick, ref } from 'vue';

import { useSubscriberCorrections } from '../dist/index.js';

async function settle() {
    await nextTick();
    await Promise.resolve();
    await Promise.resolve();
}

const STANDING = { subscriber: { id: 's-1', legalName: 'Wien GmbH' }, readiness: null };
const HISTORY = [{ kind: 'vat-id-checked', at: '2026-10-06T08:00:00.000Z', vatId: 'ATU1' }];

const serving = (extra = {}) => ({
    capabilities: { 'subscribers.read': true, 'subscribers.correct': true, ...extra },
});

/**
 * The corrections of tenant `wien`, every call recorded, the second factor
 * answered as `code` — after `whilePrompted` has run, as whatever the operator
 * does while the prompt is open.
 */
function correctionsOf({
    manifest = serving(),
    code = '123456',
    answer = {},
    failWith,
    whilePrompted,
} = {}) {
    const calls = [];
    const notices = [];
    const prompts = [];
    let changed = 0;
    const answered = (vatIdCheck = null) => ({ subscriber: STANDING, vatIdCheck });
    const tenants = {
        subscriberHistory: async (slug) => {
            calls.push(['history', slug]);
            return HISTORY;
        },
        correctSubscriberIdentity: async (slug, input, mfaCode) => {
            calls.push(['identity', slug, input, mfaCode]);
            if (failWith) throw failWith;
            return answered(answer.identity);
        },
        changeSubscriberBusinessStatus: async (slug, input, mfaCode) => {
            calls.push(['business', slug, input, mfaCode]);
            return answered();
        },
        checkSubscriberVatId: async (slug) => {
            calls.push(['check', slug]);
            if (failWith) throw failWith;
            return answered(answer.check);
        },
    };
    const slug = ref('wien');
    const mfa = {
        async run(description, invalidCode, action) {
            prompts.push(description);
            whilePrompted?.(slug);
            if (code === null) return { done: false };
            return { done: true, value: await action(code) };
        },
    };
    const corrections = useSubscriberCorrections(slug, ref(manifest), tenants, {
        notify: (kind, message, options) =>
            notices.push(options?.caption ? [kind, message, options.caption] : [kind, message]),
        mfa,
        onChanged: () => {
            changed += 1;
        },
    });
    return {
        corrections,
        calls,
        notices,
        prompts,
        changes: () => changed,
        writes: () => calls.filter(([name]) => name !== 'history'),
    };
}

describe('useSubscriberCorrections', () => {
    test('where the manifest announces the corrections, the history is read for the tenant', async () => {
        const { corrections, calls } = correctionsOf();
        await settle();

        assert.equal(corrections.available.value, true);
        assert.deepEqual(calls, [['history', 'wien']]);
        assert.deepEqual(corrections.history.data.value, HISTORY);
    });

    for (const [label, manifest] of [
        ['no manifest', null],
        ['only the subscriber view', { capabilities: { 'subscribers.read': true } }],
    ]) {
        test(`with ${label}, nothing is offered and nothing is read`, async () => {
            const { corrections, calls } = correctionsOf({ manifest });
            await settle();

            assert.equal(corrections.available.value, false);
            assert.equal(corrections.canCheckVatId.value, false);
            assert.deepEqual(calls, []);
            assert.deepEqual(corrections.history.data.value, []);
        });
    }

    test('a check is offered only where a tax adapter decides', async () => {
        assert.equal(correctionsOf().corrections.canCheckVatId.value, false);
        assert.equal(
            correctionsOf({ manifest: serving({ 'subscribers.attention': true }) }).corrections
                .canCheckVatId.value,
            true,
        );
    });

    test('a correction goes out with the second factor, is announced, and the subscriber and its history are read again', async () => {
        const { corrections, writes, notices, prompts, changes, calls } = correctionsOf();
        await settle();

        const result = await corrections.correctIdentity({
            legalName: 'Wien AG',
            reason: 'Renamed',
        });

        assert.deepEqual(writes(), [
            ['identity', 'wien', { legalName: 'Wien AG', reason: 'Renamed' }, '123456'],
        ]);
        assert.equal(prompts.length, 1);
        assert.deepEqual(notices, [['positive', 'Correction saved.']]);
        assert.equal(changes(), 1);
        assert.equal(calls.filter(([name]) => name === 'history').length, 2);
        assert.deepEqual(result.subscriber, STANDING);
    });

    for (const [found, vatIdCheck, expected] of [
        [
            'valid',
            { completed: true, valid: true, service: 'VIES' },
            ['positive', 'VAT ID is valid (VIES).', 'Correction saved.'],
        ],
        [
            'invalid',
            { completed: true, valid: false, service: 'VIES' },
            [
                'warning',
                'VAT ID is invalid according to VIES. The next contract stays held back until a valid check counts.',
                'Correction saved.',
            ],
        ],
        [
            'unanswered',
            { completed: false, reason: 'VIES timed out.' },
            [
                'warning',
                'VAT ID could not be checked just now (VIES timed out.). Please check again later.',
                'Correction saved.',
            ],
        ],
    ]) {
        // @requirement SC-PRIC-071 — A VAT number the operator corrects or checks is checked, and every outcome kept
        test(`a corrected number the service found ${found} is announced as such, the correction beneath it`, async () => {
            const { corrections, notices } = correctionsOf({ answer: { identity: vatIdCheck } });

            await corrections.correctIdentity({ vatId: 'ATU1', reason: 'New number' });

            assert.deepEqual(notices, [expected]);
        });
    }

    test('stepping back from the second factor writes nothing, announces nothing and answers null', async () => {
        const { corrections, writes, notices, changes } = correctionsOf({ code: null });

        assert.equal(
            await corrections.changeBusinessStatus({ business: true, reason: 'Why' }),
            null,
        );
        assert.deepEqual(writes(), []);
        assert.deepEqual(notices, []);
        assert.equal(changes(), 0);
    });

    test('a correction the server refuses rejects, so the dialog keeps the form and shows why', async () => {
        const refusal = Object.assign(new Error('refused'), { status: 422 });
        const { corrections, notices, changes } = correctionsOf({ failWith: refusal });

        await assert.rejects(
            corrections.correctIdentity({ legalName: 'X', reason: 'Why' }),
            /refused/,
        );
        assert.deepEqual(notices, []);
        assert.equal(changes(), 0);
    });

    for (const [what, correct, input] of [
        ['a correction', 'correctIdentity', { legalName: 'Wien AG', reason: 'Renamed' }],
        ['a change of business status', 'changeBusinessStatus', { business: false, reason: 'x' }],
    ]) {
        test(`${what} goes to the tenant it was confirmed on, though the page moved on during the second factor`, async () => {
            const { corrections, writes } = correctionsOf({
                whilePrompted: (slug) => {
                    slug.value = 'graz';
                },
            });

            await corrections[correct](input);

            assert.deepEqual(
                writes().map(([, slug]) => slug),
                ['wien'],
            );
        });
    }

    test('a change of business status goes out with the second factor and is announced', async () => {
        const { corrections, writes, notices } = correctionsOf();

        await corrections.changeBusinessStatus({ business: false, reason: 'Sole trader' });

        assert.deepEqual(writes(), [
            ['business', 'wien', { business: false, reason: 'Sole trader' }, '123456'],
        ]);
        assert.deepEqual(notices, [['positive', 'Business status saved.']]);
    });

    // @requirement SC-PRIC-071 — A VAT number the operator corrects or checks is checked, and every outcome kept
    test('a check needs no second factor, announces what the service found, and reads again', async () => {
        const { corrections, writes, prompts, notices, changes } = correctionsOf({
            answer: { check: { completed: true, valid: true, service: 'VIES' } },
        });

        await corrections.checkVatId();

        assert.deepEqual(writes(), [['check', 'wien']]);
        assert.deepEqual(prompts, []);
        assert.deepEqual(
            notices,
            [['positive', 'VAT ID is valid (VIES).']],
            'nothing was corrected',
        );
        assert.equal(changes(), 1);
    });

    test('a check that fails is reported, and nothing is read again', async () => {
        const { corrections, notices, changes } = correctionsOf({
            failWith: Object.assign(new Error('Service unavailable'), { status: 503 }),
        });

        await corrections.checkVatId();

        assert.equal(notices.length, 1);
        assert.equal(notices[0][0], 'negative');
        assert.equal(changes(), 0);
    });
});
