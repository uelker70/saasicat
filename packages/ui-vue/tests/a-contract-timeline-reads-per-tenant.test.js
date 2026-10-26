// A subscriber's contracts as its record reads them: one timeline per tenant,
// the contracts in force on a day picked, the phrases a change is said in, the
// lines a filter keeps — and the one contract opened, read for its subscriber.

// @requirement SC-ADM-041 — The record shows every contract as it was concluded, and how one followed another

import { describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';

import { nextTick, ref } from 'vue';

import {
    contractChangePartsOf,
    contractLinesMatching,
    contractTimelinesOf,
    inForceOn,
    servesStandardPage,
} from '../dist/index.js';
import { useContractDossier, useCopyText } from '../dist/vue/index.js';

const UNCHANGED = {
    concluded: false,
    plan: null,
    bundlesAdded: [],
    bundlesRemoved: [],
    frozenAnew: false,
    priceChanged: false,
    cancelled: false,
};

const contract = (id, overrides = {}) => ({
    id,
    tenantId: 't-1',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    concludedAt: '2026-01-01T00:00:00.000Z',
    firstDay: '2026-01-01',
    lastDay: null,
    neverInForce: false,
    change: UNCHANGED,
    ...overrides,
});

const tenant = (tenantId, overrides = {}) => ({
    tenantId,
    linkedAt: '2026-01-01T00:00:00.000Z',
    unlinkedAt: null,
    known: true,
    slug: tenantId,
    name: tenantId,
    deletedAt: null,
    ...overrides,
});

async function settle() {
    await nextTick();
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

describe('the timelines of a subscriber’s contracts', () => {
    test('are one per tenant, in the order the record names the tenants, the latest start first', () => {
        // The record names the live tenant first; by name it would come last.
        const contracts = [
            contract('a-1', { tenantId: 't-a-old', effectiveFrom: '2025-01-01T00:00:00.000Z' }),
            contract('b-1', { tenantId: 't-z-live' }),
            contract('b-2', { tenantId: 't-z-live', effectiveFrom: '2026-03-01T00:00:00.000Z' }),
            contract('c-1', { tenantId: 't-m-unnamed' }),
        ];

        const timelines = contractTimelinesOf(contracts, [tenant('t-z-live'), tenant('t-a-old')]);

        assert.deepEqual(
            timelines.map(({ tenantId, contracts: chain }) => [
                tenantId,
                chain.map(({ id }) => id),
            ]),
            [
                ['t-z-live', ['b-2', 'b-1']],
                ['t-a-old', ['a-1']],
                ['t-m-unnamed', ['c-1']],
            ],
        );
        assert.equal(timelines[2].tenant, null, 'a tenant the record does not name');
    });

    test('of two contracts that start together, the one written later comes first', () => {
        const contracts = [
            contract('x-1', { concludedAt: '2026-01-01T00:00:00.000Z' }),
            contract('x-2', { concludedAt: '2026-01-02T00:00:00.000Z' }),
        ];

        assert.deepEqual(
            contractTimelinesOf(contracts, [])[0].contracts.map(({ id }) => id),
            ['x-2', 'x-1'],
        );
    });
});

describe('a contract in force on a day', () => {
    const ending = contract('c', { firstDay: '2026-01-05', lastDay: '2026-01-31' });

    for (const [day, expected] of [
        ['2026-01-04', false],
        ['2026-01-05', true],
        ['2026-01-31', true],
        ['2026-02-01', false],
    ]) {
        test(`${day} is ${expected ? 'in' : 'outside'} 2026-01-05 – 2026-01-31`, () => {
            assert.equal(inForceOn(ending, day), expected);
        });
    }

    test('one open-ended is in force on every day from its first', () => {
        const running = contract('c', { firstDay: '2026-01-05' });

        assert.deepEqual(
            ['2026-01-04', '2026-01-05', '2099-12-31'].map((day) => inForceOn(running, day)),
            [false, true, true],
        );
    });

    test('one never in force is in force on no day, its first included', () => {
        const never = contract('c', { firstDay: '2026-04-01', neverInForce: true });

        assert.equal(inForceOn(never, '2026-04-01'), false);
    });
});

describe('what a contract changed, as the timeline says it', () => {
    test('in order: concluded or the plan, the add-ons, frozen anew, cancelled', () => {
        const parts = contractChangePartsOf({
            ...UNCHANGED,
            plan: 'downgraded',
            bundlesAdded: [{ key: 'S', title: 'Storage' }],
            bundlesRemoved: [{ key: 'U', title: 'Users' }],
            cancelled: true,
        });

        assert.deepEqual(parts, [
            { kind: 'planDowngraded', title: null },
            { kind: 'bundleAdded', title: 'Storage' },
            { kind: 'bundleRemoved', title: 'Users' },
            { kind: 'cancelled', title: null },
        ]);
    });

    test('frozen anew says whether the price moved', () => {
        assert.deepEqual(contractChangePartsOf({ ...UNCHANGED, frozenAnew: true }), [
            { kind: 'frozenAnew', title: null },
        ]);
        assert.deepEqual(
            contractChangePartsOf({ ...UNCHANGED, frozenAnew: true, priceChanged: true }),
            [{ kind: 'frozenAnewAtNewPrice', title: null }],
        );
    });

    test('the first contract is concluded', () => {
        assert.deepEqual(contractChangePartsOf({ ...UNCHANGED, concluded: true }), [
            { kind: 'concluded', title: null },
        ]);
    });
});

describe('the lines a filter keeps', () => {
    const lines = [
        { id: 'p', kind: 'plan', features: ['api-access'], quotas: { users: 5 } },
        { id: 'b', kind: 'bundle', features: [], quotas: { storageGb: 50 } },
        { id: 'd', kind: 'discount', features: [], quotas: {} },
    ];

    test('are every line while nothing is typed', () => {
        assert.deepEqual(
            contractLinesMatching(lines, '  ').map(({ id }) => id),
            ['p', 'b', 'd'],
        );
    });

    test('are those with a feature or a quota holding the text, in any case', () => {
        assert.deepEqual(
            contractLinesMatching(lines, 'API').map(({ id }) => id),
            ['p'],
        );
        assert.deepEqual(
            contractLinesMatching(lines, 'storage').map(({ id }) => id),
            ['b'],
        );
    });

    test('take the text as it is, a character a pattern would read otherwise included', () => {
        assert.deepEqual(contractLinesMatching(lines, '.*'), []);
    });
});

describe('a standard page the manifest serves', () => {
    const manifest = (page, capabilities = {}) => ({
        capabilities,
        navigation: { standardPages: { plans: page }, projectPages: [] },
    });

    test('is enabled, and given the capability it names', () => {
        assert.equal(servesStandardPage(manifest({ enabled: true }), 'plans'), true);
        assert.equal(
            servesStandardPage(
                manifest(
                    { enabled: true, requiredCapability: 'plans.read' },
                    { 'plans.read': true },
                ),
                'plans',
            ),
            true,
        );
    });

    test('is not one disabled, one without its capability, or one the manifest does not name', () => {
        assert.equal(servesStandardPage(manifest({ enabled: false }), 'plans'), false);
        assert.equal(
            servesStandardPage(
                manifest({ enabled: true, requiredCapability: 'plans.read' }),
                'plans',
            ),
            false,
        );
        assert.equal(servesStandardPage(manifest({ enabled: true }), 'bundles'), false);
    });
});

describe('useContractDossier', () => {
    /** The contract operation, every request recorded. */
    function contracts() {
        const asked = [];
        return {
            asked,
            subscribers: {
                contract: async (subscriberId, contractId) => {
                    asked.push(`${subscriberId} ${contractId}`);
                    return { contract: { id: contractId } };
                },
            },
        };
    }

    test('reads nothing until a contract is opened, then the one opened', async () => {
        const { asked, subscribers } = contracts();
        const dossier = useContractDossier(ref('s-1'), subscribers);
        await settle();
        assert.deepEqual(asked, []);

        dossier.toggle('c-2');
        await settle();

        assert.deepEqual(asked, ['s-1 c-2']);
        assert.equal(dossier.openId.value, 'c-2');
        assert.equal(dossier.data.value.contract.id, 'c-2');
    });

    test('opening the one open closes it; opening another reads that one', async () => {
        const { asked, subscribers } = contracts();
        const dossier = useContractDossier(ref('s-1'), subscribers);
        await settle();

        dossier.toggle('c-2');
        await settle();
        dossier.toggle('c-1');
        await settle();
        dossier.toggle('c-1');
        await settle();

        assert.deepEqual(asked, ['s-1 c-2', 's-1 c-1']);
        assert.equal(dossier.openId.value, null);
        assert.equal(dossier.data.value, null);
    });

    test('another subscriber finds nothing open, and asks nothing about the contract of the one before', async () => {
        const { asked, subscribers } = contracts();
        const subscriberId = ref('s-1');
        const dossier = useContractDossier(subscriberId, subscribers);
        await settle();
        dossier.toggle('c-2');
        await settle();

        subscriberId.value = 's-2';
        await settle();

        assert.equal(dossier.openId.value, null);
        assert.deepEqual(asked, ['s-1 c-2']);
    });
});

describe('useCopyText', () => {
    test('writes the text and says it did', async () => {
        const written = [];
        const told = [];
        const { copy } = useCopyText({
            notify: (kind, message) => told.push([kind, message]),
            clipboard: { writeText: async (text) => written.push(text) },
        });

        await copy('c-2');

        assert.deepEqual(written, ['c-2']);
        assert.deepEqual(told, [['positive', '“c-2” copied']]);
    });

    test('a clipboard that refuses, or none at all, is said rather than thrown', async () => {
        const told = [];
        const notify = (kind) => told.push(kind);
        const refusing = useCopyText({
            notify,
            clipboard: { writeText: mock.fn(async () => Promise.reject(new Error('no focus'))) },
        });
        const absent = useCopyText({ notify, clipboard: null });

        await refusing.copy('c-2');
        await absent.copy('c-2');

        assert.deepEqual(told, ['negative', 'negative']);
    });
});
