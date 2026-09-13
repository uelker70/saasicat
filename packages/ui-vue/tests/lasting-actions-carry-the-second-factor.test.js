// The shipped administration asks for the second factor before the lasting
// actions the platform's own routes guard, and sends it with the request.
//
// Two halves, both against `dist/`. The requests: every descriptor, composable
// and client function that reaches one of those routes puts the code in the
// header when it has one, and nothing when it does not — an empty header is
// refused by a backend that checks for its presence. And the dialog loop the
// pages share: a refused code keeps the dialog open and says so, anything else
// ends it.

// @requirement SC-SEC-013 — The platform's own routes with lasting consequences check the second factor themselves

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    AdminError,
    MFA_CODE_HEADER,
    bundleVersionsResource,
    createAdminResourceClient,
    createResourceRegistry,
    planVersionsResource,
    plansResource,
    tenantsResource,
    useBundleVersions,
    useMfaPrompt,
    usePlanVersions,
    usePlans,
} from '../dist/index.js';

const CODE = '123456';
const CTX = { apiBase: '/api/v1/admin', locale: 'en' };

function recordingHttp() {
    const calls = [];
    const http = (url, init) => {
        calls.push({ url, method: init?.method ?? 'GET', headers: init?.headers ?? {} });
        return Promise.resolve({
            status: 200,
            headers: { get: () => null },
            json: async () => ({ planVersion: { id: 'v' }, bundleVersion: { id: 'v' }, id: 'v' }),
            text: async () => '{}',
        });
    };
    return { http, calls };
}

function viaResource(def) {
    return (http) =>
        createResourceRegistry({ http, context: CTX, resources: { it: def } }).get('it');
}

/**
 * Each case names the route it reaches and calls it once with the code given.
 * The route is asserted too, so a case that drifted onto another request
 * cannot pass by finding a header there.
 */
const CASES = [
    {
        name: 'plansResource.hardDelete',
        route: 'DELETE /api/v1/admin/catalog/plans/p/purge',
        call: (http, code) => viaResource(plansResource)(http).hardDelete('p', code),
    },
    {
        name: 'planVersionsResource.publish',
        route: 'POST /api/v1/admin/catalog/plan-versions/v/publish',
        call: (http, code) => viaResource(planVersionsResource)(http).publish('v', {}, code),
    },
    {
        name: 'planVersionsResource.terminate',
        route: 'POST /api/v1/admin/catalog/plan-versions/v/terminate',
        call: (http, code) =>
            viaResource(planVersionsResource)(http).terminate('v', '2027-01-01', code),
    },
    {
        name: 'bundleVersionsResource.publish',
        route: 'POST /api/v1/admin/catalog/bundle-versions/v/publish',
        call: (http, code) => viaResource(bundleVersionsResource)(http).publish('v', {}, code),
    },
    {
        name: 'tenantsResource.suspend',
        route: 'POST /api/v1/admin/tenants/acme/suspend',
        call: (http, code) => viaResource(tenantsResource)(http).suspend('acme', 'why', code),
    },
    {
        name: 'tenantsResource.reactivate',
        route: 'POST /api/v1/admin/tenants/acme/reactivate',
        call: (http, code) => viaResource(tenantsResource)(http).reactivate('acme', code),
    },
    {
        name: 'usePlans().hardDelete',
        route: 'DELETE /api/v1/admin/catalog/plans/p/purge',
        call: (http, code) => usePlans({ adminEndpoint: CTX.apiBase, http }).hardDelete('p', code),
    },
    {
        name: 'usePlanVersions().publish',
        route: 'POST /api/v1/admin/catalog/plan-versions/v/publish',
        call: (http, code) =>
            usePlanVersions({ adminEndpoint: CTX.apiBase, planId: 'p', http }).publish(
                'v',
                {},
                code,
            ),
    },
    {
        name: 'usePlanVersions().terminateVersion',
        route: 'POST /api/v1/admin/catalog/plan-versions/v/terminate',
        call: (http, code) =>
            usePlanVersions({ adminEndpoint: CTX.apiBase, planId: 'p', http }).terminateVersion(
                'v',
                '2027-01-01',
                code,
            ),
    },
    {
        name: 'useBundleVersions().publish',
        route: 'POST /api/v1/admin/catalog/bundle-versions/v/publish',
        call: (http, code) =>
            useBundleVersions({ adminEndpoint: CTX.apiBase, bundleId: 'b', http }).publish(
                'v',
                {},
                code,
            ),
    },
    {
        name: 'createAdminResourceClient().suspendTenant',
        route: 'POST /api/v1/admin/tenants/acme/suspend',
        call: (http, code) =>
            createAdminResourceClient({ http }).suspendTenant('acme', 'why', code),
    },
    {
        name: 'createAdminResourceClient().reactivateTenant',
        route: 'POST /api/v1/admin/tenants/acme/reactivate',
        call: (http, code) => createAdminResourceClient({ http }).reactivateTenant('acme', code),
    },
];

describe('a lasting action carries the code in the header, and only when there is one', () => {
    for (const c of CASES) {
        test(`${c.name} sends it with a code`, async () => {
            const { http, calls } = recordingHttp();
            await c.call(http, CODE);
            const request = calls.find((call) => `${call.method} ${call.url}` === c.route);
            assert.ok(request, `${c.route} was not requested: ${JSON.stringify(calls)}`);
            assert.equal(request.headers[MFA_CODE_HEADER], CODE);
        });

        test(`${c.name} sends no header for an empty code`, async () => {
            const { http, calls } = recordingHttp();
            await c.call(http, '');
            const request = calls.find((call) => `${call.method} ${call.url}` === c.route);
            assert.ok(request, `${c.route} was not requested`);
            assert.equal(MFA_CODE_HEADER in request.headers, false);
        });
    }
});

describe('the dialog loop the pages share', () => {
    const INVALID = 'That code was refused.';
    const refused = () => new AdminError({ message: 'refused', status: 401 });

    test('the action runs with the entered code, and the dialog closes after it', async () => {
        const mfa = useMfaPrompt();
        const seen = [];
        const outcome = mfa.run('Publish v2', INVALID, async (code) => {
            seen.push(code);
            return 'published';
        });
        assert.equal(mfa.show.value, true);
        assert.equal(mfa.description.value, 'Publish v2');
        assert.deepEqual(seen, [], 'the action ran before a code was entered');

        mfa.onConfirm(CODE);
        assert.deepEqual(await outcome, { done: true, value: 'published' });
        assert.deepEqual(seen, [CODE]);
        assert.equal(mfa.show.value, false);
    });

    test('cancelling runs nothing and says so', async () => {
        const mfa = useMfaPrompt();
        let ran = false;
        const outcome = mfa.run('Publish v2', INVALID, async () => {
            ran = true;
        });
        mfa.onVisibility(false);
        assert.deepEqual(await outcome, { done: false });
        assert.equal(ran, false);
    });

    test('a refused code keeps the dialog open, says so, and a second code goes through', async () => {
        const mfa = useMfaPrompt();
        const seen = [];
        const outcome = mfa.run('Suspend acme', INVALID, async (code) => {
            seen.push(code);
            if (code === '000000') throw refused();
            return 'suspended';
        });
        mfa.onConfirm('000000');
        // The loop reopens asynchronously; wait until it has.
        for (let i = 0; i < 10 && seen.length < 1; i += 1) await Promise.resolve();
        for (let i = 0; i < 10; i += 1) await Promise.resolve();

        assert.equal(mfa.show.value, true);
        assert.equal(mfa.error.value, INVALID, 'the refusal was not on the reopened dialog');

        mfa.onConfirm(CODE);
        assert.deepEqual(await outcome, { done: true, value: 'suspended' });
        assert.deepEqual(seen, ['000000', CODE]);
    });

    test('a package error carrying the status counts as a refusal, not only an AdminError', async () => {
        // The plan composables throw their own error class with `status` on it.
        const mfa = useMfaPrompt();
        let attempts = 0;
        const outcome = mfa.run('Purge PRO', INVALID, async () => {
            attempts += 1;
            if (attempts === 1)
                throw Object.assign(new Error('Plans API responded with HTTP 401'), {
                    status: 401,
                });
            return 'purged';
        });
        mfa.onConfirm('000000');
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
        assert.equal(mfa.error.value, INVALID);
        mfa.onConfirm(CODE);
        assert.deepEqual(await outcome, { done: true, value: 'purged' });
    });

    test('any other failure closes the dialog and reaches the caller', async () => {
        const mfa = useMfaPrompt();
        const failure = new AdminError({ message: 'regressive', status: 422 });
        const outcome = mfa.run('Publish v2', INVALID, async () => {
            throw failure;
        });
        mfa.onConfirm(CODE);
        await assert.rejects(outcome, (error) => error === failure);
        assert.equal(mfa.show.value, false);
    });
});
