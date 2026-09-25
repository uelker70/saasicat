// The contract freeze reads a redeemed promo code from `PromoCodesService`,
// which it is handed only when the promo module is visible to tenant billing.
// Built by hand, the service gets whatever the test passes; composed by Nest,
// an optional dependency nobody provides is silently null. So the wiring is
// checked in a container: the freeze and the promo service come from the
// modules, and only the adapters are fakes.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';

import {
    CONTRACT_FREEZE_PORT_TOKEN,
    PlanCatalogModule,
    TenantBillingModule,
} from '../dist/billing/index.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../dist/entitlement/index.js';
import { PromoCodesModule } from '../dist/promo/index.js';
import {
    FakeSubscriberRepository,
    FakeSubscriptionContractRepository,
} from '../dist/testing/index.js';
import { boundPlanVersion } from './helpers/subscription-fixtures.js';

const STANDARD = {
    id: 'STANDARD',
    name: 'Standard',
    monthlyNet: 49,
    yearlyNet: 490,
    quotas: {},
    features: [],
};

const CATALOG = {
    schemaVersion: 1,
    app: { name: 'Test App' },
    currency: 'EUR',
    vatRate: 19,
    tenantBilling: {
        cancellationNoticeDays: { monthly: 0, yearly: 0 },
        selfServiceBlockedPlans: { asTarget: [], asSource: [] },
    },
    plans: [STANDARD],
};

const FROM = new Date('2026-06-09T00:00:00.000Z');

/** The code `WELCOME10`, redeemed for `sub-1` at 10 % once. */
function promoAdapters() {
    const code = { id: 'p1', code: 'WELCOME10', deletedAt: null };
    return {
        promoCodeRepository: { findById: async (id) => (id === 'p1' ? code : null) },
        redemptionRepository: {
            findBySubscription: async (subscriptionId) =>
                subscriptionId === 'sub-1'
                    ? {
                          id: 'r1',
                          promoCodeId: 'p1',
                          subscriptionId,
                          tenantId: 't1',
                          appliedValueType: 'PERCENT',
                          appliedValue: '10.00',
                          appliedDurationType: 'ONCE',
                          appliedDurationValue: null,
                          startsAt: FROM,
                          endsAt: null,
                          status: 'ACTIVE',
                          redeemedAt: FROM,
                          reversedAt: null,
                      }
                    : null,
        },
        validationLogRepository: {},
        subscriptionLookup: {},
        revenueAggregator: {},
        transactionRunner: { run: (fn) => fn(undefined) },
        firstTimeCustomerCheck: { hasExistingCustomerForEmail: async () => false },
        includePublicController: false,
        includeExpirerCron: false,
    };
}

async function composed({ promoVisibleToBilling }) {
    const contracts = new FakeSubscriptionContractRepository();
    const subscribers = new FakeSubscriberRepository();
    await subscribers.createForTenant({ tenantId: 't1', legalName: 'Tenant One GmbH' });
    const entitlements = {
        invalidateTenant() {},
        computeContractLimits: async () => ({
            limits: { plan: 'STANDARD', quotas: {}, features: new Set() },
            leftOutBundleVersionIds: [],
        }),
    };
    const moduleRef = await Test.createTestingModule({
        imports: [
            PlanCatalogModule.forRootWithCatalog(CATALOG),
            {
                module: class FakeEntitlementModule {},
                global: true,
                providers: [{ provide: ENTITLEMENT_SERVICE_TOKEN, useValue: entitlements }],
                exports: [ENTITLEMENT_SERVICE_TOKEN],
            },
            PromoCodesModule.forRoot({ ...promoAdapters(), global: promoVisibleToBilling }),
            TenantBillingModule.forRoot({
                authGuards: [class Guard {}],
                subscriptionUsagePort: { findForTenant: async () => ({ id: 'sub-1' }) },
                usageSnapshotPort: { snapshot: async () => ({}) },
                subscriptionWritePort: {},
                contractFreeze: {
                    sourcePort: {
                        findBoundPlanVersion: async () => boundPlanVersion(STANDARD),
                        loadBookedBundles: async () => ({ lineItems: [], bundleVersionIds: [] }),
                    },
                    subscriptionContractRepository: contracts,
                    subscriberRepository: subscribers,
                },
            }),
        ],
    }).compile();
    return { moduleRef, contracts };
}

// @requirement SC-PROMO-025 — A code redeemed without an offer is recorded in the first contract after it
describe('the contract freeze sees the redeemed code in a composed container', () => {
    test('where the promo module is visible to tenant billing, the contract records the code', async () => {
        const { moduleRef, contracts } = await composed({ promoVisibleToBilling: true });

        await moduleRef
            .get(CONTRACT_FREEZE_PORT_TOKEN)
            .freezeOnPlanChange('t1', 'STANDARD', 'MONTHLY', FROM);

        const [contract] = await contracts.list({ tenantId: 't1' });
        assert.deepEqual(
            contract.lineItems.map(({ kind, sourceKey, priceNet }) => [kind, sourceKey, priceNet]),
            [
                ['plan', 'STANDARD', 49],
                ['discount', 'WELCOME10', -4.9],
            ],
        );
        await moduleRef.close();
    });

    test('where it is not, the freeze is handed no promo service and records none', async () => {
        const { moduleRef, contracts } = await composed({ promoVisibleToBilling: false });

        await moduleRef
            .get(CONTRACT_FREEZE_PORT_TOKEN)
            .freezeOnPlanChange('t1', 'STANDARD', 'MONTHLY', FROM);

        const [contract] = await contracts.list({ tenantId: 't1' });
        assert.deepEqual(
            contract.lineItems.map(({ kind }) => kind),
            ['plan'],
        );
        await moduleRef.close();
    });
});
