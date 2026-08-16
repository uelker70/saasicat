// The descriptors request exactly what the composables request.
//
// `usePlans` and `usePlanVersions` had no test at all — and they own twelve of
// the package's endpoints. Rebuilding them on the descriptors is meant to
// change nothing, but "meant to" is not a check, and the suite that would have
// caught a changed URL did not exist.
//
// So rather than assert a hand-written list of expected URLs twice, this drives
// both implementations with the same arguments and compares what each one puts
// on the wire. It fails if they ever disagree — in either direction, whichever
// side moved.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    bindResource,
    planVersionsResource,
    plansResource,
    usePlanVersions,
    usePlans,
} from '../dist/index.js';

const ADMIN_ENDPOINT = '/api/v1/admin';
const PROJECT_KEY = 'demo app';
const PLAN_ID = 'plan-1';
const VERSION_ID = 'version-9';

/** Answers everything with a body rich enough that no operation bails early. */
function recorder() {
    const calls = [];
    const http = (url, init) => {
        calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
        return Promise.resolve({
            status: 200,
            headers: { get: () => null },
            json: async () => ({ id: 'x', planVersion: { id: VERSION_ID }, warnings: [] }),
            text: async () => '{}',
        });
    };
    return { http, calls };
}

/** What the composable put on the wire for one call. */
async function viaComposable(build) {
    const { http, calls } = recorder();
    await build(http);
    return calls;
}

/** What the descriptor put on the wire for the same call. */
async function viaResource(def, op, args) {
    const { http, calls } = recorder();
    const ctx = { apiBase: ADMIN_ENDPOINT, projectKey: PROJECT_KEY, locale: 'en' };
    await bindResource(def, http, ctx)[op](...args);
    return calls;
}

function plansComposable(http) {
    return usePlans({
        adminEndpoint: ADMIN_ENDPOINT,
        projectKey: PROJECT_KEY,
        http,
        autoLoad: false,
    });
}

function versionsComposable(http) {
    return usePlanVersions({
        adminEndpoint: ADMIN_ENDPOINT,
        planId: PLAN_ID,
        http,
        autoLoad: false,
    });
}

/** Everything the wire sees, minus the headers both sides set identically. */
function wire(calls) {
    return calls.map(({ url, method, body }) => ({ url, method, body }));
}

const PLAN_CASES = [
    { name: 'list', run: (c) => c.load(), op: 'list', args: [] },
    { name: 'tenantCounts', run: (c) => c.loadTenantCounts(), op: 'tenantCounts', args: [] },
    {
        // The composable makes the caller supply the project; the descriptor
        // takes it from the bound context. Same bytes on the wire — that is
        // the point of comparing here rather than asserting a URL twice.
        name: 'create',
        run: (c) => c.create({ planKey: 'pro', projectKey: PROJECT_KEY }),
        op: 'create',
        args: [{ planKey: 'pro' }],
    },
    {
        name: 'update',
        run: (c) => c.update(PLAN_ID, { name: 'Pro' }),
        op: 'update',
        args: [PLAN_ID, { name: 'Pro' }],
    },
    { name: 'softDelete', run: (c) => c.softDelete(PLAN_ID), op: 'softDelete', args: [PLAN_ID] },
    { name: 'hardDelete', run: (c) => c.hardDelete(PLAN_ID), op: 'hardDelete', args: [PLAN_ID] },
];

const VERSION_CASES = [
    { name: 'listForPlan', run: (c) => c.load(), op: 'listForPlan', args: [PLAN_ID] },
    {
        name: 'createDraft',
        run: (c) => c.createDraft({ version: 2 }),
        op: 'createDraft',
        args: [PLAN_ID, { version: 2 }],
    },
    {
        name: 'updateDraft',
        run: (c) => c.updateDraft(VERSION_ID, { price: 1 }),
        op: 'updateDraft',
        args: [VERSION_ID, { price: 1 }],
    },
    {
        name: 'publish',
        run: (c) => c.publish(VERSION_ID, { changeNote: 'note' }),
        op: 'publish',
        args: [VERSION_ID, { changeNote: 'note' }],
    },
    {
        name: 'discardDraft',
        run: (c) => c.discardDraft(VERSION_ID),
        op: 'discardDraft',
        args: [VERSION_ID],
    },
];

describe('plansResource matches usePlans', () => {
    for (const testCase of PLAN_CASES) {
        test(`${testCase.name} sends the same request`, async () => {
            const fromComposable = await viaComposable((http) =>
                testCase.run(plansComposable(http)),
            );
            const fromResource = await viaResource(plansResource, testCase.op, testCase.args);
            assert.deepEqual(wire(fromResource), wire(fromComposable));
        });
    }
});

describe('planVersionsResource matches usePlanVersions', () => {
    for (const testCase of VERSION_CASES) {
        test(`${testCase.name} sends the same request`, async () => {
            const fromComposable = await viaComposable((http) =>
                testCase.run(versionsComposable(http)),
            );
            const fromResource = await viaResource(
                planVersionsResource,
                testCase.op,
                testCase.args,
            );
            assert.deepEqual(wire(fromResource), wire(fromComposable));
        });
    }
});

describe('the comparison itself', () => {
    test('covers every operation both sides declare', () => {
        // A case list that quietly stopped covering an operation would make
        // this whole file agree about less and less while staying green.
        assert.deepEqual(PLAN_CASES.map((c) => c.op).sort(), Object.keys(plansResource.ops).sort());
        const versionOps = Object.keys(planVersionsResource.ops).sort();
        const covered = VERSION_CASES.map((c) => c.op).sort();
        assert.deepEqual(
            versionOps.filter((op) => op !== 'terminate'),
            covered,
            'every plan-version operation except terminate, which the composable exposes ' +
                'under a different name and is compared separately',
        );
    });

    test('terminate matches too, under the composable’s own name', async () => {
        const fromComposable = await viaComposable((http) =>
            versionsComposable(http).terminateVersion(VERSION_ID, '2026-01-01'),
        );
        const fromResource = await viaResource(planVersionsResource, 'terminate', [
            VERSION_ID,
            '2026-01-01',
        ]);
        assert.deepEqual(wire(fromResource), wire(fromComposable));
    });
});
