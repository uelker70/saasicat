// useTenantCredits — the operator reads a tenant's credits, and records a
// payout against one behind the second factor. Offered only where the
// platform serves it.

// @requirement SC-PRIC-083 — A credit is paid out by the operator, and never offset against a later invoice
// @requirement SC-ADM-015 — The administration only offers what the application actually has

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { nextTick, ref } from 'vue';

import { useTenantCredits } from '../dist/index.js';

async function settle() {
    await nextTick();
    await Promise.resolve();
    await Promise.resolve();
}

const CREDITS = { credits: [{ id: 'credit-1', open: 40 }] };
const PAYOUT = { amount: 40, reference: 'TRF-2026-0042', paidOn: '2026-03-03', note: null };

const serving = (capabilities) => ({ capabilities });

/**
 * The credits of tenant `wien`, every call recorded, the second factor
 * answered as `code` — after `whilePrompted` has run, as whatever the operator
 * does while the prompt is open.
 */
function creditsOf({
    manifest = serving({ 'credits.read': true, 'credits.payout': true }),
    code = '123456',
    failWith,
    whilePrompted,
} = {}) {
    const calls = [];
    const notices = [];
    const tenants = {
        credits: async (slug) => {
            calls.push(['credits', slug]);
            return CREDITS;
        },
        recordPayout: async (slug, creditId, payout, mfaCode) => {
            calls.push(['payout', slug, creditId, payout, mfaCode]);
            if (failWith) throw failWith;
            return CREDITS;
        },
    };
    const slug = ref('wien');
    const mfa = {
        async run(_description, _invalidCode, action) {
            whilePrompted?.(slug);
            if (code === null) return { done: false };
            return { done: true, value: await action(code) };
        },
    };
    const credits = useTenantCredits(slug, ref(manifest), tenants, {
        notify: (kind, message) => notices.push([kind, message]),
        mfa,
    });
    return { credits, calls, notices, slug };
}

describe('the credits of a tenant', () => {
    test('are read where the platform serves them', async () => {
        const { credits, calls } = creditsOf();
        await settle();

        assert.equal(credits.available.value, true);
        assert.equal(credits.canPayOut.value, true);
        assert.deepEqual(credits.data.value, CREDITS);
        assert.deepEqual(calls, [['credits', 'wien']]);
    });

    test('are neither read nor offered where it does not, and a payout only with both', async () => {
        const without = creditsOf({ manifest: serving({}) });
        const readOnly = creditsOf({ manifest: serving({ 'credits.read': true }) });
        const payoutOnly = creditsOf({ manifest: serving({ 'credits.payout': true }) });
        await settle();

        assert.equal(without.credits.available.value, false);
        assert.deepEqual(without.calls, []);
        assert.equal(readOnly.credits.canPayOut.value, false);
        assert.equal(payoutOnly.credits.canPayOut.value, false);
    });
});

describe('a payout', () => {
    test('is recorded behind the second factor, announced, and the credits read again', async () => {
        const { credits, calls, notices } = creditsOf();
        await settle();

        const answer = await credits.payOut('credit-1', PAYOUT);

        assert.deepEqual(answer, CREDITS);
        assert.deepEqual(calls.slice(1), [
            ['payout', 'wien', 'credit-1', PAYOUT, '123456'],
            ['credits', 'wien'],
        ]);
        assert.equal(notices.length, 1);
        assert.equal(notices[0][0], 'positive');
    });

    test('where the operator steps back from the second factor records nothing and answers null', async () => {
        const { credits, calls, notices } = creditsOf({ code: null });
        await settle();

        assert.equal(await credits.payOut('credit-1', PAYOUT), null);
        assert.deepEqual(calls, [['credits', 'wien']]);
        assert.deepEqual(notices, []);
    });

    test('that fails rejects, so the dialog keeps the form, and announces nothing', async () => {
        const { credits, notices } = creditsOf({ failWith: new Error('exceeds the credit') });
        await settle();

        await assert.rejects(credits.payOut('credit-1', PAYOUT), /exceeds the credit/);
        assert.deepEqual(notices, []);
    });

    test('belongs to the tenant it was asked on, even if the page moved on meanwhile', async () => {
        const { credits, calls } = creditsOf({ whilePrompted: (slug) => (slug.value = 'graz') });
        await settle();

        await credits.payOut('credit-1', PAYOUT);

        assert.deepEqual(calls[1], ['payout', 'wien', 'credit-1', PAYOUT, '123456']);
    });
});
