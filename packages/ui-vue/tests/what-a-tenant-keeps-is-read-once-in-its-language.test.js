// What a tenant in its read-only period keeps for obligations of its own
// (`SC-PRIV-022`): read once a page knows an end holds the tenant to reading,
// not with every read of its state, and worded in the reader's language with
// English as the fallback (`SC-LANG-005`).

import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { effectScope, nextTick, ref } from 'vue';

import { keepLineLabel, useTenantKeep } from '../dist/index.js';

const scopes = [];
afterEach(() => {
    for (const scope of scopes.splice(0)) scope.stop();
});

async function settled() {
    for (let i = 0; i < 6; i += 1) {
        await nextTick();
        await Promise.resolve();
    }
}

const LINES = [
    { category: 'receipts', count: 412, labels: { en: 'Receipts', de: 'Belege' } },
    { category: 'contracts', count: 37, labels: { en: 'Sales contracts' } },
];

const reason = (kind) => ({
    kind,
    since: '2026-11-01',
    invoiceNumber: null,
    readOnlyUntil: kind === 'ended' ? '2026-11-30' : null,
    deletesOn: kind === 'ended' ? '2026-12-01' : null,
    deletionDue: kind === 'ended' ? false : null,
});

/** The tenant's state as `GET billing/access` answers it, held back for `kinds`. */
const viewOf = (state, kinds = []) => ({
    state,
    reasons: kinds.map(reason),
    holdsBillingPermission: false,
    mayPay: false,
    mayExport: false,
    exportDeliveredBy: null,
    mayReturn: false,
});

const READ_ONLY_ENDED = viewOf('read-only', ['ended']);

const answered = (status, body) => ({
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
});

/** What a page reads through a client answering each path with its `[status, body]`. */
function reading(view, answers = { '/billing/access/keep': [200, { keep: LINES }] }, options = {}) {
    const asked = [];
    const http = async (url) => {
        asked.push(url);
        const [status, body] = answers[url] ?? [404, {}];
        return answered(status, body);
    };
    const state = ref(view);
    const scope = effectScope();
    scopes.push(scope);
    const keep = scope.run(() => useTenantKeep({ view: state, http, ...options }));
    return { keep, asked, state };
}

// @requirement SC-PRIV-022 — A tenant is erased by the application's stores, after it was told what to keep
describe('what the tenant keeps, as a page reads it', () => {
    test('read once an end holds the tenant to reading, under the prefix the app gives', async () => {
        const { keep, asked } = reading(
            READ_ONLY_ENDED,
            { '/api/billing/access/keep': [200, { keep: LINES }] },
            { apiPrefix: '/api/billing/' },
        );
        await settled();

        assert.deepEqual(asked, ['/api/billing/access/keep']);
        assert.deepEqual(keep.lines.value, LINES);
        assert.equal(keep.error.value, null);
    });

    test('read as soon as the state, read later, says so', async () => {
        const { keep, asked, state } = reading(null);
        await settled();
        assert.deepEqual(asked, []);

        state.value = READ_ONLY_ENDED;
        await settled();

        assert.deepEqual(asked, ['/billing/access/keep']);
        assert.deepEqual(keep.lines.value, LINES);
    });

    test('not read again when the page reads the state again', async () => {
        const { asked, state } = reading(READ_ONLY_ENDED);
        await settled();

        state.value = viewOf('read-only', ['ended']);
        await settled();
        state.value = viewOf('read-only', ['ended', 'overdue']);
        await settled();

        assert.deepEqual(asked, ['/billing/access/keep']);
    });

    test('not read again when the state leaves the read-only period and comes back to it', async () => {
        const { keep, asked, state } = reading(READ_ONLY_ENDED);
        await settled();

        state.value = viewOf('suspended', ['ended', 'suspended']);
        await settled();
        state.value = viewOf('read-only', ['ended']);
        await settled();

        assert.deepEqual(asked, ['/billing/access/keep']);
        assert.deepEqual(keep.lines.value, LINES, 'the lines read before show again');
    });

    for (const [why, view] of [
        ['open', viewOf('open')],
        ['read-only for an unpaid invoice alone', viewOf('read-only', ['overdue'])],
        ['suspended', viewOf('suspended', ['ended', 'suspended'])],
        ['being deleted', viewOf('deleting', ['ended', 'deleting'])],
    ]) {
        test(`a tenant ${why} is not asked, and shows no lines`, async () => {
            const { keep, asked } = reading(view);
            await settled();

            assert.deepEqual(asked, []);
            assert.equal(keep.lines.value, null);
        });
    }

    test('lines read show no more once the tenant is suspended', async () => {
        const { keep, state } = reading(READ_ONLY_ENDED);
        await settled();
        assert.deepEqual(keep.lines.value, LINES);

        state.value = viewOf('suspended', ['ended', 'suspended']);
        await settled();

        assert.equal(keep.lines.value, null);
    });

    test('where the route is not there, nothing to show and no error', async () => {
        const { keep, asked } = reading(READ_ONLY_ENDED, {});
        await settled();

        assert.deepEqual(asked, ['/billing/access/keep']);
        assert.equal(keep.lines.value, null);
        assert.equal(keep.error.value, null);
    });

    test('where the application gave nothing to show, nothing to show and no error', async () => {
        const { keep } = reading(READ_ONLY_ENDED, {
            '/billing/access/keep': [200, { keep: null }],
        });
        await settled();

        assert.equal(keep.lines.value, null);
        assert.equal(keep.error.value, null);
    });

    test('an answer that is not lines is an error, and nothing is shown', async () => {
        const { keep } = reading(READ_ONLY_ENDED, {
            '/billing/access/keep': [200, { keep: [{ category: 'receipts', count: 412 }] }],
        });
        await settled();

        assert.equal(keep.lines.value, null);
        assert.match(String(keep.error.value?.message), /access\/keep/);
    });

    test('a failure of the server is an error, and nothing is shown', async () => {
        const { keep } = reading(READ_ONLY_ENDED, { '/billing/access/keep': [500, {}] });
        await settled();

        assert.equal(keep.lines.value, null);
        assert.ok(keep.error.value instanceof Error);
    });
});

// @requirement SC-PRIV-022 — A tenant is erased by the application's stores, after it was told what to keep
describe("a line's label, in the reader's language", () => {
    const LABELS = { en: 'Receipts', de: 'Belege', 'de-CH': 'Quittungen' };

    for (const [locale, expected, why] of [
        ['de', 'Belege', 'its own'],
        ['de-CH', 'Quittungen', 'its own, before its language’s'],
        ['de-AT', 'Belege', 'its language’s, where the locale is not named'],
        ['en', 'Receipts', 'English'],
        ['fr', 'Receipts', 'English, where neither is named'],
        ['fr-CA', 'Receipts', 'English, where neither the locale nor its language is named'],
        ['__proto__', 'Receipts', 'English, for a name every object inherits'],
        ['constructor', 'Receipts', 'English, for a name every object inherits'],
    ]) {
        test(`${locale}: ${why}`, () => {
            assert.equal(keepLineLabel(LABELS, locale), expected);
        });
    }
});
