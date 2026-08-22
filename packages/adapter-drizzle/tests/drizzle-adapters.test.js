import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getTableName } from 'drizzle-orm';
import {
    AsyncLocalRlsBypassAdapter,
    DrizzleMfaAdapter,
    DrizzleSuperAdminBootstrapAdapter,
    DrizzleTransactionRunner,
    drizzlePersistence,
    saasicatSchema,
} from '../dist/index.js';

// Wiring/shape tests — behavioral verification runs in tests-integration/
// via @saasicat/persistence-testing against a real PostgreSQL (drizzle
// query builders need a live session; faking them would test nothing).

describe('schema table map', () => {
    test('table names match the canonical @@map names', () => {
        const expected = {
            subscriptions: 'subscriptions',
            planVersions: 'plan_versions',
            plans: 'plans',
            featureCatalogEntries: 'feature_catalog_entries',
            promoCodes: 'promo_codes',
            promoCodeRedemptions: 'promo_code_redemptions',
            promoCodeValidationLogs: 'promo_code_validation_logs',
            auditLogs: 'audit_logs',
            superAdminUsers: 'super_admin_users',
            superAdminMfa: 'super_admin_mfa',
        };
        for (const [exportName, tableName] of Object.entries(expected)) {
            assert.equal(getTableName(saasicatSchema[exportName]), tableName, exportName);
        }
    });

    test('camelCase column names are preserved (no snake_case mapping)', () => {
        assert.equal(saasicatSchema.subscriptions.tenantId.name, 'tenantId');
        assert.equal(saasicatSchema.planVersions.publishedAt.name, 'publishedAt');
        assert.equal(saasicatSchema.promoCodes.redemptionsCount.name, 'redemptionsCount');
        assert.equal(saasicatSchema.auditLogs.actorTag.name, 'actorTag');
    });
});

describe('drizzlePersistence()', () => {
    test('instance db → ready instances; declared capabilities', () => {
        const fakeDb = { transaction: async (fn) => fn({}) };
        const bundle = drizzlePersistence({ db: fakeDb });

        assert.deepEqual(bundle.capabilities, {
            transactions: true,
            pessimisticLocking: true,
            rowLevelSecurity: false,
            advisoryLocks: false,
        });
        assert.ok(bundle.core.mfa instanceof DrizzleMfaAdapter);
        assert.ok(bundle.core.transactionRunner instanceof DrizzleTransactionRunner);
        assert.ok(bundle.core.rlsBypass instanceof AsyncLocalRlsBypassAdapter);
        assert.equal(
            bundle.core.superAdminProvisioning,
            undefined,
            'no provisioning without passwordHasher',
        );
        assert.ok(bundle.entitlement.subscriptionRepository);
        assert.ok(bundle.promo.promoCodeRepository);
        assert.ok(bundle.planCatalogReadSink);
    });

    test('token db → factory specs injecting the token', () => {
        const token = Symbol('DRIZZLE');
        const bundle = drizzlePersistence({ db: token, rlsIntegration: true });
        assert.equal(typeof bundle.core.audit.useFactory, 'function');
        assert.deepEqual(bundle.core.audit.inject, [token]);
        assert.equal(bundle.capabilities.rowLevelSecurity, true);
    });

    test('hasher instance + instance db enables provisioning', () => {
        const fakeDb = { transaction: async (fn) => fn({}) };
        const hasher = { hash: async () => 'h', verify: async () => true };
        const bundle = drizzlePersistence({ db: fakeDb, passwordHasher: hasher });
        assert.ok(bundle.core.superAdminProvisioning instanceof DrizzleSuperAdminBootstrapAdapter);
    });

    test('transaction runner passes the drizzle tx through as context', async () => {
        const sentinel = { tx: true };
        const fakeDb = { transaction: async (fn) => fn(sentinel) };
        const bundle = drizzlePersistence({ db: fakeDb });
        const seen = await bundle.core.transactionRunner.run(async (tx) => tx);
        assert.equal(seen, sentinel);
    });
});
