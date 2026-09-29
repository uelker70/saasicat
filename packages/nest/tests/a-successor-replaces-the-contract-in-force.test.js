// A successor takes the place of the contract in force: the one ends,
// superseded, and the other is written — both, or neither, and only while the
// contract being replaced is still as it was read.
//
// Two writers reach this: a plan change (the freeze) and an operator's refresh.
// Each reads the contract in force, composes a successor, and writes it; if the
// other gets there in between, the tenant must not end up with two contracts
// in force, nor with none.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    SubscriptionContractFreezeService,
    givenPlanCatalogSource,
} from '../dist/billing/index.js';
import { SubscriptionContractService } from '../dist/subscription-contract/index.js';
import {
    FakeSubscriptionContractRepository,
    FakeTransactionRunner,
} from '../dist/testing/index.js';
import { anAccount, line, utc } from './helpers/charge-journal.js';
import { partiesNamed } from './helpers/contract-parties.js';
import { boundPlanVersion } from './helpers/subscription-fixtures.js';

const SIGNED = new Date('2026-06-01T00:00:00.000Z');
const LATER = new Date('2026-07-01T00:00:00.000Z');

const PRICE = {
    currency: 'EUR',
    billingCycle: 'monthly',
    subtotalNet: 49,
    discountNet: 0,
    totalNet: 49,
    vatRate: 19,
    totalGross: 58.31,
};

const PLAN_LINE = {
    kind: 'plan',
    sourceKey: 'STANDARD',
    sourceVersionId: 'pv-1',
    titleSnapshot: 'Standard',
    descriptionSnapshot: null,
    quantity: 1,
    unit: null,
    priceNet: 49,
    priceGross: 58.31,
    billingCycle: 'monthly',
    currency: 'EUR',
    taxRate: 19,
    taxAmount: 9.31,
    minimumTermUntil: null,
    featuresSnapshot: ['CORE'],
    quotaEffectsSnapshot: { users: 5 },
    metadata: null,
};

function contractData(overrides = {}) {
    return {
        tenantId: 't1',
        status: 'active',
        effectiveFrom: SIGNED,
        priceSnapshot: PRICE,
        entitlementSnapshot: { plan: 'STANDARD', quotas: { users: 5 }, features: ['CORE'] },
        lineItems: [PLAN_LINE],
        ...overrides,
    };
}

/** A contract service over an in-memory store whose writes are recorded with their transaction. */
function contractsWith({ runner = new FakeTransactionRunner() } = {}) {
    const repo = new FakeSubscriptionContractRepository();
    const writes = [];
    const supersede = repo.supersede.bind(repo);
    const create = repo.create.bind(repo);
    repo.supersede = async (id, data, tx) => {
        writes.push(['supersede', tx]);
        return supersede(id, data, tx);
    };
    repo.create = async (data, tx) => {
        writes.push(['create', tx]);
        return create(data, tx);
    };
    const subscriber = { parties: partiesNamed('Tenant One GmbH') };
    const service = new SubscriptionContractService(
        repo,
        {
            requireForTenant: async () => ({ id: 'subscriber-t1' }),
            contractPartiesFor: async () => subscriber.parties,
        },
        runner,
    );
    return { repo, service, writes, subscriber, runner };
}

async function inForce(t) {
    return t.repo.create({ ...contractData(), parties: partiesNamed('Tenant One GmbH') });
}

describe('writing a successor', () => {
    test('ends the contract in force as superseded and writes the successor, on one transaction', async () => {
        const t = contractsWith();
        const previous = await inForce(t);
        t.writes.length = 0;

        const next = await t.service.writeSuccessor(
            previous,
            contractData({ effectiveFrom: LATER }),
            LATER,
        );

        const ended = await t.repo.findById(previous.id);
        assert.equal(ended.status, 'superseded');
        assert.equal(ended.effectiveUntil.toISOString(), LATER.toISOString());
        assert.equal((await t.repo.findActiveByTenantId('t1', LATER)).id, next.id);
        assert.equal(t.runner.runCount, 1);
        assert.deepEqual(
            t.writes,
            [
                ['supersede', FakeTransactionRunner.TX_SENTINEL],
                ['create', FakeTransactionRunner.TX_SENTINEL],
            ],
            'both writes on the transaction the runner opened',
        );
    });

    test('without a runner the two are written one after the other', async () => {
        const t = contractsWith({ runner: null });
        const previous = await inForce(t);

        const next = await t.service.writeSuccessor(
            previous,
            contractData({ effectiveFrom: LATER }),
            LATER,
        );

        assert.equal((await t.repo.findActiveByTenantId('t1', LATER)).id, next.id);
    });

    test('a successor that cannot be written is refused before the contract in force ends', async () => {
        const t = contractsWith();
        const previous = await inForce(t);
        t.writes.length = 0;

        await assert.rejects(() =>
            t.service.writeSuccessor(
                previous,
                contractData({ effectiveFrom: LATER, lineItems: [] }),
                LATER,
            ),
        );
        await assert.rejects(
            () => t.service.writeSuccessor(previous, contractData(), SIGNED),
            (error) =>
                error.getResponse().code === 'SUBSCRIPTION_CONTRACT_TERMINATION_BEFORE_START',
        );

        assert.deepEqual(t.writes, []);
        assert.equal((await t.repo.findById(previous.id)).status, 'active');
    });

    test('a contract that moved since it was read is not superseded twice, and nothing is written', async () => {
        const t = contractsWith();
        const previous = await inForce(t);
        // Another writer got there first.
        await t.repo.supersede(previous.id, {
            tenantId: previous.tenantId,
            at: LATER,
            readEffectiveUntil: null,
        });
        await t.repo.create({
            ...contractData({ effectiveFrom: LATER }),
            parties: partiesNamed('x'),
        });

        const written = await t.service.writeSuccessor(
            previous,
            contractData({ effectiveFrom: LATER }),
            LATER,
        );

        assert.equal(written, null);
        assert.equal((await t.repo.list({ tenantId: 't1' })).length, 2, 'no third contract');
    });

    test('a contract whose end was declared since it was read is not superseded either', async () => {
        const t = contractsWith();
        const previous = await inForce(t);
        await t.repo.terminate(previous.id, {
            tenantId: previous.tenantId,
            effectiveUntil: new Date('2026-12-31'),
            status: null,
        });

        const written = await t.service.writeSuccessor(
            previous,
            contractData({ effectiveFrom: LATER }),
            LATER,
        );

        assert.equal(written, null);
    });

    test('with nothing in force it writes the first contract, and one that ended does not stand in its way', async () => {
        const t = contractsWith();
        const ended = await inForce(t);
        await t.repo.terminate(ended.id, {
            tenantId: ended.tenantId,
            effectiveUntil: LATER,
            status: 'terminated',
        });
        const after = new Date('2026-08-01T00:00:00.000Z');

        const first = await t.service.writeSuccessor(
            null,
            contractData({ effectiveFrom: after }),
            after,
        );

        assert.equal((await t.repo.findActiveByTenantId('t1', after)).id, first.id);
    });

    test('with nothing in force at its moment, it is not written beside a contract that begins later', async () => {
        // Two writers a few milliseconds apart: the later one superseded the
        // contract in force and wrote its successor from its own moment, so the
        // earlier one finds nothing in force at its moment.
        const t = contractsWith();
        const previous = await inForce(t);
        const earlier = new Date('2026-07-01T00:00:00.000Z');
        const later = new Date('2026-07-01T00:00:00.005Z');
        await t.repo.supersede(previous.id, {
            tenantId: previous.tenantId,
            at: later,
            readEffectiveUntil: null,
        });
        const theirs = await t.repo.create({
            ...contractData({ effectiveFrom: later }),
            parties: partiesNamed('Tenant One GmbH'),
        });
        assert.equal(await t.repo.findActiveByTenantId('t1', earlier), null);

        const written = await t.service.writeSuccessor(
            null,
            contractData({ effectiveFrom: earlier }),
            earlier,
        );

        assert.equal(written, null);
        const running = (await t.repo.list({ tenantId: 't1' })).filter(
            (c) => c.status === 'active',
        );
        assert.deepEqual(
            running.map((c) => c.id),
            [theirs.id],
            'one contract in force from the later moment on',
        );
    });

    test('the parties are copied afresh, unless the successor keeps the ones agreed', async () => {
        const t = contractsWith();
        const previous = await inForce(t);
        t.subscriber.parties = partiesNamed('Tenant One AG');

        const fresh = await t.service.writeSuccessor(
            previous,
            contractData({ effectiveFrom: LATER }),
            LATER,
        );
        assert.equal(fresh.subscriber.legalName, 'Tenant One AG');

        const later = new Date('2026-08-01T00:00:00.000Z');
        const kept = await t.service.writeSuccessor(
            fresh,
            contractData({ effectiveFrom: later }),
            later,
            {
                keepParties: true,
            },
        );
        assert.equal(kept.subscriber.legalName, 'Tenant One AG');
        assert.equal(kept.partiesMigrated, false);
    });
});

describe('replacing the contract in force', () => {
    test('reads again once when the contract moved in between, and writes against the new one', async () => {
        const t = contractsWith();
        await inForce(t);
        const supersede = t.repo.supersede;
        let raced = false;
        t.repo.supersede = async (id, data, tx) => {
            if (!raced) {
                raced = true;
                // Another writer supersedes it and writes its own successor.
                await supersede(
                    id,
                    { tenantId: data.tenantId, at: LATER, readEffectiveUntil: null },
                    tx,
                );
                await t.repo.create({
                    ...contractData({ effectiveFrom: LATER }),
                    parties: partiesNamed('Tenant One GmbH'),
                });
            }
            return supersede(id, data, tx);
        };
        const at = new Date('2026-08-01T00:00:00.000Z');

        const { next } = await t.service.replaceActiveContract(
            't1',
            contractData({ effectiveFrom: at }),
            at,
        );

        assert.equal((await t.repo.findActiveByTenantId('t1', at)).id, next.id);
        const running = (await t.repo.list({ tenantId: 't1' })).filter(
            (c) => c.status === 'active',
        );
        assert.equal(running.length, 1, 'one contract in force');
    });

    test('refuses with SUBSCRIPTION_CONTRACT_CHANGED once it has moved on every attempt', async () => {
        const t = contractsWith();
        await inForce(t);
        t.repo.supersede = async () => null;

        await assert.rejects(
            () =>
                t.service.replaceActiveContract(
                    't1',
                    contractData({ effectiveFrom: LATER }),
                    LATER,
                ),
            (error) => error.getResponse().code === 'SUBSCRIPTION_CONTRACT_CHANGED',
        );
    });
});

describe('a plan change beside another writer', () => {
    function freezeOver(t) {
        const plan = {
            id: 'STANDARD',
            name: 'Standard',
            monthlyNet: 49,
            yearlyNet: 490,
            quotas: {},
            features: [],
        };
        return new SubscriptionContractFreezeService(
            givenPlanCatalogSource({
                schemaVersion: 1,
                app: { name: 'Demo' },
                currency: 'EUR',
                vatRate: 19,
                plans: [plan],
            }),
            {
                computeContractLimits: async () => ({
                    limits: { plan: 'STANDARD', quotas: {}, features: new Set() },
                    leftOutBundleVersionIds: [],
                }),
                invalidateTenant() {},
            },
            t.service,
            {
                findBoundPlanVersion: async () => boundPlanVersion(plan, 'pv-1'),
                loadBookedBundles: async () => ({ lineItems: [], bundleVersionIds: [] }),
            },
        );
    }

    test('a plan change a moment before another writer’s successor is refused, not written beside it', async () => {
        const t = contractsWith();
        const previous = await inForce(t);
        const earlier = new Date('2026-07-01T00:00:00.000Z');
        const later = new Date('2026-07-01T00:00:00.005Z');
        await t.repo.supersede(previous.id, {
            tenantId: previous.tenantId,
            at: later,
            readEffectiveUntil: null,
        });
        await t.repo.create({
            ...contractData({ effectiveFrom: later }),
            parties: partiesNamed('Tenant One GmbH'),
        });

        await assert.rejects(
            () => freezeOver(t).freezeOnPlanChange('t1', 'STANDARD', 'MONTHLY', earlier, null),
            (error) => error.getResponse().code === 'SUBSCRIPTION_CONTRACT_CHANGED',
        );
        const inForceLater = await t.repo.list({ tenantId: 't1', asOf: later });
        assert.equal(inForceLater.length, 1, 'one contract in force');
    });

    test('refuses with SUBSCRIPTION_CONTRACT_CHANGED rather than write a second contract in force', async () => {
        const t = contractsWith();
        await inForce(t);
        t.repo.supersede = async () => null;

        await assert.rejects(
            () => freezeOver(t).freezeOnPlanChange('t1', 'STANDARD', 'MONTHLY', LATER, null),
            (error) => error.getResponse().code === 'SUBSCRIPTION_CONTRACT_CHANGED',
        );
        assert.equal((await t.repo.list({ tenantId: 't1' })).length, 1);
    });
});

// @requirement SC-ENTL-023 — An operator carries a changed vocabulary into running contracts, seeing it first
describe('a successor that copies its lines as they stand', () => {
    const STANDARD = () => line('plan', 'STANDARD', 49, { sourceVersionId: 'pv-standard' });

    async function chargedThroughFebruary(withSuccessor) {
        const account = anAccount();
        await account.contract({ lineItems: [STANDARD()] });
        await account.charge(utc('2026-01-10'));
        if (withSuccessor) {
            await account.supersede(utc('2026-01-15'));
            await account.contract({ effectiveFrom: utc('2026-01-15'), lineItems: [STANDARD()] });
        }
        await account.charge(utc('2026-01-20'));
        account.roll(utc('2026-02-01'), utc('2026-03-01'));
        await account.charge(utc('2026-02-01'));
        return account.entries();
    }

    test('gives rise to no charge of its own, in its first period or after', async () => {
        assert.deepEqual(await chargedThroughFebruary(true), await chargedThroughFebruary(false));
        assert.deepEqual(await chargedThroughFebruary(true), [
            ['2026-01-01', 'plan', 'activation', 49],
            ['2026-02-01', 'plan', 'renewal', 49],
        ]);
    });
});
