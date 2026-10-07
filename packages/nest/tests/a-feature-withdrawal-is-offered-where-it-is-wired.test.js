// Where an installation keeps feature withdrawals, the composed module offers
// the operator the action and enforces it on every path that grants a feature:
// the service can find everybody a withdrawal reaches, the manifest says so,
// and the default feature guard reads the withdrawals as well. Built through
// `SaaSiCatModule.forRoot`, because a service constructed by hand in a test
// says nothing about what the composition puts in its scope.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { FEATURE_WITHDRAWAL_CAPABILITY } from '@saasicat/core';

import { AdminManifestService } from '../dist/admin/index.js';
import { FeatureWithdrawalService } from '../dist/billing/index.js';
import { SaaSiCatModule, StaticEntitlementService } from '../dist/platform/index.js';
import { bootable, everythingOnOptions } from './helpers/operator-routes.js';

/** The shipped bundles' usage port lists by plan version and by id; the fixture's has neither. */
const USAGE_PORT = {
    findForTenant: async () => null,
    listBoundToVersion: async () => [],
    listByIds: async () => [],
};

/** Every option on, a plan granting `EXPORT`, and the withdrawals `withdrawals` keeps. */
function installation(withdrawals) {
    const options = bootable(everythingOnOptions());
    return {
        ...options,
        planCatalog: {
            ...options.planCatalog,
            features: [{ key: 'EXPORT', label: 'Export' }],
            plans: [
                {
                    id: 'STARTER',
                    name: 'Starter',
                    monthlyNet: 10,
                    yearlyNet: 100,
                    features: ['EXPORT'],
                    quotas: {},
                },
            ],
        },
        adapters: {
            ...options.adapters,
            planResolver: { getPlanIdForTenant: async () => 'STARTER' },
        },
        persistence: {
            ...options.persistence,
            tenantBilling: {
                ...options.persistence.tenantBilling,
                subscriptionUsagePort: USAGE_PORT,
                featureWithdrawals: {
                    list: async () => withdrawals,
                    findById: async () => null,
                    create: async () => null,
                    lift: async () => null,
                },
            },
        },
    };
}

async function started(withdrawals = []) {
    const root = SaaSiCatModule.forRoot(installation(withdrawals));
    return Test.createTestingModule({ imports: [root] }).compile();
}

const EXPORT_WITHDRAWN = {
    id: 'fw-1',
    featureKey: 'EXPORT',
    reason: 'The export service has been switched off.',
    effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
    liftedFrom: null,
    reductions: [],
    announcedAt: new Date('2019-12-30T00:00:00.000Z'),
    announcedBy: 'super-admin:ops@example.com',
    liftedAt: null,
    liftedBy: null,
};

// @requirement SC-SUB-042 — The operator withdraws a feature from everybody who holds it, and tells them at once
describe('a feature withdrawal, in the composed module', () => {
    test('is offered where the installation keeps withdrawals and can find everybody', async () => {
        const moduleRef = await started();
        const service = moduleRef.get(FeatureWithdrawalService, { strict: false });
        assert.equal(service.available, true);
        const manifest = await moduleRef.get(AdminManifestService, { strict: false }).getManifest();
        assert.equal(manifest.capabilities?.[FEATURE_WITHDRAWAL_CAPABILITY], true);
    });
});

// @requirement SC-ENTL-025 — A feature withdrawn for a reason outside the platform is granted to nobody
describe('the default feature guard, in the composed module', () => {
    test('grants a withdrawn feature to nobody, and the feature again where nothing is withdrawn', async () => {
        const withdrawn = await started([EXPORT_WITHDRAWN]);
        assert.equal(
            await withdrawn
                .get(StaticEntitlementService, { strict: false })
                .hasFeature('t1', 'EXPORT'),
            false,
        );
        const kept = await started([]);
        assert.equal(
            await kept.get(StaticEntitlementService, { strict: false }).hasFeature('t1', 'EXPORT'),
            true,
        );
    });
});
