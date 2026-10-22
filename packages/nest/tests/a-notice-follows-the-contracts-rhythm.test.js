// Which of two configured notice periods a cancellation is measured against.
//
// A plan may be sold both ways, and the two numbers are set apart on purpose —
// fourteen days on a monthly contract, ninety on a yearly one. Reading the
// rhythm off the plan rather than off the contract gives every customer of that
// plan the same answer, and half of them the wrong one. The pure function is
// pinned elsewhere; what is decided here is which rhythm it is handed.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { CANCELLING, cancellationRoute } from './helpers/cancellation-route.js';

const NOTICE = { monthly: 14, yearly: 90 };

const buildController = (billingCycle) => cancellationRoute({ billingCycle, notice: NOTICE });

describe('a notice follows the rhythm of the contract', () => {
    // @requirement SC-CANC-007 — The rhythm that decides the notice is the subscription's, not the plan's
    test('one plan, two contracts, two deadlines', async () => {
        const monthly = buildController('MONTHLY');
        const yearly = buildController('YEARLY');

        const onMonthly = await monthly.controller.cancelSubscription(CANCELLING, {});
        const onYearly = await yearly.controller.cancelSubscription(CANCELLING, {});

        // Same plan, same period end, same day of asking. Only the rhythm of
        // the contract differs: fourteen days of notice fit inside the forty
        // that are left, ninety do not.
        assert.notDeepEqual(
            onMonthly.canceledEffectiveAt,
            onYearly.canceledEffectiveAt,
            'both contracts on the same plan were owed the same notice',
        );
    });

    // @requirement SC-CANC-007 — The rhythm that decides the notice is the subscription's, not the plan's
    test('the yearly contract is owed the longer of the two', async () => {
        // Which way round matters: swapping the two numbers at the call site
        // would still give two different dates.
        const monthly = buildController('MONTHLY');
        const yearly = buildController('YEARLY');

        const onMonthly = await monthly.controller.cancelSubscription(CANCELLING, {});
        const onYearly = await yearly.controller.cancelSubscription(CANCELLING, {});

        assert.ok(
            onYearly.canceledEffectiveAt > onMonthly.canceledEffectiveAt,
            'the ninety-day notice landed no later than the fourteen-day one',
        );
    });
});
