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
        assert.deepEqual(
            [register.today.value, register.readOn.value],
            ['2026-02-17', '2026-01-15'],
            'the day read on is the one picked',
        );
        register.day.value = null;
        await settle();
        register.day.value = '';
        await settle();

        // A field cleared to `null` or to `''` both mean today: one read, not two.
        assert.deepEqual(asked, [
            { state: 'in-force' },
            { state: 'in-force', day: '2026-02-17', after: '1' },
            { state: 'ended' },
            { state: 'ended', day: '2026-01-15' },
            { state: 'ended' },
        ]);
        assert.deepEqual(
            register.contracts.rows.value.map(({ id }) => id),
            ['1'],
            'the page read before is gone',
        );
    });

    test('a day still being typed is not asked for, and the last whole day stays', async () => {
        const { asked, contracts } = aRegister();
        const register = useContractRegister(contracts);
        await settle();

        register.day.value = '2026-01-15';
        await settle();
        for (const typing of ['0002-01-15', '0020-01-15', '0202-01-15']) {
            register.day.value = typing;
            await settle();
        }
        register.day.value = '2025-01-15';
        await settle();

        assert.deepEqual(asked, [
            { state: 'in-force' },
            { state: 'in-force', day: '2026-01-15' },
            { state: 'in-force', day: '2025-01-15' },
        ]);
    });

    test('a later page is read on the day the first one was, across midnight too', async () => {
        let today = '2026-02-17';
        const asked = [];
        const register = useContractRegister({
            page: async (request) => {
                asked.push(request);
                const day = request.day ?? today;
                return request.after
                    ? { today, state: request.state, day, contracts: [contract('2')], next: null }
                    : { today, state: request.state, day, contracts: [contract('1')], next: '1' };
            },
        });
        await settle();

        today = '2026-02-18';
        await register.contracts.more();

        assert.deepEqual(asked, [
            { state: 'in-force' },
            { state: 'in-force', day: '2026-02-17', after: '1' },
        ]);
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
