// The operator reads the contract register of the installation: every
// contract, a former subscriber's and a deleted tenant's included, the latest
// start first, narrowed to where the contracts stand on a day — today unless
// another is asked for —, each with its subscriber as the record names it now
// and its tenant as the application still knows it or not. The service is
// given the stores as the platform gives them, so what is asserted is what the
// route serves.

// @requirement SC-ADM-045 — An operator lists every contract, a former subscriber's included
// @requirement SC-ADM-046 — The contract register reads where each contract stands on a day of the installation

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CONTRACT_REGISTER_PAGE_SIZE } from '@saasicat/core';

import { ContractRegisterQueryDto, ContractRegisterService } from '../dist/billing/index.js';
import { AdminManifestService, SaaSiCatModule } from '../dist/platform/index.js';
import { FakeSubscriptionContractRepository } from '../dist/testing/index.js';
import {
    SignedInGuard,
    bootable,
    controllersIn,
    everythingOnOptions,
    handlersOf,
    withoutInvoicing,
} from './helpers/operator-routes.js';

/** Half past midnight on 17 February in Berlin, still the 16th in UTC. */
const NOW = new Date('2026-02-16T23:30:00.000Z');
const SETTINGS = { timeZone: 'Europe/Berlin' };

/** A contract line of `kind`, as frozen. */
const line = (kind, sourceKey, titleSnapshot) => ({
    kind,
    sourceKey,
    titleSnapshot,
    featuresSnapshot: [],
    quotaEffectsSnapshot: {},
});

/** What a contract of `subscriberId` for `tenantId` is written with, in force from `from` until `until`. */
function contractData(subscriberId, tenantId, from, until = null, lineItems) {
    return {
        tenantId,
        parties: {
            subscriberId,
            subscriber: { customerNumber: 'K-0', legalName: `As concluded ${subscriberId}` },
            issuer: null,
        },
        cancellationNoticeDays: 30,
        termsVersion: null,
        agreedAt: new Date(from),
        effectiveFrom: new Date(from),
        effectiveUntil: until === null ? null : new Date(until),
        priceSnapshot: { currency: 'EUR', billingCycle: 'monthly', totalGross: 119 },
        lineItems: lineItems ?? [line('plan', 'PRO', 'Pro')],
    };
}

/**
 * The stores the service reads. `known` are the tenants the application still
 * has; each read records whether it ran inside the bypass frame.
 */
function anInstallation({ known = [], settings = SETTINGS, subscriberIds } = {}) {
    const contracts = new FakeSubscriptionContractRepository();
    const reads = [];
    let bypassed = 0;
    const recorded =
        (name, read) =>
        (...args) => {
            reads.push({ name, args, bypassed: bypassed > 0 });
            return read(...args);
        };
    const reading = { listRegister: recorded('contracts', (page) => contracts.listRegister(page)) };
    const subscribers = {
        findByIds: recorded('subscribers', async (ids) =>
            ids
                .filter((id) => !subscriberIds || subscriberIds.includes(id))
                .map((id) => ({
                    id,
                    customerNumber: `K-${id.slice(-1)}`,
                    legalName: `Record of ${id}`,
                })),
        ),
    };
    const tenantsOf = recorded('tenants', async (ids) =>
        known.filter((tenant) => ids.includes(tenant.id)),
    );
    const bypass = {
        async runWithBypass(fn) {
            bypassed += 1;
            try {
                return await fn();
            } finally {
                bypassed -= 1;
            }
        },
    };
    const service = new ContractRegisterService(reading, subscribers, settings, bypass);
    const page = (query = {}) => service.page(query, tenantsOf, NOW);
    return { contracts, reads, page };
}

const ids = (page) => page.contracts.map(({ id }) => id);

describe('the contract register', () => {
    test('is the contracts in force today in the installation’s zone, the latest start first, each with its subscriber as the record names it now and its tenant', async () => {
        const { contracts, page } = anInstallation({
            known: [{ id: 'tenant-a', slug: 'acme', name: 'Acme', deletedAt: null }],
        });
        const older = await contracts.create(
            contractData('subscriber-1', 'tenant-a', '2025-06-01T00:00:00.000Z', null, [
                line('plan', 'PRO', 'Pro'),
                line('bundle', 'SMS', 'SMS'),
                line('discount', 'WELCOME', 'Welcome'),
            ]),
        );
        // From 00:00 on 17 February in Berlin: in force on the 17th there, not yet in UTC.
        const today = await contracts.create(
            contractData('subscriber-2', 'tenant-gone', '2026-02-16T23:00:00.000Z'),
        );
        await contracts.create(
            contractData(
                'subscriber-2',
                'tenant-gone',
                '2026-01-01T00:00:00.000Z',
                '2026-02-16T23:00:00.000Z',
            ),
        );

        const register = await page();

        assert.deepEqual(
            [register.today, register.day, register.state, register.next],
            ['2026-02-17', '2026-02-17', 'in-force', null],
        );
        assert.deepEqual(ids(register), [today.id, older.id]);
        assert.deepEqual(register.contracts[1], {
            id: older.id,
            subscriber: {
                id: 'subscriber-1',
                customerNumber: 'K-1',
                legalName: 'Record of subscriber-1',
            },
            tenant: { id: 'tenant-a', known: true, name: 'Acme', slug: 'acme', deletedAt: null },
            plan: { key: 'PRO', title: 'Pro' },
            bundles: [{ key: 'SMS', title: 'SMS' }],
            firstDay: '2025-06-01',
            lastDay: null,
            standing: 'in-force',
            billingCycle: 'monthly',
            currency: 'EUR',
            totalGross: 119,
        });
        assert.deepEqual(register.contracts[0].tenant, {
            id: 'tenant-gone',
            known: false,
            name: null,
            slug: null,
            deletedAt: null,
        });
    });

    test('narrowed to one standing on a day asked for, reads every standing on that day', async () => {
        const { contracts, page } = anInstallation();
        const ended = await contracts.create(
            contractData(
                'subscriber-1',
                'tenant-a',
                '2026-01-01T00:00:00.000Z',
                '2026-02-01T00:00:00.000Z',
            ),
        );
        const scheduled = await contracts.create(
            contractData('subscriber-1', 'tenant-a', '2026-03-01T00:00:00.000Z'),
        );
        const never = await contracts.create(
            contractData(
                'subscriber-1',
                'tenant-a',
                '2026-04-01T00:00:00.000Z',
                '2026-04-01T00:00:00.000Z',
            ),
        );

        assert.deepEqual(ids(await page({ state: 'ended' })), [ended.id]);
        assert.deepEqual(ids(await page({ state: 'scheduled' })), [scheduled.id]);
        assert.deepEqual(ids(await page({ state: 'never-in-force' })), [never.id]);
        assert.deepEqual(ids(await page({ state: 'all' })), [never.id, scheduled.id, ended.id]);
        const january = await page({ state: 'in-force', day: '2026-01-15' });
        assert.deepEqual([january.day, ids(january)], ['2026-01-15', [ended.id]]);
        const all = await page({ state: 'all', day: '2026-03-15' });
        assert.deepEqual(
            all.contracts.map(({ standing }) => standing),
            ['never-in-force', 'in-force', 'ended'],
        );
    });

    test(`is read ${CONTRACT_REGISTER_PAGE_SIZE} to a page, the next one named by the last on it`, async () => {
        const { contracts, page } = anInstallation();
        for (let day = 1; day <= CONTRACT_REGISTER_PAGE_SIZE + 1; day += 1) {
            const from = new Date(Date.UTC(2025, 0, day)).toISOString();
            await contracts.create(contractData('subscriber-1', 'tenant-a', from));
        }

        const first = await page({ state: 'all' });
        const second = await page({ state: 'all', after: first.next });

        assert.equal(first.contracts.length, CONTRACT_REGISTER_PAGE_SIZE);
        assert.equal(first.next, first.contracts[CONTRACT_REGISTER_PAGE_SIZE - 1].id);
        assert.deepEqual([second.contracts.length, second.next], [1, null]);
    });

    test("runs outside the tenants' row-level policy, a page in three reads", async () => {
        const { contracts, page, reads } = anInstallation();
        await contracts.create(
            contractData('subscriber-1', 'tenant-a', '2025-06-01T00:00:00.000Z'),
        );
        await contracts.create(
            contractData('subscriber-1', 'tenant-b', '2025-07-01T00:00:00.000Z'),
        );
        await contracts.create(
            contractData('subscriber-2', 'tenant-b', '2025-08-01T00:00:00.000Z'),
        );

        await page();

        assert.deepEqual(
            reads.map(({ name, args }) => [
                name,
                name === 'contracts' ? undefined : [...args[0]].sort(),
            ]),
            [
                ['contracts', undefined],
                ['subscribers', ['subscriber-1', 'subscriber-2']],
                ['tenants', ['tenant-a', 'tenant-b']],
            ],
        );
        assert.ok(reads.every(({ bypassed }) => bypassed));
    });

    test('fails a page with a contract whose subscriber the store cannot read, rather than leave it off', async () => {
        const { contracts, page } = anInstallation({ subscriberIds: [] });
        const contract = await contracts.create(
            contractData('subscriber-1', 'tenant-a', '2025-06-01T00:00:00.000Z'),
        );

        await assert.rejects(page(), {
            message: `The register lists contract ${contract.id}, whose subscriber subscriber-1 the store cannot read.`,
        });
    });

    test('is not read without the installation’s time zone, which invoicing requires', async () => {
        const { page } = anInstallation({ settings: {} });

        await assert.rejects(page(), /config\/saas\.yaml's timeZone/);
    });
});

describe('the register as the route takes it', () => {
    const problemsOf = async (query) =>
        (await validate(plainToInstance(ContractRegisterQueryDto, query))).map(
            ({ property }) => property,
        );

    test('a standing it knows, a day the calendar has, and an id of a length one can have', async () => {
        for (const state of ['in-force', 'ended', 'scheduled', 'never-in-force', 'all']) {
            assert.deepEqual(await problemsOf({ state }), []);
        }
        assert.deepEqual(await problemsOf({ day: '2028-02-29', after: 'x'.repeat(200) }), []);
        for (const query of [
            { state: 'active' },
            { day: '2026-02-30' },
            { day: '2026-2-1' },
            { day: '2026-02-17T00:00:00Z' },
            { after: 'x'.repeat(201) },
        ]) {
            assert.equal((await problemsOf(query)).length, 1, JSON.stringify(query));
        }
    });
});

describe('where the contract register is served', () => {
    const routes = (options) =>
        controllersIn(SaaSiCatModule.forRoot(options))
            .flatMap(handlersOf)
            .map((handler) => handler.route)
            .filter((route) => route.endsWith(' admin/contracts'));

    test('beside a subscriber’s contracts, and nowhere they are not', () => {
        const unconfirmed = everythingOnOptions([SignedInGuard]);
        unconfirmed.tenantBilling.chargeJournal.invoices.confirmations = undefined;

        assert.deepEqual(routes(everythingOnOptions([SignedInGuard])), ['GET admin/contracts']);
        assert.deepEqual(routes(unconfirmed), []);
        assert.deepEqual(routes(withoutInvoicing(everythingOnOptions())), []);
    });

    test('its page announced under contracts.read where it is served', async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [SaaSiCatModule.forRoot(bootable(everythingOnOptions([SignedInGuard])))],
        }).compile();
        try {
            const manifest = await moduleRef.get(AdminManifestService).getManifest();
            assert.equal(manifest.capabilities['contracts.read'], true);
            assert.deepEqual(manifest.navigation.standardPages.contracts, {
                enabled: true,
                requiredCapability: 'contracts.read',
            });
        } finally {
            await moduleRef.close();
        }
    });
});
