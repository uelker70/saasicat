// The four descriptors the PLATFORM ships but does not serve.
//
// Pilots, SMTP providers, the send log and one promo-code detail view are
// answered by the consuming app's backend. The platform ships the pages, so it
// has to name the paths those pages call — otherwise every app writes the same
// seven, five, four and one callbacks again, which is exactly what they did.
//
// `resources-match-the-composables.test.js` cannot cover these: it works by
// driving a descriptor and a second implementation of the same contract and
// comparing the requests, and here there IS no second implementation. That is
// not a reason to leave them unmeasured — it is a reason to measure them
// differently. This file pins the request each operation issues, because that
// request IS the contract an app implements against.
//
// The expectations are not invented. They are the paths the consumers call
// today, read off their own pages before these descriptors existed:
//
//   vereinsfux  /api/v1/admin/pilots, /pilots/review, /pilots/create,
//               /pilots/:slug, /pilots/:slug/extend, /pilots/:slug/revoke
//               /api/v1/admin/platform-email/providers
//               /api/v1/admin/platform-email/history
//               /api/v1/admin/users/:id/reset-password, /users/:id/deactivate
//
// Changing one of these breaks an app the platform cannot see. That is what
// makes them worth a test rather than a comment.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    createResourceRegistry,
    dashboardResource,
    emailHistoryResource,
    pilotsResource,
    platformEmailResource,
    promoCodesResource,
    usersResource,
} from '../dist/index.js';

const CTX = { apiBase: '/api/v1/admin', locale: 'en' };

function recordingHttp(body = {}) {
    const calls = [];
    const http = (url, init) => {
        calls.push({
            url,
            method: init?.method ?? 'GET',
            body: init?.body,
            headers: init?.headers,
        });
        return Promise.resolve({
            status: 200,
            headers: { get: () => null },
            json: async () => body,
            text: async () => '{}',
        });
    };
    return { http, calls };
}

function bind(def, body) {
    const { http, calls } = recordingHttp(body);
    const registry = createResourceRegistry({ http, context: CTX, resources: { it: def } });
    return { ops: registry.get('it'), calls };
}

describe('pilotsResource — the paths a consumer already serves', () => {
    const CASES = [
        { op: 'list', run: (o) => o.list(), url: '/api/v1/admin/pilots', method: 'GET' },
        {
            op: 'reviewSoon',
            run: (o) => o.reviewSoon(),
            url: '/api/v1/admin/pilots/review',
            method: 'GET',
        },
        {
            op: 'create',
            run: (o) => o.create({ tenant: { name: 'Acme' } }),
            url: '/api/v1/admin/pilots/create',
            method: 'POST',
            body: { tenant: { name: 'Acme' } },
        },
        {
            op: 'update',
            // A slug with a slash in it would otherwise open a path the caller
            // did not ask for, which is why every id here is encoded.
            run: (o) => o.update('a/b', { plan: 'PRO' }),
            url: '/api/v1/admin/pilots/a%2Fb',
            method: 'PATCH',
            body: { plan: 'PRO' },
        },
        {
            op: 'extend',
            run: (o) => o.extend('acme', '2026-12-31'),
            url: '/api/v1/admin/pilots/acme/extend',
            method: 'POST',
            body: { until: '2026-12-31' },
        },
        {
            op: 'revoke',
            run: (o) => o.revoke('acme'),
            url: '/api/v1/admin/pilots/acme/revoke',
            method: 'POST',
        },
    ];

    for (const c of CASES) {
        test(`${c.op} calls ${c.method} ${c.url}`, async () => {
            const { ops, calls } = bind(pilotsResource, { slug: 'acme' });
            await c.run(ops);
            assert.equal(calls.length, 1);
            assert.equal(calls[0].url, c.url);
            assert.equal(calls[0].method, c.method);
            // The body goes out serialised — `requestJson` stringifies it, so
            // comparing against an object would compare a string to one and
            // pass only because `deepEqual` was never reached.
            if (c.body) assert.deepEqual(JSON.parse(calls[0].body), c.body);
        });
    }

    test('every operation this descriptor declares has a case above', () => {
        assert.deepEqual(Object.keys(pilotsResource.ops).sort(), CASES.map((c) => c.op).sort());
    });
});

describe('platformEmailResource and emailHistoryResource', () => {
    const PROVIDERS = '/api/v1/admin/platform-email/providers';
    const HISTORY = '/api/v1/admin/platform-email/history';

    const PROVIDER_CASES = [
        { op: 'list', run: (o) => o.list(), url: PROVIDERS, method: 'GET' },
        {
            op: 'create',
            run: (o) => o.create({ name: 'SMTP' }),
            url: PROVIDERS,
            method: 'POST',
            body: { name: 'SMTP' },
        },
        {
            op: 'update',
            run: (o) => o.update('p1', { name: 'SMTP' }),
            url: `${PROVIDERS}/p1`,
            method: 'PATCH',
            body: { name: 'SMTP' },
        },
        { op: 'remove', run: (o) => o.remove('p1'), url: `${PROVIDERS}/p1`, method: 'DELETE' },
        {
            op: 'test',
            run: (o) => o.test('p1', { toEmail: 'a@b.c' }),
            url: `${PROVIDERS}/p1/test`,
            method: 'POST',
            body: { toEmail: 'a@b.c' },
        },
    ];

    const HISTORY_CASES = [
        {
            op: 'list',
            // The six the page sends, and no others: a descriptor that invented
            // a seventh would drop one of these instead.
            run: (o) => o.list({ search: 'a b', status: 'SENT', from: '2026-01-01', limit: 25 }),
            url: `${HISTORY}?search=a+b&status=SENT&from=2026-01-01&limit=25`,
            method: 'GET',
        },
        { op: 'detail', run: (o) => o.detail('e1'), url: `${HISTORY}/e1`, method: 'GET' },
        { op: 'remove', run: (o) => o.remove('e1'), url: `${HISTORY}/e1`, method: 'DELETE' },
        {
            op: 'resend',
            run: (o) => o.resend('e1'),
            url: `${HISTORY}/e1/resend`,
            method: 'POST',
        },
    ];

    for (const [def, cases, name] of [
        [platformEmailResource, PROVIDER_CASES, 'platformEmail'],
        [emailHistoryResource, HISTORY_CASES, 'emailHistory'],
    ]) {
        for (const c of cases) {
            test(`${name}.${c.op} calls ${c.method} ${c.url}`, async () => {
                const { ops, calls } = bind(def, { rows: [], total: 0 });
                await c.run(ops);
                assert.equal(calls.length, 1);
                assert.equal(calls[0].url, c.url);
                assert.equal(calls[0].method, c.method);
                // The body goes out serialised — `requestJson` stringifies it, so
                // comparing against an object would compare a string to one and
                // pass only because `deepEqual` was never reached.
                if (c.body) assert.deepEqual(JSON.parse(calls[0].body), c.body);
            });
        }

        test(`${name}: every operation has a case above`, () => {
            assert.deepEqual(Object.keys(def.ops).sort(), cases.map((c) => c.op).sort());
        });
    }
});

describe('the second factor travels as a header, and only when there is one', () => {
    // `''` is what the flows pass when MFA is off. Sending `X-Mfa-Code:` empty
    // made a backend that checks for the header's PRESENCE reject a request
    // that was never guarded — so absence has to mean absence.
    const CASES = [
        ['pilots.create', pilotsResource, (o) => o.create({}, 'X'), (o) => o.create({}, '')],
        ['pilots.revoke', pilotsResource, (o) => o.revoke('a', 'X'), (o) => o.revoke('a', '')],
        [
            'platformEmail.remove',
            platformEmailResource,
            (o) => o.remove('p', 'X'),
            (o) => o.remove('p', ''),
        ],
        [
            'emailHistory.resend',
            emailHistoryResource,
            (o) => o.resend('e', 'X'),
            (o) => o.resend('e', ''),
        ],
        [
            'users.deactivate',
            usersResource,
            (o) => o.deactivate('u', 'why', 'X'),
            (o) => o.deactivate('u', 'why', ''),
        ],
    ];

    for (const [name, def, withCode, withoutCode] of CASES) {
        test(`${name} sends the header with a code`, async () => {
            const { ops, calls } = bind(def, {});
            await withCode(ops);
            assert.equal(calls[0].headers?.['X-Mfa-Code'], 'X');
        });

        test(`${name} sends no header for an empty code`, async () => {
            const { ops, calls } = bind(def, {});
            await withoutCode(ops);
            assert.equal(calls[0].headers?.['X-Mfa-Code'], undefined);
        });
    }
});

describe('the two operations the platform ships but does not serve', () => {
    test('users.resetPassword posts the audit reason', async () => {
        const { ops, calls } = bind(usersResource, {});
        await ops.resetPassword('u1', 'locked out');
        assert.equal(calls[0].url, '/api/v1/admin/users/u1/reset-password');
        assert.equal(calls[0].method, 'POST');
        assert.deepEqual(JSON.parse(calls[0].body), { reason: 'locked out' });
    });

    test('promoCodes.detail reads one code by id', async () => {
        const { ops, calls } = bind(promoCodesResource, {});
        await ops.detail('a/b');
        assert.equal(calls[0].url, '/api/v1/admin/promo-codes/a%2Fb');
        assert.equal(calls[0].method, 'GET');
    });
});

describe('dashboardResource — the endpoint comes from the card, not from us', () => {
    // The one descriptor whose URL the platform does not choose. A card in the
    // admin manifest carries its own `endpoint`, which is how an app puts its
    // own numbers on the dashboard; a descriptor that composed a path from
    // `apiBase` would quietly ignore that field for every app that set it.
    const card = (endpoint) => ({
        id: 'tenants',
        label: 'Tenants',
        endpoint,
        displayHint: { type: 'value' },
    });

    test('reads exactly the endpoint the card declares', async () => {
        const { ops, calls } = bind(dashboardResource, { value: 7 });
        await ops.kpi(card('/api/custom/metrics/tenants'));
        assert.equal(calls[0].url, '/api/custom/metrics/tenants');
        assert.equal(calls[0].method, 'GET');
    });

    test('a reading, not a rendering — the timestamp comes back unformatted', async () => {
        const { ops } = bind(dashboardResource, {
            count: 42,
            timestamp: '2026-08-22T10:00:00.000Z',
            delta: -3,
        });
        assert.deepEqual(await ops.kpi(card('/x')), {
            value: 42,
            timestamp: '2026-08-22T10:00:00.000Z',
            delta: -3,
            sub: undefined,
        });
    });

    test('a body with no recognised number reads as null, not as a failure', async () => {
        const { ops } = bind(dashboardResource, { unrelated: 'shape' });
        const reading = await ops.kpi(card('/x'));
        assert.equal(reading.value, null);
    });
});
