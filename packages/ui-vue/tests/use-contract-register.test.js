// useContractRegister — every contract of the installation, a page at a time,
// narrowed to a standing on a day; changing either reads the register anew from
// its first page, and a page read for what was left behind is dropped.

// @requirement SC-ADM-046 — The contract register reads where each contract stands on a day of the installation

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { nextTick } from 'vue';

import { useContractRegister } from '../dist/index.js';

async function settle() {
    await nextTick();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

const contract = (id) => ({ id });

/** The register's operation, every request recorded; `pages` answers by what was asked. */
function aRegister(pages = async () => ({ contracts: [contract('1')], next: null })) {
    const asked = [];
    return {
        asked,
        contracts: {
            page: async (request) => {
                asked.push(request);
                return {
                    today: '2026-02-17',
                    state: request.state,
                    day: request.day ?? '2026-02-17',
                    ...(await pages(request)),
                };
            },
        },
    };
}

describe('useContractRegister', () => {
    test('reads the contracts in force today at once, and says the day the platform read them on', async () => {
        const { asked, contracts } = aRegister();

        const register = useContractRegister(contracts);
        await settle();

        assert.deepEqual(asked, [{ state: 'in-force' }]);
        assert.deepEqual(
            register.contracts.rows.value.map(({ id }) => id),
            ['1'],
        );
        assert.deepEqual(
            [register.today.value, register.readOn.value],
            ['2026-02-17', '2026-02-17'],
        );
    });

    test('a standing or a day picked reads the register anew from its first page, and a cleared day asks for today', async () => {
        const { asked, contracts } = aRegister(async ({ after }) =>
            after
                ? { contracts: [contract('2')], next: null }
                : { contracts: [contract('1')], next: '1' },
        );
        const register = useContractRegister(contracts);
        await settle();
        await register.contracts.more();

        register.state.value = 'ended';
        await settle();
        register.day.value = '2026-01-15';
        await settle();
        register.day.value = null;
        await settle();
        register.day.value = '';
        await settle();

        assert.deepEqual(asked, [
            { state: 'in-force' },
            { state: 'in-force', after: '1' },
            { state: 'ended' },
            { state: 'ended', day: '2026-01-15' },
            { state: 'ended' },
            { state: 'ended' },
        ]);
        assert.deepEqual(
            register.contracts.rows.value.map(({ id }) => id),
            ['1'],
            'the page read before is gone',
        );
    });

    test('a page for a standing left while it was on its way is dropped', async () => {
        let release;
        const { contracts } = aRegister(async ({ after }) =>
            after
                ? new Promise((resolve) => {
                      release = () => resolve({ contracts: [contract('late')], next: null });
                  })
                : { contracts: [contract('1')], next: '1' },
        );
        const register = useContractRegister(contracts);
        await settle();

        const more = register.contracts.more();
        await settle();
        register.state.value = 'all';
        await settle();
        release();
        await more;

        assert.ok(!register.contracts.rows.value.some(({ id }) => id === 'late'));
    });
});
