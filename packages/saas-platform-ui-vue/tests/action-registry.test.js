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
    test('returns {def, handler} for a registered key', () => {
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

    test('dispatch calls handler with input', async () => {
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

describe('ActionRegistry.get — error paths', () => {
    test('ActionDefNotInManifestError for an unknown key', () => {
        const m = buildManifest([]);
        const registry = new ActionRegistry(m, {});
        assert.throws(
            () => registry.get('NOPE'),
            (err) => err instanceof ActionDefNotInManifestError,
        );
    });

    test('MissingHandlerError for a declared key without a handler', () => {
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

describe('ActionRegistry.register — late binding', () => {
    test('accepts handler registration for a declared key', () => {
        const m = buildManifest([
            {
                id: 'cf.t.x',
                label: 'X',
                actionKey: 'X',
            },
        ]);
        const registry = new ActionRegistry(m, {});
        registry.register('X', async () => 'done');
        // Should no longer throw now
        const action = registry.get('X');
        assert.equal(action.def.actionKey, 'X');
    });

    test('rejects registration for non-declared keys', () => {
        const m = buildManifest([]);
        const registry = new ActionRegistry(m, {});
        assert.throws(
            () => registry.register('NOPE', async () => null),
            (err) => err instanceof ActionDefNotInManifestError,
        );
    });
});

describe('ActionRegistry — drift detection', () => {
    test('listOrphanedDefs: manifest-declared actions without a handler', () => {
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

    test('listOrphanedHandlers: registered handlers without a manifest def', () => {
        const m = buildManifest([{ id: 'a', label: 'A', actionKey: 'A' }]);
        const registry = new ActionRegistry(m, {
            A: async () => null,
        });
        // Registry allows bypass via constructor (for tests / dynamic keys)
        // We check the drift-detection output:
        const orphaned = registry.listOrphanedHandlers();
        assert.equal(orphaned.length, 0);
    });
});
