// @requirement SC-COMP-011 — Every data-access implementation is held to the same executable contract

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createSaaSiCatTestModule,
    StubAuditPort,
    StubMfaPort,
    StubRlsBypassPort,
} from '../dist/testing/index.js';

describe('createSaaSiCatTestModule', () => {
    test('returns a DynamicModule with a test host', () => {
        const dyn = createSaaSiCatTestModule({
            planCatalog: {
                schemaVersion: 1,
                app: { name: 'Test App' },
                currency: 'EUR',
                vatRate: 19,
                plans: [{ id: 'starter', features: ['NOTES'], quotas: {} }],
            },
        });
        assert.ok(dyn.module, 'DynamicModule.module must be set');
        assert.equal(dyn.module.name, 'SaaSiCatTestHost');
    });

    test('default stubs are no-op capable', async () => {
        const mfa = new StubMfaPort();
        assert.equal(await mfa.getSecret('u'), null);
        await mfa.setSecret('u', 'XX');
        assert.equal(await mfa.getSecret('u'), 'XX');
        assert.equal(await mfa.isEnabled('u'), true);
        await mfa.setSecret('u', null);
        assert.equal(await mfa.isEnabled('u'), false);

        const audit = new StubAuditPort();
        await audit.write({ actor: 'a', entity: 'E', entityId: '1', action: 'X' });
        assert.equal(audit.calls.length, 1);

        const rls = new StubRlsBypassPort();
        const result = await rls.runWithBypass(async () => 42);
        assert.equal(result, 42);
    });

    test('overrides can replace individual adapters', () => {
        const customAudit = { write: async () => {} };
        const dyn = createSaaSiCatTestModule({
            planCatalog: {
                schemaVersion: 1,
                app: { name: 'Test App' },
                currency: 'EUR',
                vatRate: 19,
                plans: [{ id: 'starter', features: [], quotas: {} }],
            },
            overrides: { audit: customAudit },
        });
        assert.ok(dyn.module, 'returns DynamicModule with override');
    });
});
