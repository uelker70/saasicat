import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ActionDefNotInManifestError, ActionRegistry, MissingHandlerError } from '../dist/index.js';

function buildManifest(actions = []) {
    return {
        schemaVersion: 1,
        project: { key: 'cf', displayName: 'DemoApp' },
        build: {
            platformPackageVersion: '0.1.0',
            appVersion: '1.0.0',
            manifestHash: 'sha256-x',
        },
        capabilities: {},
        navigation: { standardPages: {} },
        tenants: { actions },
        planCatalogSnapshot: {
            source: 'config/plans.yaml',
            hash: 'h',
            currency: 'EUR',
            vatRate: 19,
            plans: [],
        },
    };
}

describe('ActionRegistry.get + dispatch', () => {
    test('liefert {def, handler} für registrierten Key', () => {
        const m = buildManifest([
            {
                id: 'cf.tenant.suspend',
                label: 'Suspendieren',
                actionKey: 'TENANT_SUSPEND',
                requiresMfa: true,
                confirmType: 'typed-slug',
            },
        ]);
        let _lastInput = null;
        const registry = new ActionRegistry(m, {
            TENANT_SUSPEND: async (input) => {
                _lastInput = input;
                return { ok: true };
            },
        });
        const action = registry.get('TENANT_SUSPEND');
        assert.equal(action.def.actionKey, 'TENANT_SUSPEND');
        assert.equal(action.def.requiresMfa, true);
        assert.equal(action.def.confirmType, 'typed-slug');
    });

    test('dispatch ruft Handler mit Input', async () => {
        const m = buildManifest([
            {
                id: 'cf.t.x',
                label: 'X',
                actionKey: 'X',
            },
        ]);
        const registry = new ActionRegistry(m, {
            X: async (i) => ({ echo: i }),
        });
        const result = await registry.dispatch('X', { foo: 1 });
        assert.deepEqual(result, { echo: { foo: 1 } });
    });
});

describe('ActionRegistry.get — Fehlerpfade', () => {
    test('ActionDefNotInManifestError für unbekannten Key', () => {
        const m = buildManifest([]);
        const registry = new ActionRegistry(m, {});
        assert.throws(
            () => registry.get('NOPE'),
            (err) => err instanceof ActionDefNotInManifestError,
        );
    });

    test('MissingHandlerError für deklarierten Key ohne Handler', () => {
        const m = buildManifest([
            {
                id: 'cf.t.x',
                label: 'X',
                actionKey: 'X',
            },
        ]);
        const registry = new ActionRegistry(m, {});
        assert.throws(
            () => registry.get('X'),
            (err) => err instanceof MissingHandlerError,
        );
    });
});

describe('ActionRegistry.register — Late-Binding', () => {
    test('akzeptiert Handler-Registrierung für deklarierten Key', () => {
        const m = buildManifest([
            {
                id: 'cf.t.x',
                label: 'X',
                actionKey: 'X',
            },
        ]);
        const registry = new ActionRegistry(m, {});
        registry.register('X', async () => 'done');
        // Sollte jetzt nicht mehr werfen
        const action = registry.get('X');
        assert.equal(action.def.actionKey, 'X');
    });

    test('lehnt Registrierung für nicht-deklarierte Keys ab', () => {
        const m = buildManifest([]);
        const registry = new ActionRegistry(m, {});
        assert.throws(
            () => registry.register('NOPE', async () => null),
            (err) => err instanceof ActionDefNotInManifestError,
        );
    });
});

describe('ActionRegistry — Drift-Detection', () => {
    test('listOrphanedDefs: Manifest-deklarierte Actions ohne Handler', () => {
        const m = buildManifest([
            { id: 'a', label: 'A', actionKey: 'A' },
            { id: 'b', label: 'B', actionKey: 'B' },
            { id: 'c', label: 'C', actionKey: 'C' },
        ]);
        const registry = new ActionRegistry(m, {
            A: async () => null,
        });
        const orphaned = registry.listOrphanedDefs();
        assert.deepEqual(orphaned.sort(), ['B', 'C']);
    });

    test('listOrphanedHandlers: registrierte Handler ohne Manifest-Def', () => {
        const m = buildManifest([{ id: 'a', label: 'A', actionKey: 'A' }]);
        const registry = new ActionRegistry(m, {
            A: async () => null,
        });
        // Registry erlaubt Bypass via Constructor (für Tests / dynamische Keys)
        // Wir prüfen den drift-detection-Output:
        const orphaned = registry.listOrphanedHandlers();
        assert.equal(orphaned.length, 0);
    });
});
