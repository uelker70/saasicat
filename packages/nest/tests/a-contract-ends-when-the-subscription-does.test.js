import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { SubscriptionContractFreezeService } from '../dist/billing/index.js';

// A frozen contract is the agreed service, and it ends when the subscription
// does — not when the customer says so.
//
// Those are months apart for an ordinary cancellation, and both mistakes are
// available. Leaving the contract active for ever outlives the agreement: the
// invoice side reads a live contract while entitlement resolution grants
// nothing. Terminating it on the spot does the opposite and is worse, because
// it takes effect the moment somebody DECLARES — the customer is still under
// contract, still paying, and the agreement has vanished from every lookup.
//
// The repository already asks its question as a window: `effectiveFrom <= asOf`
// and `effectiveUntil` null or after it. So a contract given an end in the
// future answers correctly on both sides of that date with nothing scheduled to
// flip it. This suite asserts findability rather than the status argument,
// because findability is what the invoice side actually reads.

const DAY = 86_400_000;
const ACTIVE_STATUSES = new Set(['active', 'scheduled']);

/** A store that answers `findActiveByTenantId` the way the adapter does. */
function contractStore() {
    const row = {
        id: 'c1',
        tenantId: 't1',
        status: 'active',
        effectiveFrom: new Date(Date.now() - 90 * DAY),
        effectiveUntil: null,
        lineItems: [],
        entitlementSnapshot: null,
    };
    return {
        row,
        async findActiveByTenantId(tenantId, asOf) {
            if (row.tenantId !== tenantId) return null;
            if (!ACTIVE_STATUSES.has(row.status)) return null;
            if (row.effectiveFrom > asOf) return null;
            if (row.effectiveUntil !== null && row.effectiveUntil <= asOf) return null;
            return row;
        },
        async terminate(contractId, data) {
            assert.equal(contractId, row.id);
            row.effectiveUntil = data.effectiveUntil;
            if (data.status !== null) row.status = data.status;
            return row;
        },
    };
}

function service(contracts) {
    return new SubscriptionContractFreezeService(
        { schemaVersion: 1, projectKey: 'demo', currency: 'EUR', vatRate: 19, plans: [] },
        { computeLimits: async () => ({}), invalidateTenant() {} },
        contracts,
        'demo',
        { loadBookedBundles: async () => [], findLivePlanVersionId: async () => null },
    );
}

describe('a cancellation that lands at the end of the term', () => {
    const landsIn20Days = new Date(Date.now() + 20 * DAY);

    test('leaves the contract findable until that date', async () => {
        // The customer is still under it, and still paying for it.
        const contracts = contractStore();

        await service(contracts).endOnCancellation('t1', landsIn20Days);

        const today = await contracts.findActiveByTenantId('t1', new Date());
        assert.ok(today, 'the agreement vanished the moment it was declared');
    });

    test('and not one moment past it', async () => {
        const contracts = contractStore();

        await service(contracts).endOnCancellation('t1', landsIn20Days);

        const after = await contracts.findActiveByTenantId(
            't1',
            new Date(landsIn20Days.getTime() + 1),
        );
        assert.equal(after, null, 'the contract outlived the subscription');
    });
});

describe('a cancellation that lands at once', () => {
    test('ends the contract now, status and all', async () => {
        // Nothing left to run — a trial, or a term already over. There is no
        // window to keep open, and a row left `active` with an end in the past
        // is a state nobody should have to reason about.
        const contracts = contractStore();

        await service(contracts).endOnCancellation('t1', new Date());

        assert.equal(contracts.row.status, 'terminated');
        assert.equal(await contracts.findActiveByTenantId('t1', new Date()), null);
    });
});

describe('a tenant with no contract at all', () => {
    test('is not an error', async () => {
        // The premise: the port is optional and most installations have no
        // contracts. Ending nothing must stay quiet.
        const contracts = contractStore();
        contracts.row.tenantId = 'somebody-else';

        await service(contracts).endOnCancellation('t1', new Date());

        assert.equal(contracts.row.effectiveUntil, null);
    });
});
