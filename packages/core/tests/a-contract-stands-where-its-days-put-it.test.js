// Where a contract stands on a day of the installation, the first moment of a
// day in a zone, the moments the register asks a store for under each state,
// and one contract as the register lists it.

// @requirement SC-ADM-046 — The contract register reads where each contract stands on a day of the installation

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    CONTRACT_REGISTER_STATES,
    adminRegisterContractOf,
    contractInsideWindow,
    contractRegisterWindowOf,
    contractStandingOn,
    startOfDayInZone,
} from '../dist/index.js';

const BERLIN = 'Europe/Berlin';
const at = (iso) => new Date(iso);

describe('the first moment of a day', () => {
    for (const [day, zone, first] of [
        ['2026-01-15', BERLIN, '2026-01-14T23:00:00.000Z'],
        ['2026-07-15', BERLIN, '2026-07-14T22:00:00.000Z'],
        // The clocks go forward at two in the morning: the day still has its midnight.
        ['2026-03-29', BERLIN, '2026-03-28T23:00:00.000Z'],
        ['2026-03-30', BERLIN, '2026-03-29T22:00:00.000Z'],
        ['2026-01-15', 'UTC', '2026-01-15T00:00:00.000Z'],
        ['2026-01-15', 'Pacific/Kiritimati', '2026-01-14T10:00:00.000Z'],
        ['2026-01-15', 'Etc/GMT+12', '2026-01-15T12:00:00.000Z'],
        // Cuba's clocks go from midnight to one: the day begins at one.
        ['2026-03-08', 'America/Havana', '2026-03-08T05:00:00.000Z'],
    ]) {
        test(`of ${day} in ${zone} is ${first}`, () => {
            assert.equal(startOfDayInZone(day, zone).toISOString(), first);
        });
    }

    for (const day of ['2026-02-30', '2026-13-01', '2026-1-5', 'today']) {
        test(`of ${day} is refused as no day`, () => {
            assert.throws(() => startOfDayInZone(day, BERLIN), RangeError);
        });
    }

    test('in a zone the runtime does not know is refused', () => {
        assert.throws(() => startOfDayInZone('2026-01-15', 'Mars/Olympus'), RangeError);
    });
});

describe('where a contract stands on a day', () => {
    // 17 February 2026 in Berlin is from 16 February 23:00 UTC to 17 February 23:00 UTC.
    const DAY = '2026-02-17';
    const standing = (from, until) =>
        contractStandingOn(
            { effectiveFrom: at(from), effectiveUntil: until && at(until) },
            DAY,
            BERLIN,
        );

    for (const [from, until, expected] of [
        ['2026-01-01T00:00:00.000Z', null, 'in-force'],
        ['2026-02-16T23:00:00.000Z', null, 'in-force'],
        ['2026-02-17T22:59:59.999Z', null, 'in-force'],
        ['2026-02-17T23:00:00.000Z', null, 'scheduled'],
        ['2026-01-01T00:00:00.000Z', '2026-02-16T23:00:00.000Z', 'ended'],
        ['2026-01-01T00:00:00.000Z', '2026-02-16T23:00:00.001Z', 'in-force'],
        ['2026-01-01T00:00:00.000Z', '2026-02-17T09:00:00.000Z', 'in-force'],
        ['2026-02-17T09:00:00.000Z', '2026-03-01T00:00:00.000Z', 'in-force'],
        ['2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', 'never-in-force'],
        ['2026-03-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', 'never-in-force'],
        ['2026-02-17T09:00:00.000Z', '2026-02-17T09:00:00.000Z', 'never-in-force'],
    ]) {
        test(`from ${from} until ${until ?? 'open-ended'}: ${expected}`, () => {
            assert.equal(standing(from, until), expected);
        });
    }

    test('is read on the installation’s day, not the UTC one', () => {
        const contract = { effectiveFrom: at('2026-02-16T23:30:00.000Z'), effectiveUntil: null };

        assert.deepEqual(
            [
                contractStandingOn(contract, '2026-02-16', BERLIN),
                contractStandingOn(contract, '2026-02-16', 'UTC'),
            ],
            ['scheduled', 'in-force'],
        );
    });
});

describe('the moments the register asks a store for', () => {
    const from = at('2026-02-16T23:00:00.000Z');
    const until = at('2026-02-17T23:00:00.000Z');

    for (const [state, window] of [
        ['in-force', { kind: 'overlapping', from, until }],
        ['ended', { kind: 'ended-by', by: from }],
        ['scheduled', { kind: 'starting-from', from: until }],
        ['never-in-force', { kind: 'never-in-force' }],
        ['all', { kind: 'all' }],
    ]) {
        test(`for ${state} on 2026-02-17 in Berlin are ${window.kind}`, () => {
            assert.deepEqual(contractRegisterWindowOf(state, '2026-02-17', BERLIN), window);
        });
    }
});

describe('a window of the register', () => {
    const contracts = [
        ['2026-01-01T00:00:00.000Z', null],
        ['2026-01-01T00:00:00.000Z', '2026-02-16T23:00:00.000Z'],
        ['2026-01-01T00:00:00.000Z', '2026-02-16T23:00:00.001Z'],
        ['2026-02-17T22:59:59.999Z', null],
        ['2026-02-17T23:00:00.000Z', '2026-04-01T00:00:00.000Z'],
        ['2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'],
        ['2026-03-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    ].map(([from, until]) => ({ effectiveFrom: at(from), effectiveUntil: until && at(until) }));

    for (const day of ['2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01']) {
        test(`holds a contract on ${day} exactly where its days give it the window's standing`, () => {
            for (const state of CONTRACT_REGISTER_STATES) {
                const window = contractRegisterWindowOf(state, day, BERLIN);
                for (const contract of contracts) {
                    assert.equal(
                        contractInsideWindow(contract, window),
                        state === 'all' || contractStandingOn(contract, day, BERLIN) === state,
                        `${state} on ${day}: ${contract.effectiveFrom.toISOString()} – ${contract.effectiveUntil?.toISOString() ?? 'open'}`,
                    );
                }
            }
        });
    }
});

describe('a contract as the register lists it', () => {
    const contract = {
        id: 'contract-1',
        tenantId: 'tenant-1',
        effectiveFrom: at('2026-01-31T23:00:00.000Z'),
        effectiveUntil: at('2026-02-28T23:00:00.000Z'),
        priceSnapshot: { billingCycle: 'monthly', currency: 'EUR', totalGross: 119 },
        lineItems: [
            { kind: 'discount', sourceKey: 'WELCOME', titleSnapshot: 'Welcome' },
            { kind: 'bundle', sourceKey: 'SMS', titleSnapshot: 'SMS' },
            { kind: 'plan', sourceKey: 'PRO', titleSnapshot: 'Pro' },
        ],
    };
    const subscriber = { id: 's-1', customerNumber: 'K-10001', legalName: 'Northwind GmbH' };

    test('names its subscriber, its tenant, what it was concluded on, its days and where it stands today', () => {
        const tenant = { id: 'tenant-1', slug: 'northwind', name: 'Northwind', deletedAt: null };

        assert.deepEqual(
            adminRegisterContractOf(contract, subscriber, tenant, '2026-03-02', BERLIN),
            {
                id: 'contract-1',
                subscriber,
                tenant: {
                    id: 'tenant-1',
                    known: true,
                    name: 'Northwind',
                    slug: 'northwind',
                    deletedAt: null,
                },
                plan: { key: 'PRO', title: 'Pro' },
                bundles: [{ key: 'SMS', title: 'SMS' }],
                firstDay: '2026-02-01',
                lastDay: '2026-02-28',
                standing: 'ended',
                billingCycle: 'monthly',
                currency: 'EUR',
                totalGross: 119,
            },
        );
    });

    test('says so where the application no longer has the tenant, and where it soft-deleted it', () => {
        const gone = adminRegisterContractOf(contract, subscriber, undefined, '2026-02-10', BERLIN);
        const deleted = adminRegisterContractOf(
            contract,
            subscriber,
            {
                id: 'tenant-1',
                slug: 'northwind',
                name: 'Northwind',
                deletedAt: '2026-03-01T00:00:00.000Z',
            },
            '2026-02-10',
            BERLIN,
        );

        assert.deepEqual(
            [gone.tenant, gone.standing],
            [{ id: 'tenant-1', known: false, name: null, slug: null, deletedAt: null }, 'in-force'],
        );
        assert.equal(deleted.tenant.deletedAt, '2026-03-01T00:00:00.000Z');
    });
});
