// useTenantActionFlow — tests for the action-flow orchestration.
//
// Focus: guarantees that Confirm + MFA run in the correct order before
// handler dispatch, and that aborting at any step stops the flow cleanly
// (no handler call, no notify).
//
// Vue's `app.mount()` needs a full `window`, which we don't want to set up
// here. Instead `app.runWithContext()`, analogous to
// project-page-host.test.js — the composable also works without a mount,
// as long as an inject scope exists.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, ref } from 'vue';
import { useTenantActionFlow, SUPER_ADMIN_ACTIONS_KEY } from '../dist/index.js';

function makeManifest(actions) {
    return {
        navigation: { standardPages: {}, projectPages: [] },
        capabilities: {},
        dashboard: { kpiCards: [] },
        tenants: { columns: [], actions: actions ?? [] },
        audit: { actions: [] },
        build: { manifestHash: 'h-1' },
    };
}

function withAppContext(actionsMap, callback) {
    const app = createApp({ render: () => null });
    app.provide(SUPER_ADMIN_ACTIONS_KEY, actionsMap);
    let result;
    app.runWithContext(() => {
        result = callback();
    });
    return result;
}

const ROW = { id: '1', slug: 'acme', name: 'Acme', isActive: true };

describe('useTenantActionFlow — empty actions', () => {
    test('actionsForRow returns [] when manifest is null', () => {
        const manifest = ref(null);
        const result = withAppContext({}, () => useTenantActionFlow(manifest));
        assert.deepEqual(result.actionsForRow(ROW), []);
    });

    test('actionsForRow returns [] when tenants.actions is empty', () => {
        const manifest = ref(makeManifest([]));
        const result = withAppContext({}, () => useTenantActionFlow(manifest));
        assert.deepEqual(result.actionsForRow(ROW), []);
    });
});

describe('useTenantActionFlow — flow order', () => {
    test('Confirm → MFA → Handler in correct order', async () => {
        const events = [];
        const manifest = ref(
            makeManifest([
                {
                    id: 'p.t.suspend',
                    label: 'Suspendieren',
                    actionKey: 'tenants.suspend',
                    requiresMfa: true,
                    confirmType: 'simple',
                },
            ]),
        );
        const handlers = {
            'tenants.suspend': async (input) => {
                events.push(['handler', input.row.slug, input.mfaCode, input.reason]);
                return { ok: true };
            },
        };
        const flow = withAppContext(handlers, () =>
            useTenantActionFlow(manifest, {
                confirm: async (def, ctx) => {
                    events.push(['confirm', def.id, ctx.row.slug]);
                    return { ok: true, reason: 'just because' };
                },
                mfa: async (def, ctx) => {
                    events.push(['mfa', def.id, ctx.row.slug]);
                    return '123456';
                },
                notify: (k, m) => events.push(['notify', k, m]),
            }),
        );
        const actions = flow.actionsForRow(ROW);
        const result = await actions[0].invoke(ROW);
        assert.deepEqual(result, { ok: true });
        assert.deepEqual(events, [
            ['confirm', 'p.t.suspend', 'acme'],
            ['mfa', 'p.t.suspend', 'acme'],
            ['handler', 'acme', '123456', 'just because'],
            ['notify', 'positive', 'Suspendieren: erfolgreich.'],
        ]);
    });

    test('Confirm abort prevents MFA + Handler', async () => {
        const events = [];
        const manifest = ref(
            makeManifest([
                {
                    id: 'x',
                    label: 'X',
                    actionKey: 'k',
                    requiresMfa: true,
                    confirmType: 'simple',
                },
            ]),
        );
        const handlers = {
            k: async () => {
                events.push(['handler']);
            },
        };
        const flow = withAppContext(handlers, () =>
            useTenantActionFlow(manifest, {
                confirm: async () => ({ ok: false }),
                mfa: async () => {
                    events.push(['mfa']);
                    return '0';
                },
            }),
        );
        const result = await flow.actionsForRow(ROW)[0].invoke(ROW);
        assert.equal(result, undefined);
        assert.deepEqual(events, []);
    });

    test('MFA abort prevents Handler', async () => {
        const events = [];
        const manifest = ref(
            makeManifest([
                {
                    id: 'x',
                    label: 'X',
                    actionKey: 'k',
                    requiresMfa: true,
                    confirmType: 'none',
                },
            ]),
        );
        const handlers = {
            k: async () => {
                events.push(['handler']);
            },
        };
        const flow = withAppContext(handlers, () =>
            useTenantActionFlow(manifest, {
                mfa: async () => null,
            }),
        );
        const result = await flow.actionsForRow(ROW)[0].invoke(ROW);
        assert.equal(result, undefined);
        assert.deepEqual(events, []);
    });
});

describe('useTenantActionFlow — capability and handler filter', () => {
    test('hides action when requiredCapability is false in the manifest', () => {
        const manifest = ref({
            navigation: { standardPages: {}, projectPages: [] },
            capabilities: { 'tenants.suspend': false, 'tenants.reactivate': true },
            dashboard: { kpiCards: [] },
            tenants: {
                columns: [],
                actions: [
                    {
                        id: 's',
                        label: 'Suspend',
                        actionKey: 'tenants.suspend',
                        requiredCapability: 'tenants.suspend',
                    },
                    {
                        id: 'r',
                        label: 'Reactivate',
                        actionKey: 'tenants.reactivate',
                        requiredCapability: 'tenants.reactivate',
                    },
                ],
            },
            audit: { actions: [] },
            build: { manifestHash: 'h' },
        });
        const flow = withAppContext(
            { 'tenants.suspend': async () => 'ok', 'tenants.reactivate': async () => 'ok' },
            () => useTenantActionFlow(manifest),
        );
        const ids = flow.actionsForRow(ROW).map((a) => a.def.id);
        assert.deepEqual(ids, ['r']);
    });

    test('hides action when no handler is registered in the actions map', () => {
        const manifest = ref(
            makeManifest([
                { id: 'a', label: 'A', actionKey: 'k1' },
                { id: 'b', label: 'B', actionKey: 'k2' },
            ]),
        );
        const flow = withAppContext({ k1: async () => 'ok' }, () => useTenantActionFlow(manifest));
        const ids = flow.actionsForRow(ROW).map((a) => a.def.id);
        assert.deepEqual(ids, ['a']);
        // orphanedDefs is retained for drift diagnostics.
        assert.deepEqual(flow.orphanedDefs.value, ['k2']);
    });

    test('visibleForRow filters row-specifically by capability+handler', () => {
        const manifest = ref(
            makeManifest([
                { id: 's', label: 'Suspend', actionKey: 'tenants.suspend' },
                { id: 'r', label: 'Reactivate', actionKey: 'tenants.reactivate' },
            ]),
        );
        const flow = withAppContext(
            { 'tenants.suspend': async () => 'ok', 'tenants.reactivate': async () => 'ok' },
            () =>
                useTenantActionFlow(manifest, {
                    visibleForRow: (def, row) => {
                        if (def.actionKey === 'tenants.suspend') return row.isActive;
                        if (def.actionKey === 'tenants.reactivate') return !row.isActive;
                        return true;
                    },
                }),
        );
        const activeIds = flow.actionsForRow({ ...ROW, isActive: true }).map((a) => a.def.id);
        assert.deepEqual(activeIds, ['s']);
        const inactiveIds = flow.actionsForRow({ ...ROW, isActive: false }).map((a) => a.def.id);
        assert.deepEqual(inactiveIds, ['r']);
    });

    test('availableActions is row-independent — Reactivate stays visible despite a sample row with isActive=true', () => {
        // Regression: previously pages used `actionsForRow(sampleRow)` as
        // the base list — when `sampleRow.isActive=true`, `visibleForRow`
        // had already filtered `tenants.reactivate` out of the base and the
        // reactivate button never existed for inactive tenants.
        const manifest = ref(
            makeManifest([
                { id: 's', label: 'Suspend', actionKey: 'tenants.suspend' },
                { id: 'r', label: 'Reactivate', actionKey: 'tenants.reactivate' },
            ]),
        );
        const flow = withAppContext(
            { 'tenants.suspend': async () => 'ok', 'tenants.reactivate': async () => 'ok' },
            () =>
                useTenantActionFlow(manifest, {
                    visibleForRow: (def, row) => {
                        if (def.actionKey === 'tenants.suspend') return row.isActive;
                        if (def.actionKey === 'tenants.reactivate') return !row.isActive;
                        return true;
                    },
                }),
        );
        const baseIds = flow.availableActions.value.map((d) => d.id);
        assert.deepEqual(baseIds, ['s', 'r']);
    });

    test('availableActions statically filters disabled capabilities + orphan handlers', () => {
        const manifest = ref({
            navigation: { standardPages: {}, projectPages: [] },
            capabilities: { 'tenants.suspend': false },
            dashboard: { kpiCards: [] },
            tenants: {
                columns: [],
                actions: [
                    {
                        id: 's',
                        label: 'Suspend',
                        actionKey: 'tenants.suspend',
                        requiredCapability: 'tenants.suspend',
                    },
                    { id: 'r', label: 'Reactivate', actionKey: 'tenants.reactivate' },
                    { id: 'g', label: 'Ghost', actionKey: 'no.handler' },
                ],
            },
            audit: { actions: [] },
            build: { manifestHash: 'h' },
        });
        const flow = withAppContext({ 'tenants.reactivate': async () => 'ok' }, () =>
            useTenantActionFlow(manifest),
        );
        // Suspend is blocked via capability, Ghost is blocked via missing handler.
        assert.deepEqual(
            flow.availableActions.value.map((d) => d.id),
            ['r'],
        );
    });
});

describe('useTenantActionFlow — provider drift', () => {
    test('throws when an action requires MFA but no mfa provider is set', async () => {
        const manifest = ref(
            makeManifest([
                {
                    id: 'x',
                    label: 'X',
                    actionKey: 'k',
                    requiresMfa: true,
                    confirmType: 'none',
                },
            ]),
        );
        const flow = withAppContext({ k: async () => 'ok' }, () => useTenantActionFlow(manifest));
        await assert.rejects(
            () => flow.actionsForRow(ROW)[0].invoke(ROW),
            /requires MFA, but no .mfa. provider/,
        );
    });

    test('throws when an action requires confirm but no confirm provider is set', async () => {
        const manifest = ref(
            makeManifest([
                {
                    id: 'x',
                    label: 'X',
                    actionKey: 'k',
                    requiresMfa: false,
                    confirmType: 'simple',
                },
            ]),
        );
        const flow = withAppContext({ k: async () => 'ok' }, () => useTenantActionFlow(manifest));
        await assert.rejects(
            () => flow.actionsForRow(ROW)[0].invoke(ROW),
            /requires confirmType="simple", but no .confirm. provider/,
        );
    });

    test('orphanedDefs lists manifest actions without a handler', () => {
        const manifest = ref(
            makeManifest([
                { id: 'x', label: 'X', actionKey: 'k1' },
                { id: 'y', label: 'Y', actionKey: 'k2' },
            ]),
        );
        const flow = withAppContext({ k1: async () => 'ok' }, () => useTenantActionFlow(manifest));
        assert.deepEqual(flow.orphanedDefs.value, ['k2']);
    });
});
