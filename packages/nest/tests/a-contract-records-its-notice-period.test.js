// A contract records the notice period of its rhythm when it is concluded or
// changed, and a cancellation of it is judged by that rather than by what the
// file names since: the confirmation a subscriber keeps names the notice, and
// a file changed later must not move the day a cancellation lands.
//
// Both doors every contract goes through — a contract concluded, and a
// successor written in place of the one in force — and the cancellation route
// that reads it back, over in-memory stores.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { SubscriptionContractService } from '../dist/subscription-contract/index.js';
import { FakeSubscriptionContractRepository } from '../dist/testing/index.js';
import { CANCELLING, cancellationRoute } from './helpers/cancellation-route.js';
import { line } from './helpers/charge-journal.js';
import { subscribersFor } from './helpers/subscribers.js';

const settingsNaming = (monthly, yearly) => ({
    tenantBilling: { cancellationNoticeDays: { monthly, yearly } },
});

/** A contract of `tenantId` in `billingCycle`, as a caller asks for one. */
const contractFor = (tenantId, billingCycle, effectiveFrom = new Date('2026-06-01')) => ({
    tenantId,
    effectiveFrom,
    priceSnapshot: {
        currency: 'EUR',
        billingCycle,
        subtotalNet: 49,
        discountNet: 0,
        totalNet: 49,
        vatRate: 19,
        totalGross: 58.31,
    },
    lineItems: [line('plan', 'STANDARD', 49, { billingCycle })],
});

/** The contract service over one store, reading the notice periods `settings` names. */
async function contractsUnder(settings, repo = new FakeSubscriptionContractRepository()) {
    const { service: subscribers } = await subscribersFor(['t1']);
    return {
        repo,
        contracts: new SubscriptionContractService(repo, subscribers, null, null, settings),
    };
}

// @requirement SC-CANC-025 — A cancellation is judged by the notice period its contract recorded
describe('a contract records the notice period it is written with', () => {
    for (const [rhythm, days] of [
        ['monthly', 14],
        ['yearly', 90],
    ]) {
        test(`concluded ${rhythm}, it records the days the file names for that rhythm`, async () => {
            const { contracts } = await contractsUnder(settingsNaming(14, 90));

            const concluded = await contracts.create(contractFor('t1', rhythm));

            assert.equal(concluded.cancellationNoticeDays, days);
        });
    }

    test('a successor records what the file names when it is written, and the contract it replaces keeps its own', async () => {
        const { repo, contracts: before } = await contractsUnder(settingsNaming(14, 90));
        const first = await before.create(contractFor('t1', 'monthly'));
        const { contracts: after } = await contractsUnder(settingsNaming(30, 90), repo);

        const successor = await after.writeSuccessor(
            first,
            contractFor('t1', 'monthly', new Date('2026-07-01')),
            new Date('2026-07-01'),
        );

        assert.equal(successor.cancellationNoticeDays, 30);
        assert.equal((await repo.findById(first.id)).cancellationNoticeDays, 14);
    });

    test('a successor in another rhythm records the days of that rhythm', async () => {
        const { contracts } = await contractsUnder(settingsNaming(14, 90));
        const first = await contracts.create(contractFor('t1', 'monthly'));

        const yearly = await contracts.writeSuccessor(
            first,
            contractFor('t1', 'yearly', new Date('2026-07-01')),
            new Date('2026-07-01'),
        );

        assert.equal(yearly.cancellationNoticeDays, 90);
    });

    test('the start is refused without the settings it records them from, naming the setting', async () => {
        const { service: subscribers } = await subscribersFor(['t1']);
        const contracts = new SubscriptionContractService(
            new FakeSubscriptionContractRepository(),
            subscribers,
        );

        assert.throws(
            () => contracts.onModuleInit(),
            /records the notice period `config\/saas\.yaml#tenantBilling\.cancellationNoticeDays` names/,
        );
    });
});

/**
 * The cancellation route under `notice`, with `inForce` as the contract in
 * force — or no contracts kept at all where it is `undefined` — and what the
 * contracts were asked.
 */
function judgedUnder({ billingCycle, notice, inForce }) {
    const asked = [];
    const contracts =
        inForce === undefined
            ? null
            : {
                  async findActiveByTenantId(tenantId, at) {
                      asked.push([tenantId, at instanceof Date]);
                      return inForce;
                  },
              };
    return { ...cancellationRoute({ billingCycle, notice, contracts }), asked };
}

/** The day a cancellation declared now lands on, under `options`. */
const landsOn = async (options) =>
    (await judgedUnder(options).controller.cancelSubscription(CANCELLING, {})).canceledEffectiveAt;

// @requirement SC-CANC-025 — A cancellation is judged by the notice period its contract recorded
describe('a cancellation is judged by the notice period its contract recorded', () => {
    test('a contract that recorded fourteen days lands at this period end, though the file names ninety since', async () => {
        const judged = await landsOn({
            notice: { monthly: 90, yearly: 90 },
            inForce: { cancellationNoticeDays: 14 },
        });

        assert.deepEqual(judged, await landsOn({ notice: { monthly: 14, yearly: 14 } }));
        assert.notDeepEqual(judged, await landsOn({ notice: { monthly: 90, yearly: 90 } }));
    });

    test('a contract that recorded ninety days is moved a period, though the file names fourteen since', async () => {
        const judged = await landsOn({
            notice: { monthly: 14, yearly: 14 },
            inForce: { cancellationNoticeDays: 90 },
        });

        assert.deepEqual(judged, await landsOn({ notice: { monthly: 90, yearly: 90 } }));
    });

    test('a yearly subscription is held to its contract too, not to the yearly number of the file', async () => {
        const judged = await landsOn({
            billingCycle: 'YEARLY',
            notice: { monthly: 14, yearly: 90 },
            inForce: { cancellationNoticeDays: 14 },
        });

        assert.deepEqual(
            judged,
            await landsOn({ billingCycle: 'YEARLY', notice: { monthly: 14, yearly: 14 } }),
        );
    });

    test('without a contract in force, the file names the notice, as where no contracts are kept', async () => {
        const nothingConfirmed = await landsOn({
            notice: { monthly: 90, yearly: 90 },
            inForce: null,
        });

        assert.deepEqual(nothingConfirmed, await landsOn({ notice: { monthly: 90, yearly: 90 } }));
        assert.notDeepEqual(
            nothingConfirmed,
            await landsOn({ notice: { monthly: 14, yearly: 14 } }),
        );
    });

    test('the contract asked is the tenant’s own, in force when the cancellation is declared', async () => {
        const { controller, asked } = judgedUnder({
            notice: { monthly: 14, yearly: 90 },
            inForce: { cancellationNoticeDays: 14 },
        });

        await controller.cancelSubscription(CANCELLING, {});

        assert.deepEqual(asked, [['t1', true]]);
    });
});
