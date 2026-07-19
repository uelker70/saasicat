// useTenantActionFlow — Tests für die Action-Flow-Orchestrierung.
//
// Schwerpunkt: garantiert, dass Confirm + MFA in der richtigen Reihenfolge
// vor Handler-Dispatch stehen, und dass Abbruch in jedem Schritt den Flow
// sauber stoppt (kein Handler-Call, kein Notify).
//
// Vue-`app.mount()` braucht ein vollwertiges `window`, das wir hier nicht
// stellen wollen. Stattdessen `app.runWithContext()` analog zu
// project-page-host.test.js — der Composable funktioniert auch ohne
// Mount, solange ein Inject-Scope existiert.

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

describe('useTenantActionFlow — leere Actions', () => {
    test('actionsForRow liefert [], wenn manifest null ist', () => {
        const manifest = ref(null);
        const result = withAppContext({}, () => useTenantActionFlow(manifest));
        assert.deepEqual(result.actionsForRow(ROW), []);
    });

    test('actionsForRow liefert [], wenn tenants.actions leer ist', () => {
        const manifest = ref(makeManifest([]));
        const result = withAppContext({}, () => useTenantActionFlow(manifest));
        assert.deepEqual(result.actionsForRow(ROW), []);
    });
});

describe('useTenantActionFlow — Flow-Reihenfolge', () => {
    test('Confirm → MFA → Handler in korrekter Reihenfolge', async () => {
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

    test('Confirm-Abbruch verhindert MFA + Handler', async () => {
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

    test('MFA-Abbruch verhindert Handler', async () => {
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

describe('useTenantActionFlow — Capability- und Handler-Filter', () => {
    test('blendet Action aus, wenn requiredCapability im Manifest auf false steht', () => {
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

    test('blendet Action aus, wenn kein Handler in der actions-Map registriert ist', () => {
        const manifest = ref(
            makeManifest([
                { id: 'a', label: 'A', actionKey: 'k1' },
                { id: 'b', label: 'B', actionKey: 'k2' },
            ]),
        );
        const flow = withAppContext({ k1: async () => 'ok' }, () => useTenantActionFlow(manifest));
        const ids = flow.actionsForRow(ROW).map((a) => a.def.id);
        assert.deepEqual(ids, ['a']);
        // orphanedDefs bleibt für Drift-Diagnose erhalten.
        assert.deepEqual(flow.orphanedDefs.value, ['k2']);
    });

    test('visibleForRow filtert row-spezifisch nach Capability+Handler', () => {
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

    test('availableActions ist row-unabhängig — Reactivate bleibt trotz Sample-Row mit isActive=true sichtbar', () => {
        // Regression: vorher haben Pages `actionsForRow(sampleRow)` als
        // Basisliste benutzt — wenn `sampleRow.isActive=true` war,
        // hat `visibleForRow` das `tenants.reactivate` schon aus der
        // Basis ausgefiltert und der Reaktivieren-Button hat für inaktive
        // Tenants nie existiert.
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

    test('availableActions filtert deaktivierte Capabilities + orphan Handler statisch', () => {
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
        // Suspend blockiert via Capability, Ghost blockiert via fehlendem Handler.
        assert.deepEqual(
            flow.availableActions.value.map((d) => d.id),
            ['r'],
        );
    });
});

describe('useTenantActionFlow — Provider-Drift', () => {
    test('wirft, wenn Action MFA verlangt aber kein mfa-Provider gesetzt ist', async () => {
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
            /verlangt MFA, aber kein .mfa.-Provider/,
        );
    });

    test('wirft, wenn Action Confirm verlangt aber kein confirm-Provider gesetzt ist', async () => {
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
            /verlangt confirmType=.simple., aber kein .confirm.-Provider/,
        );
    });

    test('orphanedDefs listet Manifest-Actions ohne Handler', () => {
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
