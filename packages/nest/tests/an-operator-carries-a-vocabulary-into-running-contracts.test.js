// An operator carries a changed feature vocabulary into the contracts in force
// (`SC-ENTL-023`), and is told where a contract has fallen behind
// (`SC-ENTL-022`).
//
// The real refresh, freeze, contract and entitlement services over in-memory
// stores. A contract is frozen the way a plan change freezes it; the plan
// version is then edited in place, the way autohauspro#107 renamed `ATLAS` to
// `ATLAS_AES`; and the tests look at what the operator is shown, what is
// written, and what the tenant is granted afterwards.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { AdminAuditService } from '../dist/admin/index.js';
import {
    ContractRefreshService,
    SubscriptionContractFreezeService,
    givenPlanCatalogSource,
} from '../dist/billing/index.js';
import { EntitlementService } from '../dist/entitlement/index.js';
import { SubscriptionContractService } from '../dist/subscription-contract/index.js';
import {
    FakePlanVersionRepository,
    FakeSubscriptionContractRepository,
    FakeSubscriptionRepository,
    FakeTransactionRunner,
} from '../dist/testing/index.js';
import { partiesNamed } from './helpers/contract-parties.js';
import { boundPlanVersion, usageRecord } from './helpers/subscription-fixtures.js';
import { TAX_SETTINGS, originIn, taxesDeciding } from './helpers/tax-adapter.js';
import { UnprocessableEntityException } from '@nestjs/common';
import { ERROR_MESSAGES_EN, formatErrorMessage } from '@saasicat/core';

/** The refusal of a subscriber whose invoice address lacks `missing`, as the platform words it. */
function anIncompleteAddress(missing) {
    const code = 'SUBSCRIBER_IDENTITY_INCOMPLETE';
    return new UnprocessableEntityException({
        code,
        message: formatErrorMessage(ERROR_MESSAGES_EN[code], { missing }),
        params: { missing },
    });
}

const FROZEN = new Date('2026-05-01T00:00:00.000Z');
const NOW = new Date('2026-06-15T00:00:00.000Z');
const ADD_ON_ENDS = new Date('2026-09-30T00:00:00.000Z');

const OPERATOR = { userId: 'user-ops', email: 'ops@example.com', source: 'cli', context: 'host' };

/** Five extra users, the add-on of the example on #73. */
const TEAM = { bundleKey: 'TEAM', features: ['TEAM'], quotas: { users: 5 } };

function feature(featureKey, replaces = null) {
    return { featureKey, capabilityKeys: [], requires: null, replaces };
}

class RecordingAudit {
    entries = [];
    async write(entry) {
        this.entries.push(entry);
    }
}

/**
 * One tenant on Standard, frozen at `FROZEN` with the code's vocabulary as it
 * is after the rename: `ATLAS_AES` declared, `ATLAS` gone — unless a test
 * passes a `replaces` declaration that carries it over. With `taxes` the file
 * names the test tax adapter instead of a rate, and the subscriber is a
 * consumer in Germany until a test moves it (`origin.current`).
 */
function installation({ replaces = null, taxes = null } = {}) {
    const plan = {
        id: 'STANDARD',
        name: 'Standard',
        tagline: '',
        marketed: true,
        monthlyNet: 49,
        yearlyNet: 490,
        quotas: { users: 5 },
        features: ['CORE', 'ATLAS'],
    };
    const catalog = {
        schemaVersion: 1,
        app: { name: 'Demo App' },
        currency: 'EUR',
        ...(taxes ? TAX_SETTINGS : { vatRate: 19 }),
        plans: [plan],
    };
    const bookings = [];
    const subscription = {
        id: 'sub-1',
        tenantId: 't1',
        plan: 'STANDARD',
        status: 'ACTIVE',
        isPilot: false,
        trialEntitlementPlan: null,
        pendingPlan: null,
        pendingEffectiveAt: null,
        customLimits: null,
        planVersionId: 'pv-standard',
        // The same objects the plan holds, so an edit in place reaches the
        // version the subscription is bound to — as a row edited in place does.
        planVersion: { planId: 'STANDARD', quotas: plan.quotas, features: plan.features },
        canceledAt: null,
        canceledEffectiveAt: null,
    };
    const subscriptions = new FakeSubscriptionRepository();
    subscriptions.set(subscription);
    const discovery = {
        features: [feature('CORE'), feature('ATLAS_AES', replaces), feature('TEAM')],
    };
    const repo = new FakeSubscriptionContractRepository();
    const parties = { current: partiesNamed('Tenant One GmbH') };
    const origin = { current: originIn('DE') };
    const contracts = new SubscriptionContractService(
        repo,
        {
            requireForTenant: async () => ({ id: 'subscriber-t1' }),
            contractPartiesFor: async () => parties.current,
            taxOriginFor: async () => origin.current,
            async taxOriginOfComplete() {
                if (installed.identityIncomplete) throw anIncompleteAddress(['city']);
                return origin.current;
            },
        },
        null,
        taxes,
    );
    const catalogs = givenPlanCatalogSource(catalog);
    const entitlements = new EntitlementService(
        catalogs,
        subscriptions,
        new FakePlanVersionRepository(),
        new FakeTransactionRunner(),
        null,
        {
            listActiveBySubscription: async (_subscriptionId, asOf) =>
                bookings.filter(
                    (b) => b.canceledEffectiveAt === null || b.canceledEffectiveAt > asOf,
                ),
        },
        { findVersionById: async (id) => (id === 'bv-team' ? TEAM : null) },
        repo,
        discovery,
    );
    const freeze = new SubscriptionContractFreezeService(catalogs, entitlements, contracts, {
        findBoundPlanVersion: async () => boundPlanVersion(plan, subscription.planVersionId),
        loadBookedBundles: async () => ({
            lineItems: bookings.map((b) => ({
                kind: 'bundle',
                sourceKey: 'TEAM',
                sourceVersionId: b.bundleVersionId,
                titleSnapshot: 'Team',
                descriptionSnapshot: null,
                quantity: 1,
                unit: null,
                priceNet: 10,
                billingCycle: 'monthly',
                minimumTermUntil: null,
                featuresSnapshot: TEAM.features,
                quotaEffectsSnapshot: TEAM.quotas,
                metadata: null,
            })),
            bundleVersionIds: bookings.map((b) => b.bundleVersionId),
        }),
    });
    const audit = new RecordingAudit();
    const refresh = new ContractRefreshService(
        contracts,
        entitlements,
        {
            findForTenant: async () => usageRecord({ plan: 'STANDARD', billingCycle: 'MONTHLY' }),
        },
        catalogs,
        freeze,
        discovery,
        null,
        new AdminAuditService(audit),
    );
    const installed = {
        plan,
        catalog,
        subscription,
        subscriptions,
        repo,
        contracts,
        parties,
        origin,
        audit,
        entitlements,
        refresh,
        /** Freezes the tenant's contract at `at`, as a plan change does. */
        async freeze(at = FROZEN) {
            await freeze.freezeOnPlanChange('t1', 'STANDARD', 'MONTHLY', at, null);
            return repo.findActiveByTenantId('t1', at);
        },
        /** Renames `ATLAS` to `ATLAS_AES` in the plan version, in place. */
        rename() {
            plan.features.splice(plan.features.indexOf('ATLAS'), 1, 'ATLAS_AES');
        },
        book() {
            bookings.push({
                id: 'sb-team',
                bundleVersionId: 'bv-team',
                canceledEffectiveAt: null,
            });
        },
        cancelAddOn() {
            bookings[0].canceledEffectiveAt = ADD_ON_ENDS;
        },
        grants(at = NOW) {
            entitlements.invalidateTenant('t1');
            return entitlements.computeLimits('t1', at);
        },
    };
    return installed;
}

/** An installation whose contract was frozen before the vocabulary was renamed. */
async function frozenBeforeTheRename(options) {
    const t = installation(options);
    const contract = await t.freeze();
    t.rename();
    return { t, contract };
}

// @requirement SC-ENTL-022 — An operator is told which running contracts hold a feature vocabulary left behind
describe('what `doctor` is told', () => {
    test('a contract frozen before a rename holds a key the code dropped and lacks its successor', async () => {
        const { t, contract } = await frozenBeforeTheRename();

        const report = await t.refresh.inspect(NOW);

        assert.equal(report.inForce, 1);
        assert.deepEqual(
            report.stale.map((stale) => [stale.contractId, stale.vocabulary]),
            [[contract.id, { unknown: ['ATLAS'], missing: ['ATLAS_AES'] }]],
        );
    });

    test('a replaces declaration that carries the old key over leaves nothing to report', async () => {
        const t = installation({ replaces: ['ATLAS'] });
        const frozen = await t.freeze();
        // Frozen before the code declared the replacement, so the snapshot
        // holds the old key alone and only the declaration grants the new one.
        await t.repo.terminate(frozen.id, {
            tenantId: frozen.tenantId,
            effectiveUntil: FROZEN,
            status: 'superseded',
        });
        await t.repo.create({
            ...t.contracts.dataOf(frozen),
            status: 'active',
            effectiveFrom: new Date(FROZEN.getTime() + 1),
            entitlementSnapshot: { ...frozen.entitlementSnapshot, features: ['ATLAS', 'CORE'] },
            parties: partiesNamed('Tenant One GmbH'),
        });
        t.rename();

        const report = await t.refresh.inspect(NOW);

        assert.deepEqual(report.stale, []);
        const granted = await t.grants();
        assert.ok(granted.features.has('ATLAS_AES'), 'the declaration grants the successor');
    });

    test('a contract frozen with today’s vocabulary is not reported', async () => {
        const t = installation();
        t.rename();
        await t.freeze();

        assert.deepEqual((await t.refresh.inspect(NOW)).stale, []);
    });

    test('a contract whose features today cannot be read is named as such, not passed as current', async () => {
        // Nothing in its snapshot is unknown, so the one thing that would show
        // is what it lacks — which cannot be read without the subscription.
        const t = installation();
        t.rename();
        const contract = await t.freeze();
        t.subscriptions.delete('t1');

        const report = await t.refresh.inspect(NOW);

        assert.deepEqual(report.stale, []);
        assert.deepEqual(
            report.unreadable.map((preview) => [preview.contractId, preview.refusal.code]),
            [[contract.id, 'NO_SUBSCRIPTION']],
        );
    });

    test('inspecting writes nothing', async () => {
        const { t, contract } = await frozenBeforeTheRename();

        await t.refresh.inspect(NOW);

        const inForce = await t.repo.findActiveByTenantId('t1', NOW);
        assert.equal(inForce.id, contract.id);
        assert.deepEqual(t.audit.entries, []);
    });
});

// @requirement SC-ENTL-023 — An operator carries a changed vocabulary into running contracts, seeing it first
describe('carrying the features over', () => {
    test('the preview shows the change and writes nothing', async () => {
        const { t, contract } = await frozenBeforeTheRename();

        const [preview] = await t.refresh.preview({}, 'features', NOW);

        assert.deepEqual(preview.features, { added: ['ATLAS_AES'], removed: ['ATLAS'] });
        assert.deepEqual(preview.quotas, []);
        assert.deepEqual(preview.money, []);
        assert.equal(preview.changes, true);
        assert.equal(preview.refusal, null);
        assert.equal((await t.repo.findActiveByTenantId('t1', NOW)).id, contract.id);
        assert.ok(!(await t.grants()).features.has('ATLAS_AES'), 'nothing was granted yet');
    });

    test('applied, a successor grants the new key and the contract it replaces is kept, superseded', async () => {
        const { t, contract } = await frozenBeforeTheRename();

        const [outcome] = await t.refresh.apply({}, 'features', OPERATOR, NOW);

        const successor = await t.repo.findActiveByTenantId('t1', NOW);
        assert.equal(outcome.successorId, successor.id);
        assert.notEqual(successor.id, contract.id);
        assert.deepEqual(successor.entitlementSnapshot.features, ['ATLAS_AES', 'CORE']);
        assert.equal(successor.effectiveFrom.toISOString(), NOW.toISOString());

        const kept = await t.repo.findById(contract.id);
        assert.equal(kept.status, 'superseded');
        assert.equal(kept.effectiveUntil.toISOString(), NOW.toISOString());
        assert.deepEqual(
            [...kept.entitlementSnapshot.features].sort(),
            ['ATLAS', 'CORE'],
            'not rewritten',
        );

        assert.ok((await t.grants()).features.has('ATLAS_AES'));
    });

    test('lines, prices, terms, window and quotas are copied as they stand', async () => {
        const { t, contract } = await frozenBeforeTheRename();
        // A price edited in place as well: replacing features must not carry it.
        t.plan.monthlyNet = 59;

        await t.refresh.apply({}, 'features', OPERATOR, NOW);

        const successor = await t.repo.findActiveByTenantId('t1', NOW);
        const moneyOf = (c) =>
            c.lineItems.map(
                ({ kind, sourceKey, sourceVersionId, priceNet, priceGross, taxRate }) => ({
                    kind,
                    sourceKey,
                    sourceVersionId,
                    priceNet,
                    priceGross,
                    taxRate,
                }),
            );
        assert.deepEqual(moneyOf(successor), moneyOf(contract));
        assert.deepEqual(successor.priceSnapshot, contract.priceSnapshot);
        assert.deepEqual(successor.entitlementSnapshot.quotas, contract.entitlementSnapshot.quotas);
        assert.equal(successor.originalPlanVersionId, contract.originalPlanVersionId);
        assert.equal(successor.effectiveUntil, contract.effectiveUntil);
    });

    test('the parties are the ones agreed, not a correction made since — and a migrated copy stays marked', async () => {
        const t = installation();
        const frozen = await t.freeze();
        // The contract as the migration left it: parties copied, and said so.
        await t.repo.terminate(frozen.id, {
            tenantId: frozen.tenantId,
            effectiveUntil: FROZEN,
            status: 'superseded',
        });
        const migrated = await t.repo.create({
            ...t.contracts.dataOf(frozen),
            status: 'active',
            effectiveFrom: new Date(FROZEN.getTime() + 1),
            parties: partiesNamed('Tenant One GmbH'),
            partiesMigrated: true,
        });
        t.rename();
        t.parties.current = partiesNamed('Tenant One AG');

        await t.refresh.apply({}, 'features', OPERATOR, NOW);

        const successor = await t.repo.findActiveByTenantId('t1', NOW);
        assert.notEqual(successor.id, migrated.id);
        assert.equal(successor.subscriber.legalName, 'Tenant One GmbH');
        assert.equal(successor.partiesMigrated, true);
    });

    test('a contract whose features are already today’s is left as it is', async () => {
        const t = installation();
        t.rename();
        const contract = await t.freeze();

        const [outcome] = await t.refresh.apply({}, 'features', OPERATOR, NOW);

        assert.equal(outcome.changes, false);
        assert.equal(outcome.successorId, null);
        assert.equal((await t.repo.findActiveByTenantId('t1', NOW)).id, contract.id);
        assert.deepEqual(t.audit.entries, []);
    });

    test('a subscription bound to another version than the contract records is refused, and named', async () => {
        const { t, contract } = await frozenBeforeTheRename();
        t.subscription.planVersionId = 'pv-standard-2';

        const [outcome] = await t.refresh.apply({}, 'features', OPERATOR, NOW);

        assert.deepEqual(outcome.refusal, {
            code: 'PLAN_VERSION_MOVED',
            recorded: 'pv-standard',
            bound: 'pv-standard-2',
        });
        assert.equal((await t.repo.findActiveByTenantId('t1', NOW)).id, contract.id);
    });

    test('the quotas of a cancelled add-on stay: replacing features changes nothing it counts', async () => {
        const t = installation();
        t.book();
        await t.freeze();
        t.cancelAddOn();
        t.rename();

        await t.refresh.apply({}, 'features', OPERATOR, NOW);

        const successor = await t.repo.findActiveByTenantId('t1', NOW);
        assert.equal(successor.entitlementSnapshot.quotas.users, 10);
        assert.ok(successor.entitlementSnapshot.features.includes('TEAM'));
    });

    test('the refresh is in the audit log, with the contract it replaced', async () => {
        const { t, contract } = await frozenBeforeTheRename();

        const [outcome] = await t.refresh.apply({}, 'features', OPERATOR, NOW);

        assert.deepEqual(
            t.audit.entries.map((entry) => [
                entry.action,
                entry.entityId,
                entry.changes.supersedes,
            ]),
            [['SUBSCRIPTION_CONTRACT_REFRESH', outcome.successorId, contract.id]],
        );
    });
});

// @requirement SC-ENTL-023 — An operator carries a changed vocabulary into running contracts, seeing it first
describe('re-freezing in full', () => {
    test('leaves a cancelled add-on out of the snapshot, names it, and keeps billing it', async () => {
        const t = installation();
        t.book();
        const contract = await t.freeze();
        t.cancelAddOn();

        const [preview] = await t.refresh.preview({}, 'full', NOW);
        assert.deepEqual(preview.quotas, [{ key: 'users', before: 10, after: 5 }]);
        assert.deepEqual(preview.money, []);
        assert.equal(preview.refusal, null);

        await t.refresh.apply({}, 'full', OPERATOR, NOW);
        const successor = await t.repo.findActiveByTenantId('t1', NOW);
        assert.deepEqual(successor.entitlementSnapshot.leftOutBundleVersionIds, ['bv-team']);
        assert.ok(successor.lineItems.some((line) => line.sourceVersionId === 'bv-team'));
        assert.equal((await t.repo.findById(contract.id)).status, 'superseded');

        const before = await t.grants(new Date(ADD_ON_ENDS.getTime() - 1));
        const after = await t.grants(ADD_ON_ENDS);
        assert.equal(before.quotas.users, 10, 'the booking grants it until its date');
        assert.equal(after.quotas.users, 5);
    });

    test('a price edited into the plan version in place is refused, named, and not written', async () => {
        const { t, contract } = await frozenBeforeTheRename();
        t.plan.monthlyNet = 59;

        const [outcome] = await t.refresh.apply({}, 'full', OPERATOR, NOW);

        assert.deepEqual(outcome.refusal, { code: 'MONEY_WOULD_CHANGE' });
        assert.ok(outcome.money.some((change) => change.field === 'priceSnapshot.totalNet'));
        assert.equal(outcome.successorId, null);
        assert.equal((await t.repo.findActiveByTenantId('t1', NOW)).id, contract.id);
    });

    test('a tax rate changed in the configuration is refused', async () => {
        const { t } = await frozenBeforeTheRename();
        t.catalog.vatRate = 7;

        const [outcome] = await t.refresh.preview({}, 'full', NOW);

        assert.deepEqual(outcome.refusal, { code: 'MONEY_WOULD_CHANGE' });
        assert.ok(outcome.money.some((change) => change.field === 'priceSnapshot.vatRate'));
    });

    test('a currency changed in the configuration is refused', async () => {
        const { t } = await frozenBeforeTheRename();
        t.catalog.currency = 'CHF';

        const [outcome] = await t.refresh.preview({}, 'full', NOW);

        assert.deepEqual(outcome.refusal, { code: 'MONEY_WOULD_CHANGE' });
        assert.ok(outcome.money.some((change) => change.field === 'priceSnapshot.currency'));
    });

    test('keeps the terms, the offer and each line’s minimum term the contract agreed', async () => {
        const t = installation();
        const frozen = await t.freeze();
        // As an offer concludes it: terms, the offer, a minimum term on the plan line.
        const minimumTermUntil = new Date('2027-05-01T00:00:00.000Z');
        await t.repo.terminate(frozen.id, {
            tenantId: frozen.tenantId,
            effectiveUntil: FROZEN,
            status: 'superseded',
        });
        await t.repo.create({
            ...t.contracts.dataOf(frozen),
            status: 'active',
            effectiveFrom: new Date(FROZEN.getTime() + 1),
            originalOfferId: 'offer-1',
            termsSnapshot: { noticePeriodDays: 30 },
            lineItems: t.contracts
                .dataOf(frozen)
                .lineItems.map((line) => ({ ...line, minimumTermUntil })),
            parties: partiesNamed('Tenant One GmbH'),
        });
        t.rename();

        const [outcome] = await t.refresh.apply({}, 'full', OPERATOR, NOW);

        assert.ok(outcome.successorId, 'written');
        const successor = await t.repo.findActiveByTenantId('t1', NOW);
        assert.equal(successor.originalOfferId, 'offer-1');
        assert.deepEqual(successor.termsSnapshot, { noticePeriodDays: 30 });
        const plan = successor.lineItems.find((line) => line.kind === 'plan');
        assert.equal(plan.minimumTermUntil.toISOString(), minimumTermUntil.toISOString());
    });

    test('with the money unchanged, it carries the renamed feature too', async () => {
        const { t } = await frozenBeforeTheRename();

        const [outcome] = await t.refresh.apply({}, 'full', OPERATOR, NOW);

        assert.equal(outcome.refusal, null);
        assert.ok(outcome.successorId);
        assert.ok((await t.grants()).features.has('ATLAS_AES'));
    });
});

// @requirement SC-PRIC-067 — A contract records the rate and the treatment it was concluded at
describe('where a tax adapter decides', () => {
    /** Frozen for a consumer in Germany before the vocabulary was renamed. */
    async function frozenAtTheDecidedRate() {
        const t = installation({ taxes: taxesDeciding() });
        const contract = await t.freeze();
        t.rename();
        return { t, contract };
    }

    test('the features are carried over while the rate decided for the subscriber stands', async () => {
        const { t, contract } = await frozenAtTheDecidedRate();
        assert.equal(contract.priceSnapshot.vatRate, 19);

        const [outcome] = await t.refresh.apply({}, 'features', OPERATOR, NOW);

        const successor = await t.repo.findActiveByTenantId('t1', NOW);
        assert.equal(outcome.successorId, successor.id);
        assert.equal(successor.taxTreatment.kind, 'standard');
    });

    test('a subscriber the adapter now decides another rate for is refused in the preview and in the run', async () => {
        const { t, contract } = await frozenAtTheDecidedRate();
        t.origin.current = originIn('CH', { business: true });

        const [preview] = await t.refresh.preview({}, 'features', NOW);
        assert.equal(preview.refusal?.code, 'REFUSED');
        assert.match(preview.refusal.reason, /states 19 % in priceSnapshot\.vatRate.*decides 0 %/);

        const [outcome] = await t.refresh.apply({}, 'features', OPERATOR, NOW);
        assert.equal(outcome.successorId, null);
        assert.equal((await t.repo.findActiveByTenantId('t1', NOW)).id, contract.id);
    });

    test('a subscriber the adapter supports no treatment for is refused with its sentence', async () => {
        const { t } = await frozenAtTheDecidedRate();
        t.origin.current = originIn('FR');

        const [preview] = await t.refresh.preview({}, 'features', NOW);

        assert.equal(preview.refusal?.code, 'REFUSED');
        assert.match(preview.refusal.reason, /A consumer outside Germany is not supported/);
    });

    test('a features refresh keeps the agreed parties, so an address emptied since does not hold it back', async () => {
        const { t } = await frozenAtTheDecidedRate();
        t.identityIncomplete = true;

        const [outcome] = await t.refresh.apply({}, 'features', OPERATOR, NOW);

        assert.ok(outcome.successorId, 'carried over on the parties of the contract it succeeds');
    });

    test('a full re-freeze copies the parties anew, and an incomplete address refuses it', async () => {
        const { t } = await frozenAtTheDecidedRate();
        t.identityIncomplete = true;

        const [outcome] = await t.refresh.preview({}, 'full', NOW);

        assert.equal(outcome.refusal?.code, 'REFUSED');
        assert.match(outcome.refusal.reason, /billing address is not complete/);
    });

    test('re-freezing in full at a newly decided rate is a change of money, refused', async () => {
        const { t } = await frozenAtTheDecidedRate();
        t.origin.current = originIn('CH', { business: true });

        const [outcome] = await t.refresh.preview({}, 'full', NOW);

        assert.deepEqual(outcome.refusal, { code: 'MONEY_WOULD_CHANGE' });
        assert.ok(outcome.money.some((change) => change.field === 'priceSnapshot.vatRate'));
    });
});

// @requirement SC-ENTL-023 — An operator carries a changed vocabulary into running contracts, seeing it first
describe('what the refresh is asked about', () => {
    test('a contract named that is not in force is refused, and so is one that does not exist', async () => {
        const { t, contract } = await frozenBeforeTheRename();
        await t.refresh.apply({}, 'features', OPERATOR, NOW);

        const outcomes = await t.refresh.apply(
            { contractIds: [contract.id, 'no-such-contract'] },
            'features',
            OPERATOR,
            NOW,
        );

        assert.deepEqual(
            outcomes.map((outcome) => [
                outcome.contractId,
                outcome.tenantId,
                outcome.refusal?.code,
            ]),
            [
                [contract.id, 't1', 'NOT_IN_FORCE'],
                ['no-such-contract', null, 'NOT_IN_FORCE'],
            ],
        );
    });

    test('a contract that moves between the read and the write is left alone, and said so', async () => {
        const { t, contract } = await frozenBeforeTheRename();
        // A plan change gets there first and supersedes the contract the
        // refresh has read.
        const supersede = t.repo.supersede.bind(t.repo);
        t.repo.supersede = async (id, data, tx) => {
            await supersede(id, { tenantId: data.tenantId, at: NOW, readEffectiveUntil: null });
            return supersede(id, data, tx);
        };

        const [outcome] = await t.refresh.apply({}, 'features', OPERATOR, NOW);

        assert.equal(outcome.moved, true);
        assert.equal(outcome.successorId, null);
        const all = await t.repo.list({ tenantId: 't1' });
        assert.equal(all.length, 1, 'no successor was written');
        assert.equal(all[0].id, contract.id);
    });
});
