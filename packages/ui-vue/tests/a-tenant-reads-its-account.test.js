// useTenantAccount — what the tenant's subscriber owes and is owed, behind the
// billing permission: a refusal that says the part is not for this user hides
// it, anything else is an error the page reports.

// @requirement SC-PRIC-049 — A subscriber's account is shown to the tenant's users holding the billing permission

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { useTenantAccount } from '../dist/index.js';

const BALANCE = { currency: 'EUR', owed: 69, overdue: 20, credit: 12 };

/** The account read through a client answering every request with `status` and `body`. */
function accountAnswering(status, body, options = {}) {
    const asked = [];
    const http = async (url) => {
        asked.push(url);
        return {
            status,
            headers: { get: () => 'application/json' },
            json: async () => body,
            text: async () => JSON.stringify(body),
        };
    };
    return { account: useTenantAccount({ http, autoLoad: false, ...options }), asked };
}

describe("the tenant's account", () => {
    test('is read under the prefix the app gives, and the part is shown', async () => {
        const { account, asked } = accountAnswering(
            200,
            { balances: [BALANCE] },
            { apiPrefix: '/api/billing/' },
        );

        await account.reload();

        assert.deepEqual(asked, ['/api/billing/account']);
        assert.deepEqual(account.balances.value, [BALANCE]);
        assert.equal(account.available.value, true);
        assert.equal(account.error.value, null);
    });

    for (const status of [403, 404, 501]) {
        test(`answered ${status}, is a part not for this user, not an error`, async () => {
            const { account } = accountAnswering(status, {});

            await account.reload();

            assert.equal(account.available.value, false);
            assert.equal(account.error.value, null);
        });
    }

    test('that fails otherwise is an error the page reports', async () => {
        const { account } = accountAnswering(500, {});

        await account.reload();

        assert.equal(account.available.value, true);
        assert.ok(account.error.value instanceof Error);
    });

    test('answered without balances is an error, not a subscriber that owes nothing', async () => {
        const { account } = accountAnswering(200, { owed: 69 });

        await account.reload();

        assert.match(String(account.error.value), /did not answer with \{ balances \}/);
        assert.deepEqual(account.balances.value, []);
    });

    test('is read once without being asked', async () => {
        const asked = [];
        const http = async (url) => {
            asked.push(url);
            return {
                status: 200,
                headers: { get: () => null },
                json: async () => ({ balances: [] }),
            };
        };
        const account = useTenantAccount({ http });
        await new Promise((resolve) => setTimeout(resolve, 0));

        assert.deepEqual(asked, ['/billing/account']);
        assert.equal(account.available.value, true);
    });
});
