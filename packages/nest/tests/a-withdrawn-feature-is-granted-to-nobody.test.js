import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { EntitlementService } from '../dist/entitlement/index.js';
import { givenPlanCatalogSource } from '../dist/billing/index.js';
import { StaticEntitlementService } from '../dist/platform/index.js';
import {
    CATALOG,
    entitlementServiceFor,
    subscriptionRecord as subscription,
} from './helpers/subscription-fixtures.js';

// A feature withdrawn for a reason outside the platform — an external service
// it depends on stopped, a law took it away — is granted to nobody from the
// date the operator names until the withdrawal is lifted, whatever grants it:
// the plan, a frozen contract, an add-on, special terms, the floor of a
// cancelled subscription. The cause is outside, so it reaches everyone who has
// the feature; what was agreed is not rewritten, so a contract frozen while it
// is withdrawn still records it, and it comes back when the withdrawal is
// lifted without anybody writing a contract.

const FROM = new Date('2026-06-01T00:00:00.000Z');
const LIFTED = new Date('2026-07-01T00:00:00.000Z');
const NOW = new Date('2026-06-15T10:00:00.000Z');
const ms = (date, delta) => new Date(date.getTime() + delta);

function withdrawal(overrides = {}) {
    return {
        id: 'fw-1',
        featureKey: 'EXPORT',
        reason: 'The export service has been switched off.',
        effectiveFrom: FROM,
        liftedFrom: null,
        reductions: [],
        announcedAt: new Date('2026-05-30T00:00:00.000Z'),
        announcedBy: 'super-admin:ops@example.com',
        liftedAt: null,
        liftedBy: null,
        ...overrides,
    };
}

const features = async (svc, at) => [...(await svc.computeLimits('t1', at)).features].sort();

// @requirement SC-ENTL-025 — A feature withdrawn for a reason outside the platform is granted to nobody
describe('a withdrawn feature', () => {
    test('is granted by no plan while the withdrawal holds, and nothing else is taken', async () => {
        const svc = entitlementServiceFor(
            EntitlementService,
            subscription({
                planVersion: {
                    planId: 'PRO',
                    quotas: { users: 50 },
                    features: ['EXPORT', 'REPORTS'],
                },
            }),
            { withdrawals: [withdrawal()] },
        );
        const limits = await svc.computeLimits('t1', NOW);
        assert.deepEqual([...limits.features], ['REPORTS']);
        assert.deepEqual(limits.quotas, { users: 50 }, 'quotas are not features');
    });

    test('is granted until its date and from the moment it is lifted, to the millisecond', async () => {
        const at = (when) =>
            features(
                entitlementServiceFor(EntitlementService, subscription(), {
                    withdrawals: [withdrawal({ liftedFrom: LIFTED })],
                }),
                when,
            );
        assert.deepEqual(await at(ms(FROM, -1)), ['EXPORT'], 'before the date');
        assert.deepEqual(await at(FROM), [], 'on the date');
        assert.deepEqual(await at(ms(LIFTED, -1)), [], 'until it is lifted');
        assert.deepEqual(await at(LIFTED), ['EXPORT'], 'and back from then');
    });

    test('that was lifted before its date never takes the feature away', async () => {
        const svc = entitlementServiceFor(EntitlementService, subscription(), {
            withdrawals: [withdrawal({ liftedFrom: ms(FROM, -60_000) })],
        });
        assert.deepEqual(await features(svc, FROM), ['EXPORT']);
        assert.deepEqual(await features(svc, NOW), ['EXPORT']);
    });

    test('of another feature leaves this one alone', async () => {
        const svc = entitlementServiceFor(EntitlementService, subscription(), {
            withdrawals: [withdrawal({ featureKey: 'BANK_SYNC' })],
        });
        assert.deepEqual(await features(svc, NOW), ['EXPORT']);
    });

    test('is not granted by a contract frozen with it', async () => {
        const contract = {
            entitlementSnapshot: { plan: 'PRO', quotas: {}, features: ['EXPORT', 'REPORTS'] },
            lineItems: [],
        };
        const svc = entitlementServiceFor(EntitlementService, subscription(), {
            contract,
            withdrawals: [withdrawal()],
        });
        assert.deepEqual(await features(svc, NOW), ['REPORTS']);
    });

    test('is not granted by an add-on booked on top', async () => {
        const svc = entitlementServiceFor(
            EntitlementService,
            subscription({ planVersion: { planId: 'PRO', quotas: {}, features: [] } }),
            {
                bundles: [
                    {
                        id: 'sb-1',
                        subscriptionId: 's1',
                        bundleVersionId: 'bv-export',
                        canceledAt: null,
                        canceledEffectiveAt: null,
                    },
                ],
                versions: {
                    'bv-export': { bundleKey: 'EXPORT_PLUS', features: ['EXPORT'], quotas: {} },
                },
                withdrawals: [withdrawal()],
            },
        );
        assert.deepEqual(await features(svc, ms(FROM, -1)), ['EXPORT'], 'which granted it before');
        assert.deepEqual(await features(svc, NOW), []);
    });

    test('is not granted by special terms', async () => {
        const svc = entitlementServiceFor(
            EntitlementService,
            subscription({
                planVersion: { planId: 'PRO', quotas: {}, features: [] },
                customLimits: { features: ['EXPORT'] },
            }),
            { withdrawals: [withdrawal()] },
        );
        assert.deepEqual(await features(svc, ms(FROM, -1)), ['EXPORT'], 'which granted it before');
        assert.deepEqual(await features(svc, NOW), []);
    });

    test('is not granted by the floor a cancelled subscription falls back to', async () => {
        const ended = subscription({
            canceledAt: new Date('2026-01-01'),
            canceledEffectiveAt: new Date('2026-01-01'),
        });
        const floorGrants = { canceledEntitlementPlan: 'PRO' };
        const svc = entitlementServiceFor(EntitlementService, ended, {
            config: floorGrants,
            withdrawals: [withdrawal()],
        });
        assert.deepEqual(await features(svc, ms(FROM, -1)), ['EXPORT'], 'which granted it before');
        assert.deepEqual(await features(svc, NOW), []);
    });

    test('is not granted through an old key that a replaces chain carries to it', async () => {
        const svc = new EntitlementService(
            givenPlanCatalogSource(CATALOG),
            {
                findByTenantId: async () =>
                    subscription({
                        planVersion: { planId: 'PRO', quotas: {}, features: ['OLD_EXPORT'] },
                    }),
            },
            { findActive: async () => null },
            { run: async (fn) => fn(undefined) },
            null,
            null,
            null,
            null,
            { features: [{ featureKey: 'EXPORT', replaces: ['OLD_EXPORT'] }] },
            { list: async () => [withdrawal()] },
        );
        assert.deepEqual(await features(svc, ms(FROM, -1)), ['EXPORT', 'OLD_EXPORT']);
        const granted = await features(svc, NOW);
        assert.ok(!granted.includes('EXPORT'), `EXPORT is withdrawn, granted: ${granted}`);
    });

    test('is still recorded by a contract frozen while it is withdrawn', async () => {
        const svc = entitlementServiceFor(EntitlementService, subscription(), {
            withdrawals: [withdrawal()],
        });
        const { limits } = await svc.computeContractLimits('t1', NOW, CATALOG);
        assert.deepEqual([...limits.features], ['EXPORT'], 'the agreement is not rewritten');
    });

    test('is withdrawn from nobody where the installation keeps no withdrawals', async () => {
        const svc = entitlementServiceFor(EntitlementService, subscription());
        assert.deepEqual(await features(svc, NOW), ['EXPORT']);
    });
});

// @requirement SC-ENTL-025 — A feature withdrawn for a reason outside the platform is granted to nobody
describe('an answer cached before a withdrawal changes', () => {
    test('is not served past the moment it takes effect', async () => {
        const svc = entitlementServiceFor(EntitlementService, subscription(), {
            withdrawals: [withdrawal()],
        });
        // A second before the date, which would cache it for sixty.
        assert.deepEqual(await features(svc, ms(FROM, -1_000)), ['EXPORT']);
        assert.deepEqual(await features(svc, ms(FROM, 1)), [], 'the entry outlived the date');
    });

    test('nor past the moment it is lifted', async () => {
        const svc = entitlementServiceFor(EntitlementService, subscription(), {
            withdrawals: [withdrawal({ liftedFrom: LIFTED })],
        });
        assert.deepEqual(await features(svc, ms(LIFTED, -1_000)), []);
        assert.deepEqual(
            await features(svc, ms(LIFTED, 1)),
            ['EXPORT'],
            'the entry outlived the lift',
        );
    });
});

// @requirement SC-ENTL-025 — A feature withdrawn for a reason outside the platform is granted to nobody
describe('the default enforcement stack', () => {
    const resolver = { getPlanIdForTenant: async () => 'PRO' };

    test('does not grant a withdrawn feature either', async () => {
        const svc = new StaticEntitlementService(givenPlanCatalogSource(CATALOG), resolver, {
            list: async () => [withdrawal()],
        });
        assert.equal(await svc.hasFeature('t1', 'EXPORT'), false);
        const snapshot = await svc.snapshot('t1');
        assert.deepEqual([...snapshot.features], []);
    });

    test('and grants it where nothing is withdrawn', async () => {
        const svc = new StaticEntitlementService(givenPlanCatalogSource(CATALOG), resolver, {
            list: async () => [withdrawal({ liftedFrom: ms(FROM, -1) })],
        });
        assert.deepEqual([...(await svc.snapshot('t1')).features], ['EXPORT']);
    });
});
